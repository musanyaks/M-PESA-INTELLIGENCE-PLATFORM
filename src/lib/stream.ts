import { db } from "@/db";
import { transactions, fraudCases, alerts, dailyMetrics } from "@/db/schema";
import { Rng, clamp, dayKey, riskLevel } from "./core";
import { buildTwinPopulation, synthesiseEvent } from "./simulator";
import { getFraudBundle, scoreEvent, explainEvent, extractFeatures, type TxnEvent, type FraudVerdict } from "./ml/fraud";
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ *
 * In-process event backbone that mirrors the production topology:
 *   producer → topic/partition → consumer groups (fraud | analytics |
 *   notifications) → sink (Postgres) → SSE fan-out to the console.
 * ------------------------------------------------------------------ */

export type StreamEvent = {
  event: TxnEvent;
  verdict: FraudVerdict;
  meta: {
    topic: string;
    partition: number;
    offset: number;
    producedAt: number;
    scoredAt: number;
    persistedAt: number;
    ingestMs: number;
    inferenceMs: number;
    endToEndMs: number;
  };
};

type BrokerState = {
  topics: Record<string, { partitions: number; offsets: number[]; total: number }>;
  consumerGroups: { name: string; topics: string[]; lag: number; committed: number; tps: number }[];
  subscribers: Set<(payload: StreamEvent) => void>;
  buffer: StreamEvent[];
  running: boolean;
  ratePerSecond: number;
  startedAt: number | null;
  timer: ReturnType<typeof setInterval> | null;
  produced: number;
  dropped: number;
  fraudHits: number;
  latencySamples: number[];
  inferenceSamples: number[];
  tpsWindow: { t: number; n: number }[];
  pending: TxnEvent[];
  pendingVerdicts: FraudVerdict[];
  flushTimer: ReturnType<typeof setInterval> | null;
  lastError: string | null;
  population: ReturnType<typeof buildTwinPopulation> | null;
  lastConsumerAt: number;
  rng: Rng;
};

const g = globalThis as typeof globalThis & { __mpxBroker?: BrokerState };

function broker(): BrokerState {
  if (!g.__mpxBroker) {
    g.__mpxBroker = {
      topics: {
        "mpesa.bronze.raw": { partitions: 8, offsets: new Array(8).fill(0), total: 0 },
        "mpesa.fraud.verdicts": { partitions: 4, offsets: new Array(4).fill(0), total: 0 },
        "mpesa.analytics.rollups": { partitions: 4, offsets: new Array(4).fill(0), total: 0 },
        "mpesa.notifications.alerts": { partitions: 2, offsets: new Array(2).fill(0), total: 0 },
      },
      consumerGroups: [
        { name: "fraud-engine", topics: ["mpesa.bronze.raw"], lag: 0, committed: 0, tps: 0 },
        { name: "analytics-engine", topics: ["mpesa.fraud.verdicts"], lag: 0, committed: 0, tps: 0 },
        { name: "notification-engine", topics: ["mpesa.notifications.alerts"], lag: 0, committed: 0, tps: 0 },
        { name: "lakehouse-sink", topics: ["mpesa.analytics.rollups"], lag: 0, committed: 0, tps: 0 },
      ],
      subscribers: new Set(),
      buffer: [],
      running: false,
      ratePerSecond: 6,
      startedAt: null,
      timer: null,
      produced: 0,
      dropped: 0,
      fraudHits: 0,
      latencySamples: [],
      inferenceSamples: [],
      tpsWindow: [],
      pending: [],
      pendingVerdicts: [],
      flushTimer: null,
      lastError: null,
      population: null,
      lastConsumerAt: Date.now(),
      rng: new Rng(Date.now() % 100000),
    };
  }
  return g.__mpxBroker;
}

function commit(topic: string, key: string) {
  const b = broker();
  const t = b.topics[topic];
  if (!t) return { partition: 0, offset: 0 };
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const partition = h % t.partitions;
  t.offsets[partition] += 1;
  t.total += 1;
  return { partition, offset: t.offsets[partition] };
}

export function subscribe(fn: (payload: StreamEvent) => void): () => void {
  const b = broker();
  b.subscribers.add(fn);
  return () => b.subscribers.delete(fn);
}

export function recentEvents(limit = 40): StreamEvent[] {
  return broker().buffer.slice(-limit).reverse();
}

export function streamStatus() {
  const b = broker();
  const now = Date.now();
  const window = b.tpsWindow.filter((s) => now - s.t < 10000);
  b.tpsWindow = window;
  const tps = window.length ? window.reduce((a, s) => a + s.n, 0) / 10 : 0;
  const lat = b.latencySamples.slice(-400).sort((a, c) => a - c);
  const inf = b.inferenceSamples.slice(-400).sort((a, c) => a - c);
  const pick = (arr: number[], p: number) => (arr.length ? arr[clamp(Math.floor((p / 100) * arr.length), 0, arr.length - 1)] : 0);
  return {
    running: b.running,
    ratePerSecond: b.ratePerSecond,
    startedAt: b.startedAt,
    uptimeSeconds: b.startedAt ? Math.round((now - b.startedAt) / 1000) : 0,
    produced: b.produced,
    dropped: b.dropped,
    fraudHits: b.fraudHits,
    liveTps: Number(tps.toFixed(2)),
    subscribers: b.subscribers.size,
    pendingWrites: b.pending.length,
    latency: { p50: pick(lat, 50), p95: pick(lat, 95), p99: pick(lat, 99), samples: lat.length },
    inference: { p50: pick(inf, 50), p95: pick(inf, 95), p99: pick(inf, 99) },
    topics: Object.entries(b.topics).map(([name, t]) => ({
      name, partitions: t.partitions, total: t.total, offsets: t.offsets,
      headOffset: t.offsets.reduce((a, c) => a + c, 0),
    })),
    consumerGroups: b.consumerGroups.map((cg) => ({ ...cg, tps: Number(tps.toFixed(2)) })),
    lastError: b.lastError,
  };
}

async function persistBatch() {
  const b = broker();
  if (b.pending.length === 0) return;
  const eventsAll = b.pending.splice(0, b.pending.length);
  const verdictsAll = b.pendingVerdicts.splice(0, b.pendingVerdicts.length);
  // Lakehouse write policy: every flagged verdict is persisted, benign traffic is
  // sampled 1-in-12 so a long-running producer cannot grow the warehouse unbounded.
  const events: typeof eventsAll = [];
  const verdicts: typeof verdictsAll = [];
  eventsAll.forEach((e, i) => {
    const v = verdictsAll[i];
    if (v.level === "HIGH" || v.level === "CRITICAL" || i % 12 === 0) {
      events.push(e);
      verdicts.push(v);
    }
  });
  b.dropped += eventsAll.length - events.length;
  try {
    const rows = events.map((e, i) => {
      const v = verdicts[i];
      return {
        id: `txn_live_${e.code}_${i}_${Date.now().toString(36)}`,
        code: `${e.code}L`,
        customerId: e.customerId,
        customerCode: e.customerCode,
        merchantId: e.merchantId,
        merchantCode: e.merchantCode,
        merchantName: e.merchantName,
        recipientId: e.recipientId,
        type: e.type,
        status: e.status,
        channel: e.channel,
        amount: Math.round(e.amount),
        fee: Math.round(e.fee),
        county: e.county,
        lat: e.lat,
        lon: e.lon,
        category: e.category,
        riskScore: v.score,
        riskLevel: v.level,
        isFraud: 0,
        flagged: v.level === "HIGH" || v.level === "CRITICAL" ? 1 : 0,
        detectors: v.detectors as unknown as Record<string, number>,
        reasons: v.reasons,
        ingestLatencyMs: 0,
        occurredAt: new Date(e.occurredAt),
      };
    });
    for (let i = 0; i < rows.length; i += 200) {
      await db.insert(transactions).values(rows.slice(i, i + 200)).onConflictDoNothing();
    }
    const day = dayKey(new Date());
    await db
      .insert(dailyMetrics)
      .values({
        day,
        txnCount: rows.length,
        txnValue: rows.reduce((a, r) => a + r.amount, 0),
        fees: rows.reduce((a, r) => a + r.fee, 0),
        flaggedCount: rows.filter((r) => r.flagged === 1).length,
      })
      .onConflictDoUpdate({
        target: dailyMetrics.day,
        set: {
          txnCount: sql`${dailyMetrics.txnCount} + ${rows.length}`,
          txnValue: sql`${dailyMetrics.txnValue} + ${rows.reduce((a, r) => a + r.amount, 0)}`,
          fees: sql`${dailyMetrics.fees} + ${rows.reduce((a, r) => a + r.fee, 0)}`,
          flaggedCount: sql`${dailyMetrics.flaggedCount} + ${rows.filter((r) => r.flagged === 1).length}`,
        },
      });
  } catch (err) {
    b.lastError = err instanceof Error ? err.message : String(err);
  }
}

async function emitCase(e: TxnEvent, v: FraudVerdict, bundle: Awaited<ReturnType<typeof getFraudBundle>>) {
  const b = broker();
  b.fraudHits += 1;
  try {
    const caseId = `case_live_${e.code}`.toUpperCase();
    await db
      .insert(fraudCases)
      .values({
        id: caseId,
        caseCode: `FRD-${e.code.replace("TXN-", "")}`,
        transactionId: e.code,
        transactionCode: e.code,
        customerId: e.customerId,
        customerCode: e.customerCode,
        customerName: e.customerName,
        merchantName: e.merchantName,
        county: e.county,
        type: e.type,
        amount: Math.round(e.amount),
        riskScore: v.score,
        riskLevel: v.level,
        status: "OPEN",
        recommendation: v.recommendation,
        confidence: Number((v.confidence * 100).toFixed(1)),
        detectors: v.detectors as unknown as Record<string, number>,
        attributions: explainEvent(bundle, e, extractFeatures(e), v),
        reasons: v.reasons,
        potentialLoss: Math.round(e.amount),
        slaMinutes: v.level === "CRITICAL" ? 15 : 45,
      })
      .onConflictDoNothing();
  } catch {
    /* non-fatal */
  }
}

export async function ingestEvent(e: TxnEvent, bundleOverride?: Awaited<ReturnType<typeof getFraudBundle>>): Promise<StreamEvent> {
  const b = broker();
  const producedAt = Date.now();
  const bronze = commit("mpesa.bronze.raw", e.code);
  const bundle = bundleOverride ?? (await getFraudBundle());
  const features = extractFeatures(e);
  const t0 = Date.now();
  const verdict = scoreEvent(bundle, e, features);
  const scoredAt = Date.now();
  const fraudTopic = commit("mpesa.fraud.verdicts", e.code);
  commit("mpesa.analytics.rollups", e.customerId);

  if (verdict.level === "HIGH" || verdict.level === "CRITICAL") {
    const channel = verdict.level === "CRITICAL" ? "SMS" : "DASHBOARD";
    commit("mpesa.notifications.alerts", e.code);
    try {
      await db.insert(alerts).values({
        id: `alr_live_${e.code}`.toUpperCase(),
        code: `ALR-${e.code.replace("TXN-", "")}`,
        severity: verdict.level,
        channel,
        title: `${verdict.level === "CRITICAL" ? "CRITICAL" : "HIGH"}-RISK TRANSACTION`,
        body: `${e.type} of KSh ${Math.round(e.amount).toLocaleString()} by ${e.customerCode} in ${e.county}. Risk ${verdict.score}/100 — ${verdict.reasons.slice(0, 3).join(", ") || "ensemble signal"}.`,
        rule: verdict.rules[0]?.rule ?? "ENSEMBLE_ML",
        transactionCode: e.code,
        customerCode: e.customerCode,
        county: e.county,
        amount: Math.round(e.amount),
        riskScore: verdict.score,
        status: "FIRED",
      }).onConflictDoNothing();
    } catch {
      /* non-fatal */
    }
    void emitCase(e, verdict, bundle).catch(() => undefined);
  }

  b.pending.push(e);
  b.pendingVerdicts.push(verdict);
  const persistedAt = Date.now();

  const payload: StreamEvent = {
    event: { ...e, code: `${e.code}L` },
    verdict,
    meta: {
      topic: "mpesa.fraud.verdicts",
      partition: fraudTopic.partition,
      offset: fraudTopic.offset,
      producedAt,
      scoredAt,
      persistedAt,
      ingestMs: scoredAt - producedAt,
      inferenceMs: scoredAt - t0,
      endToEndMs: persistedAt - producedAt,
    },
  };
  void bronze;

  b.latencySamples.push(payload.meta.endToEndMs);
  b.inferenceSamples.push(payload.meta.inferenceMs);
  if (b.latencySamples.length > 2000) b.latencySamples.splice(0, 1000);
  if (b.inferenceSamples.length > 2000) b.inferenceSamples.splice(0, 1000);

  b.buffer.push(payload);
  if (b.buffer.length > 120) b.buffer.splice(0, b.buffer.length - 120);
  if (b.buffer.length > 120) b.buffer.shift();
  for (const cg of b.consumerGroups) {
    cg.committed += 1;
    cg.lag = Math.max(0, b.pending.length);
  }
  for (const fn of Array.from(b.subscribers)) {
    try {
      fn(payload);
    } catch {
      b.subscribers.delete(fn);
    }
  }
  return payload;
}

function ensurePopulation() {
  const b = broker();
  if (!b.population) b.population = buildTwinPopulation({ customers: 2400, merchants: 320, seed: 9001 });
  return b.population;
}

function tick() {
  const b = broker();
  const population = ensurePopulation();
  const now = Date.now();
  if (b.subscribers.size > 0) {
    b.lastConsumerAt = now;
  } else if (now - b.lastConsumerAt > 90_000) {
    // No SSE consumer for 90s: park the producer instead of burning write capacity.
    stopStream();
    return;
  }
  const target = b.ratePerSecond;
  const emitted: TxnEvent[] = [];
  for (let i = 0; i < target; i++) {
    const at = new Date();
    const e = synthesiseEvent(b.rng, population, at, { fraudBias: 1.25, seq: now % 9000000 + i });
    e.code = `TXN-${String((now % 900000) * 10 + i).padStart(7, "0")}`;
    e.occurredAt = at.toISOString();
    e.hour = at.getUTCHours();
    emitted.push(e);
  }
  b.tpsWindow.push({ t: now, n: emitted.length });
  b.produced += emitted.length;
  for (const e of emitted) {
    void ingestEvent(e).catch((err) => {
      b.lastError = err instanceof Error ? err.message : String(err);
      b.dropped += 1;
    });
  }
}

export async function startStream(ratePerSecond = 4): Promise<{ started: boolean; rate: number; warmupMs: number }> {
  const b = broker();
  const t0 = Date.now();
  await getFraudBundle();
  ensurePopulation();
  if (b.running) {
    b.ratePerSecond = clamp(ratePerSecond, 1, 60);
    return { started: true, rate: b.ratePerSecond, warmupMs: Date.now() - t0 };
  }
  b.running = true;
  b.ratePerSecond = clamp(ratePerSecond, 1, 60);
  b.startedAt = Date.now();
  b.lastConsumerAt = Date.now();
  b.timer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      b.lastError = err instanceof Error ? err.message : String(err);
    }
  }, 1000);
  b.flushTimer = setInterval(() => {
    void persistBatch();
  }, 4000);
  return { started: true, rate: b.ratePerSecond, warmupMs: Date.now() - t0 };
}

export function stopStream() {
  const b = broker();
  if (b.timer) clearInterval(b.timer);
  if (b.flushTimer) clearInterval(b.flushTimer);
  b.timer = null;
  b.flushTimer = null;
  b.running = false;
  void persistBatch();
  return { stopped: true, produced: b.produced };
}

export { riskLevel };
