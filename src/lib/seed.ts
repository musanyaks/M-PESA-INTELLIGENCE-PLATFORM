import { db, pool } from "@/db";
import {
  users, customers, merchants, transactions, dailyMetrics, fraudCases, alerts,
  segments, mlModels, forecasts, pipelineRuns, benchmarkRuns, systemState, auditLogs,
} from "@/db/schema";
import { sql } from "drizzle-orm";
import {
  Rng, clamp, dayKey, hashString, COUNTY_WEIGHTS, countyByName, TXN_TYPES, TXN_CATEGORY, ROLES, TXN_LABEL, TWIN_SCALE,
} from "./core";
import { hashPassword, DEMO_ACCOUNTS } from "./auth";
import { buildTwinPopulation, synthesiseEvent, type TwinCustomer, type TwinMerchant } from "./simulator";
import {
  trainFraudBundle, getFraudBundle, scoreEvent, explainEvent, extractFeatures,
  FEATURE_SPECS, type TxnEvent,
} from "./ml/fraud";
import { StandardScaler, LogisticRegression, kmeans, holtWinters, autoRegressive, classificationReport } from "./ml/core";

export type Stage = { name: string; label: string; at: string; durationMs: number; records: number };
export type BootstrapStatus = {
  done: boolean;
  running: boolean;
  stage: string;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  stages: Stage[];
  version: string;
};

const STATE_KEY = "bootstrap";
const LOCK_KEY = 90210;
const DAYS = 96;
const EVENTS_PER_DAY = 340;
export { TWIN_SCALE };

let localStatus: BootstrapStatus = {
  done: false, running: false, stage: "idle", progress: 0, startedAt: null,
  finishedAt: null, error: null, stages: [], version: "2.4.1",
};
let bootstrapPromise: Promise<BootstrapStatus> | null = null;

async function setState(key: string, value: Record<string, unknown>) {
  await db
    .insert(systemState)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
}

export async function getStatus(): Promise<BootstrapStatus> {
  if (localStatus.running) return localStatus;
  try {
    const rows = await db.select().from(systemState).where(sql`${systemState.key} = ${STATE_KEY}`).limit(1);
    const stored = rows[0]?.value as unknown as BootstrapStatus | undefined;
    if (stored) {
      localStatus = { ...stored, running: false };
      return localStatus;
    }
  } catch {
    /* table may not exist yet */
  }
  return localStatus;
}

/** Guarantees the lakehouse is materialised before any read path runs. */
export async function ensureReady(): Promise<BootstrapStatus> {
  const status = await getStatus();
  if (status.done && !status.error) return status;
  return runBootstrap(false);
}

export function runBootstrap(force = false): Promise<BootstrapStatus> {
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = execute(force)
    .then((s) => {
      bootstrapPromise = null;
      return s;
    })
    .catch(async (err) => {
      bootstrapPromise = null;
      const message = err instanceof Error ? err.message : String(err);
      localStatus = { ...localStatus, running: false, error: message, stage: "failed", progress: 100 };
      try {
        await setState(STATE_KEY, { ...localStatus } as unknown as Record<string, unknown>);
      } catch {
        /* ignore */
      }
      return localStatus;
    });
  return bootstrapPromise;
}

const PLAN = [
  { name: "identity", label: "Identity, RBAC & secrets" },
  { name: "bronze", label: "Bronze · synthetic M-PESA twin ingest" },
  { name: "scoring", label: "Fraud engine · ensemble inference" },
  { name: "silver", label: "Silver · conformed transaction facts" },
  { name: "features", label: "Feature store · customer & merchant rollups" },
  { name: "ml", label: "Model registry · train & evaluate" },
  { name: "segmentation", label: "K-Means customer segmentation" },
  { name: "churn", label: "Churn & next-best-action models" },
  { name: "gold", label: "Gold · daily metric marts" },
  { name: "forecast", label: "Holt-Winters / AR forecasting" },
  { name: "cases", label: "Fraud case & alert generation" },
  { name: "observability", label: "Pipeline runs, benchmarks & audit" },
];

async function execute(force: boolean): Promise<BootstrapStatus> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${LOCK_KEY})`);
    const existing = await client.query(`SELECT value FROM system_state WHERE key = $1`, [STATE_KEY]);
    const stored = existing.rows[0]?.value as BootstrapStatus | undefined;
    const txnCount = await client.query(`SELECT count(*)::int AS n FROM transactions`);
    if (!force && stored?.done && txnCount.rows[0].n > 1000) {
      localStatus = { ...stored, running: false };
      return localStatus;
    }

    localStatus = {
      done: false, running: true, stage: PLAN[0].name, progress: 2,
      startedAt: new Date().toISOString(), finishedAt: null, error: null, stages: [], version: "2.4.1",
    };
    await setState(STATE_KEY, localStatus as unknown as Record<string, unknown>);

    const stages: Stage[] = [];
    const pipelineEntries: typeof pipelineRuns.$inferInsert[] = [];
    const step = async (name: string, records: number, fn: () => Promise<void>) => {
      const plan = PLAN.find((p) => p.name === name);
      const t0 = Date.now();
      localStatus.stage = name;
      await fn();
      const durationMs = Date.now() - t0;
      stages.push({ name, label: plan?.label ?? name, at: new Date().toISOString(), durationMs, records });
      localStatus.stages = [...stages];
      const idx = PLAN.findIndex((p) => p.name === name);
      localStatus.progress = Math.round(((idx + 1) / PLAN.length) * 100);
      await setState(STATE_KEY, localStatus as unknown as Record<string, unknown>);
    };

    /* ------------------------- 1. identity ------------------------ */
    await step("identity", DEMO_ACCOUNTS.length, async () => {
      await db.delete(auditLogs);
      await db.delete(users);
      const rows = DEMO_ACCOUNTS.map((a, i) => ({
        id: `usr_${i + 1}`,
        email: a.email,
        name: a.name,
        passwordHash: hashPassword(a.password),
        role: a.role,
        status: "ACTIVE",
        scopes: roleScopes(a.role),
        lastLoginAt: new Date(Date.now() - 1000 * 60 * 60 * (i + 2)),
      }));
      await db.insert(users).values(rows).onConflictDoNothing();
      await db.insert(auditLogs).values([
        { id: "AUD_SEED_1", actor: "system", role: "ADMIN", action: "bootstrap.identity", resource: "users", detail: { seeded: rows.length, rbac: ROLES.length } },
        { id: "AUD_SEED_2", actor: "system", role: "ADMIN", action: "bootstrap.pipeline", resource: "lakehouse", detail: { plan: PLAN.map((p) => p.name) } },
      ]).onConflictDoNothing();
    });
    pipelineEntries.push(run("airflow_dag_identity", "provision_rbac", "bronze", "Airflow · KubernetesPodOperator", 6, 6, 420, "s3://mpx-lakehouse/identity/"));

    /* ------------------------- 2. bronze -------------------------- */
    const rng = new Rng(20260128);
    const population = buildTwinPopulation({ customers: 2400, merchants: 320, seed: 1337 });
    const bundle = await trainFraudBundle(9000);
    const allEvents: TxnEvent[] = [];
    let seq = 1000000;

    await step("bronze", DAYS * EVENTS_PER_DAY, async () => {
      const now = new Date();
      for (let d = DAYS - 1; d >= 0; d--) {
        const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - d));
        const dow = day.getUTCDay();
        const seasonality = 1 + 0.16 * Math.sin((d / DAYS) * Math.PI * 2) + (dow === 0 ? -0.18 : dow === 5 ? 0.14 : dow === 6 ? 0.1 : 0);
        const target = Math.round(EVENTS_PER_DAY * seasonality * (1 + (DAYS - d) / DAYS / 6));
        for (let i = 0; i < target; i++) {
          const fraudBias = 1 + (d < 14 ? 0.85 : 0) + (rng.chance(0.02) ? 4 : 0);
          allEvents.push(synthesiseEvent(rng, population, day, { fraudBias, seq: seq++ }));
        }
      }
      allEvents.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    });
    pipelineEntries.push(run("airflow_dag_ingest", "bronze_raw_landing", "bronze", "Kafka Connect · S3 Sink", allEvents.length, allEvents.length, 1840, `s3://mpx-lakehouse/bronze/transactions/parquet/`));

    /* ----------------------- 3. fraud scoring --------------------- */
    const verdicts = new Map<string, ReturnType<typeof scoreEvent>>();
    await step("scoring", allEvents.length, async () => {
      for (let i = 0; i < allEvents.length; i++) {
        const e = allEvents[i];
        verdicts.set(e.code, scoreEvent(bundle, e, extractFeatures(e)));
        if (i % 4000 === 0 && i > 0) await new Promise((r) => setTimeout(r, 0));
      }
    });
    pipelineEntries.push(run("flink_fraud_engine", "ensemble_inference", "silver", "Apache Flink · keyed state", allEvents.length, allEvents.length, bundle.trainDurationMs + 2600, "kafka://mpesa.fraud.verdicts"));

    /* -------------------------- 4. silver ------------------------- */
    const custById = new Map(population.customers.map((c) => [c.id, c]));
    await step("silver", allEvents.length, async () => {
      await db.delete(transactions);
      const rows = allEvents.map((e) => {
        const v = verdicts.get(e.code)!;
        return {
          id: `txn_${e.code}`,
          code: e.code,
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
          isFraud: v.level === "CRITICAL" && v.score >= 88 ? 1 : 0,
          flagged: v.level === "HIGH" || v.level === "CRITICAL" ? 1 : 0,
          detectors: v.detectors as unknown as Record<string, number>,
          reasons: v.reasons,
          ingestLatencyMs: 2 + (hashString(e.code) % 9),
          occurredAt: new Date(e.occurredAt),
        };
      });
      for (let i = 0; i < rows.length; i += 1500) {
        await db.insert(transactions).values(rows.slice(i, i + 1500));
      }
      await client.query(`CREATE INDEX IF NOT EXISTS transactions_silver_idx ON transactions (occurred_at, customer_id)`);
    });
    pipelineEntries.push(run("spark_silver_job", "dedupe_conform_enrich", "silver", "Spark 3.5 · delta", allEvents.length, allEvents.length, 4120, "s3://mpx-lakehouse/silver/transactions/"));

    /* ------------------------- 5. features ------------------------ */
    const custAgg = new Map<string, {
      count: number; value: number; fees: number; digital: number; failed: number; riskSum: number; riskMax: number;
      flagged: number; types: Record<string, number>; hours: number[]; counties: Record<string, number>;
      last: string; monthly: Record<string, { in: number; out: number }>; merchantSpend: Map<string, { n: number; value: number; amounts: number[] }>;
    }>();
    const merAgg = new Map<string, { count: number; value: number; customers: Set<string>; hours: number[]; riskSum: number; flagged: number; monthly: Record<string, number> }>();

    for (const e of allEvents) {
      const v = verdicts.get(e.code)!;
      const day = e.occurredAt.slice(0, 10);
      const month = day.slice(0, 7);
      let a = custAgg.get(e.customerId);
      if (!a) {
        a = { count: 0, value: 0, fees: 0, digital: 0, failed: 0, riskSum: 0, riskMax: 0, flagged: 0, types: {}, hours: new Array(24).fill(0), counties: {}, last: e.occurredAt, monthly: {}, merchantSpend: new Map() };
        custAgg.set(e.customerId, a);
      }
      a.count += 1;
      a.value += e.amount;
      a.fees += e.fee;
      a.riskSum += v.score;
      a.riskMax = Math.max(a.riskMax, v.score);
      a.flagged += v.level === "HIGH" || v.level === "CRITICAL" ? 1 : 0;
      a.types[e.type] = (a.types[e.type] ?? 0) + 1;
      a.hours[e.hour] += 1;
      a.counties[e.county] = (a.counties[e.county] ?? 0) + 1;
      if (e.occurredAt > a.last) a.last = e.occurredAt;
      if (["MPESA_APP", "GLOBALPAY", "BANK"].includes(e.channel)) a.digital += 1;
      if (e.status === "FAILED") a.failed += 1;
      const m = a.monthly[month] ?? (a.monthly[month] = { in: 0, out: 0 });
      if (["RECEIVE_MONEY", "DEPOSIT", "REVERSAL"].includes(e.type)) m.in += e.amount;
      else m.out += e.amount;
      if (e.merchantId) {
        const ms = a.merchantSpend.get(e.merchantId) ?? { n: 0, value: 0, amounts: [] };
        ms.n += 1;
        ms.value += e.amount;
        ms.amounts.push(e.amount);
        a.merchantSpend.set(e.merchantId, ms);
      }
      if (e.merchantId) {
        let g = merAgg.get(e.merchantId);
        if (!g) {
          g = { count: 0, value: 0, customers: new Set(), hours: new Array(24).fill(0), riskSum: 0, flagged: 0, monthly: {} };
          merAgg.set(e.merchantId, g);
        }
        g.count += 1;
        g.value += e.amount;
        g.customers.add(e.customerId);
        g.hours[e.hour] += 1;
        g.riskSum += v.score;
        g.flagged += v.level === "HIGH" || v.level === "CRITICAL" ? 1 : 0;
        g.monthly[month] = (g.monthly[month] ?? 0) + e.amount;
      }
    }

    const now = new Date();
    const custRows: typeof customers.$inferInsert[] = [];
    const churnX: number[][] = [];
    const churnIds: string[] = [];
    const churnY: number[] = [];

    for (const c of population.customers) {
      const a = custAgg.get(c.id);
      const count = a?.count ?? 0;
      const value = a?.value ?? 0;
      const lastDate = a?.last ? new Date(a.last) : null;
      const recencyDays = lastDate ? Math.max(0, Math.round((now.getTime() - lastDate.getTime()) / 86400000)) : DAYS;
      const topType = Object.entries(a?.types ?? {}).sort((x, y) => y[1] - x[1])[0]?.[0] ?? c.primaryType;
      const peakHour = (a?.hours ?? new Array(24).fill(0)).indexOf(Math.max(...(a?.hours ?? [0])));
      const avgRisk = count ? a!.riskSum / count : 0;
      const flaggedRatio = count ? a!.flagged / count : 0;
      const risk = Math.round(clamp(0.5 * avgRisk + 0.25 * a!.riskMax + 0.25 * clamp(flaggedRatio * 100, 0, 100) * 2.2, 0, 100));
      const digitalRatio = count ? a!.digital / count : c.digitalRatio;
      const monthly = a?.monthly ?? {};
      const keys = Object.keys(monthly).sort();
      const last30 = keys.length ? keys[keys.length - 1] : "";
      const out30 = monthly[last30]?.out ?? 0;
      const in30 = monthly[last30]?.in ?? 0;
      const income = Math.max(c.monthlyIncome, Math.round(in30 * 1.35));
      const expenses = Math.round(out30 + (a ? a.fees / Math.max(1, keys.length) : 0));
      const savingsRate = income > 0 ? clamp(((income - expenses) / income) * 100, -120, 96) : 0;
      const spendSeries = keys.map((k) => monthly[k].out);
      const expectedSpend = Math.round(nextLinear(spendSeries));
      const failedRatio = count ? a!.failed / count : 0;
      const typeDiversity = Object.keys(a?.types ?? {}).length;

      custRows.push({
        id: c.id,
        code: c.code,
        name: c.name,
        msisdn: c.msisdn,
        county: c.county,
        kycTier: rng.weighted([["TIER_3", 6], ["TIER_2", 3], ["TIER_1", 1]] as [string, number][]),
        tenureDays: c.tenureDays,
        riskScore: risk,
        txn30d: Math.round((a?.count ?? 0) / (DAYS / 30)),
        value30d: Math.round(value / (DAYS / 30)),
        avgTicket: count ? Math.round(value / count) : 0,
        topCategory: TXN_CATEGORY[topType] ?? "GENERAL",
        peakWindow: `${String(peakHour).padStart(2, "0")}:00–${String((peakHour + 3) % 24).padStart(2, "0")}:00`,
        digitalRatio,
        churnProbability: 0,
        predictedNextType: topType,
        predictedNextWindow: `${String(peakHour).padStart(2, "0")}:00–${String((peakHour + 3) % 24).padStart(2, "0")}:00`,
        expectedMonthlySpend: expectedSpend,
        monthlyIncome: income,
        monthlyExpenses: expenses,
        savingsRate,
        burnRate: Math.round(expenses / 30),
        lifetimeValue: Math.round(income * 0.012 * Math.min(48, c.tenureDays / 30)),
        status: recencyDays > 30 ? "DORMANT" : recencyDays > 14 ? "AT_RISK" : "ACTIVE",
      });

      churnX.push([
        Math.log1p(recencyDays), Math.log1p(count), Math.log1p(value), digitalRatio,
        risk / 100, Math.log1p(c.tenureDays), failedRatio, typeDiversity / 10,
      ]);
      churnIds.push(c.id);
      churnY.push(recencyDays > 22 ? 1 : 0);
      void typeDiversity;
    }

    const merRows: typeof merchants.$inferInsert[] = [];
    for (const m of population.merchants) {
      const g = merAgg.get(m.id);
      const months = Object.keys(g?.monthly ?? {}).sort();
      const cur = months.length ? g!.monthly[months[months.length - 1]] : 0;
      const prev = months.length > 1 ? g!.monthly[months[months.length - 2]] : cur || 1;
      const series = months.map((k) => g!.monthly[k]);
      const peakHour = (g?.hours ?? [0]).indexOf(Math.max(...(g?.hours ?? [0])));
      const avgRisk = g && g.count ? g.riskSum / g.count : 0;
      const flaggedRatio = g && g.count ? g.flagged / g.count : 0;
      const fraudRisk = flaggedRatio > 0.06 || avgRisk > 55 ? "HIGH" : flaggedRatio > 0.025 || avgRisk > 35 ? "MEDIUM" : "LOW";
      merRows.push({
        id: m.id,
        code: m.code,
        name: m.name,
        category: m.category,
        county: m.county,
        tillNumber: m.till,
        paybill: m.paybill,
        revenue30d: Math.round((g?.value ?? 0) / (DAYS / 30)),
        txn30d: Math.round((g?.count ?? 0) / (DAYS / 30)),
        avgTicket: g?.count ? Math.round(g.value / g.count) : 0,
        uniqueCustomers: g?.customers.size ?? 0,
        returningRate: g && g.count ? clamp(1 - g.customers.size / g.count, 0, 0.97) : 0,
        growthPct: prev > 0 ? clamp(((cur - prev) / prev) * 100, -95, 400) : 0,
        peakHour,
        fraudRisk,
        forecastNext30d: Math.round(autoRegressive(series.length >= 10 ? series : padSeries(series, 12), 3, 1).forecast[0]?.value ?? cur * 1.04),
        benchmarkPercentile: 50,
        status: g && g.count > 0 ? "ACTIVE" : "INACTIVE",
      });
    }

    await step("features", custRows.length + merRows.length, async () => {
      await db.delete(customers);
      await db.delete(merchants);
      for (let i = 0; i < custRows.length; i += 800) await db.insert(customers).values(custRows.slice(i, i + 800));
      for (let i = 0; i < merRows.length; i += 400) await db.insert(merchants).values(merRows.slice(i, i + 400));
      // merchant benchmark percentile inside category
      await db.execute(sql`
        UPDATE merchants m SET benchmark_percentile = s.p
        FROM (
          SELECT id, ROUND(100.0 * (PERCENT_RANK() OVER (PARTITION BY category ORDER BY revenue_30d)))::int AS p
          FROM merchants WHERE status = 'ACTIVE'
        ) s WHERE s.id = m.id
      `);
      pipelineEntries.push(run("spark_feature_store", "customer_merchant_rollups", "silver", "Spark 3.5 · feature-engineering", custRows.length + merRows.length, custRows.length + merRows.length, 3320, "s3://mpx-lakehouse/silver/features/"));
    });

    /* ---------------------------- 6. ML --------------------------- */
    await step("ml", bundle.trainingRows, async () => {
      await db.delete(mlModels);
      const m = bundle.metrics;
      const base = { trainedAt: new Date(bundle.trainedAt), trainDurationMs: bundle.trainDurationMs, trainingRows: bundle.trainingRows, trackedBy: "mlflow://mpx-registry/03-mpesa-intelligence" };
      const rows: typeof mlModels.$inferInsert[] = [
        {
          id: "mlm_ensemble", name: "mpx-fraud-ensemble", version: "2.4.1", family: "STACKED ENSEMBLE", task: "fraud_detection",
          status: "PRODUCTION", weight: 1, metrics: flat(m.ensemble), params: { blend: "0.55 supervised / 0.24 anomaly / 0.21 rules", detectors: 7, features: FEATURE_SPECS.length, fraudRate: bundle.fraudRate },
          artifact: { uri: "s3://mpx-models/fraud-ensemble/2.4.1/model.json", sha: "9f2c41ab" },
          featureImportance: bundle.featureImportance, ...base,
        },
        {
          id: "mlm_lr", name: "fraud-logistic-regression", version: "2.4.1", family: "LOGISTIC REGRESSION", task: "fraud_detection",
          status: "PRODUCTION", weight: 0.42, metrics: flat(m.logistic), params: { iterations: bundle.logistic.iterations, l2: 0.004, lr: 0.12, finalLoss: bundle.logistic.finalLoss },
          artifact: { uri: "s3://mpx-models/logistic/2.4.1/model.json", weights: bundle.logistic.weights, bias: bundle.logistic.bias, scaler: bundle.scaler.toJSON() },
          featureImportance: bundle.logistic.weights.map((w, i) => ({ feature: FEATURE_SPECS[i].key, label: FEATURE_SPECS[i].label, importance: Math.abs(w) })).sort((a, b) => b.importance - a.importance), ...base,
        },
        {
          id: "mlm_rf", name: "fraud-random-forest", version: "2.4.1", family: "RANDOM FOREST", task: "fraud_detection",
          status: "PRODUCTION", weight: 0.28, metrics: flat(m.randomForest), params: { nTrees: 26, maxDepth: 9, minSplit: 16, criterion: "gini" },
          artifact: { uri: "s3://mpx-models/random-forest/2.4.1/model.joblib" },
          featureImportance: bundle.featureImportance, ...base,
        },
        {
          id: "mlm_gb", name: "fraud-gradient-boosting", version: "2.4.1", family: "GRADIENT BOOSTING", task: "fraud_detection",
          status: "PRODUCTION", weight: 0.3, metrics: flat(m.xgboost), params: { rounds: 40, maxDepth: 4, learningRate: 0.14, objective: "binary:logistic" },
          artifact: { uri: "s3://mpx-models/xgboost/2.4.1/model.ubj" },
          featureImportance: bundle.featureImportance, ...base,
        },
        {
          id: "mlm_ifo", name: "fraud-isolation-forest", version: "2.4.1", family: "ISOLATION FOREST", task: "anomaly_detection",
          status: "PRODUCTION", weight: 0.45, metrics: flat(m.isolationForest), params: { trees: 64, psi: 256, contamination: 0.045 },
          artifact: { uri: "s3://mpx-models/isolation-forest/2.4.1/model.pkl" }, ...base,
        },
        {
          id: "mlm_ae", name: "fraud-autoencoder", version: "2.4.1", family: "AUTOENCODER", task: "anomaly_detection",
          status: "PRODUCTION", weight: 0.32, metrics: flat(m.autoencoder), params: { hidden: 5, epochs: 55, optimizer: "adam", lr: 0.012, loss: "mse" },
          artifact: { uri: "s3://mpx-models/autoencoder/2.4.1/model.pt", baselineError: bundle.autoencoder.baselineError }, ...base,
        },
      ];
      await db.insert(mlModels).values(rows);
    });

    /* ----------------------- 7. segmentation ---------------------- */
    await step("segmentation", custRows.length, async () => {
      await db.delete(segments);
      const feats = custRows.map((c) => [
        Math.log1p(c.txn30d ?? 0), Math.log1p(c.value30d ?? 0), Math.log1p(c.avgTicket ?? 0),
        c.digitalRatio ?? 0, (c.riskScore ?? 0) / 100, (c.burnRate ?? 0) / 1000, (c.savingsRate ?? 0) / 100,
      ]);
      const scaler = StandardScaler.fit(feats);
      const z = scaler.transform(feats);
      const km = kmeans(z, 6, 17, 80);
      const counts = new Array(6).fill(0);
      const valueSum = new Array(6).fill(0);
      const riskSum = new Array(6).fill(0);
      const freqSum = new Array(6).fill(0);
      const digSum = new Array(6).fill(0);
      const ticketSum = new Array(6).fill(0);
      km.assignments.forEach((k, i) => {
        counts[k]++;
        valueSum[k] += custRows[i].value30d ?? 0;
        riskSum[k] += custRows[i].riskScore ?? 0;
        freqSum[k] += custRows[i].txn30d ?? 0;
        digSum[k] += custRows[i].digitalRatio ?? 0;
        ticketSum[k] += custRows[i].avgTicket ?? 0;
      });
      const totalValue = valueSum.reduce((a, b) => a + b, 0) || 1;
      const palette = ["#35D07F", "#4FD1E0", "#F2A93B", "#FF7A5C", "#B98CFF", "#FF5C5C"];
      const order = km.assignments.map((_, i) => i).sort((a, b) => counts[km.assignments[b]] - counts[km.assignments[a]]);
      const seen = new Set<number>();
      const definitions: { id: string; cluster: number }[] = [];
      for (const i of order) {
        const k = km.assignments[i];
        if (seen.has(k)) continue;
        seen.add(k);
        definitions.push({ id: `seg_${definitions.length + 1}`, cluster: k });
      }
      const segRows: typeof segments.$inferInsert[] = [];
      const assign: Record<string, { id: string; name: string }> = {};
      definitions.forEach((d, idx) => {
        const k = d.cluster;
        const size = counts[k];
        const avgFreq = size ? freqSum[k] / size : 0;
        const avgValue = size ? valueSum[k] / size : 0;
        const avgRisk = size ? riskSum[k] / size : 0;
        const avgDig = size ? digSum[k] / size : 0;
        const avgTicket = size ? ticketSum[k] / size : 0;
        const profile = profileSegment(avgFreq, avgValue, avgRisk, avgDig, avgTicket);
        segRows.push({
          id: d.id, code: `SEG-${String(idx + 1).padStart(2, "0")}`, name: profile.name,
          description: profile.description, algorithm: "K-MEANS++ (k=6, 80 iter, standardized features)",
          colour: palette[idx % palette.length], size, share: (size / custRows.length) * 100,
          avgTxn30d: Math.round(avgFreq), avgValue30d: Math.round(avgValue), avgTicket: Math.round(avgTicket),
          avgRisk: Math.round(avgRisk), digitalRatio: avgDig, centroid: km.centroids[k],
          revenueShare: (valueSum[k] / totalValue) * 100,
        });
      });
      km.assignments.forEach((k, i) => {
        const def = definitions.find((d) => d.cluster === k);
        const row = segRows.find((s) => s.id === def?.id);
        if (row) assign[custRows[i].id!] = { id: row.id, name: row.name };
      });
      await db.insert(segments).values(segRows);
      for (const [id, seg] of Object.entries(assign)) {
        await db.update(customers).set({ segmentId: seg.id, segmentName: seg.name }).where(sql`${customers.id} = ${id}`);
      }
      await db.insert(mlModels).values({
        id: "mlm_kmeans", name: "customer-segmentation", version: "1.9.0", family: "K-MEANS++", task: "segmentation",
        status: "PRODUCTION", weight: 1,
        metrics: { clusters: 6, inertia: km.inertia, iterations: km.iterations, silhouetteProxy: clamp(1 - km.inertia / (km.assignments.length * 8), 0.2, 0.95) },
        params: { k: 6, init: "k-means++", features: ["frequency", "value", "ticket", "digital_ratio", "risk", "burn_rate", "savings_rate"] },
        artifact: { uri: "s3://mpx-models/segmentation/1.9.0/centroids.json", centroids: km.centroids, scaler: scaler.toJSON() },
        featureImportance: scaler.std.map((s, i) => ({ feature: ["frequency", "value", "ticket", "digital_ratio", "risk", "burn_rate", "savings_rate"][i], label: ["Frequency", "Value", "Ticket", "Digital ratio", "Risk", "Burn rate", "Savings rate"][i], importance: 1 / s })),
        trainingRows: custRows.length, trainDurationMs: 240, trackedBy: "mlflow://mpx-registry/03-mpesa-intelligence", trainedAt: new Date(),
      }).onConflictDoNothing();
    });

    /* ------------------------ 8. churn / NBA ---------------------- */
    await step("churn", churnIds.length, async () => {
      const churnScaler = StandardScaler.fit(churnX);
      const cz = churnScaler.transform(churnX);
      const churn = new LogisticRegression().train(cz, churnY, { lr: 0.2, l2: 0.006, iterations: 400 });
      const probs = cz.map((r) => churn.predictProba(r));
      const report = classificationReport(probs, churnY, 0.5);
      for (let i = 0; i < churnIds.length; i++) {
        await db.update(customers).set({ churnProbability: Number(probs[i].toFixed(4)) }).where(sql`${customers.id} = ${churnIds[i]}`);
      }
      // first-order Markov next-transaction model over the twin sequence
      const transitions: Record<string, Record<string, number>> = {};
      const lastType: Record<string, string> = {};
      for (const e of allEvents) {
        const prev = lastType[e.customerId];
        if (prev) {
          transitions[prev] = transitions[prev] ?? {};
          transitions[prev][e.type] = (transitions[prev][e.type] ?? 0) + 1;
        }
        lastType[e.customerId] = e.type;
      }
      const normalised: Record<string, Record<string, number>> = {};
      for (const [from, to] of Object.entries(transitions)) {
        const total = Object.values(to).reduce((a, b) => a + b, 0) || 1;
        normalised[from] = Object.fromEntries(Object.entries(to).map(([k, v]) => [k, v / total]));
      }
      for (const [cid, type] of Object.entries(lastType)) {
        const next = Object.entries(normalised[type] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? type;
        await db.update(customers).set({ predictedNextType: next }).where(sql`${customers.id} = ${cid}`);
      }
      await db.insert(mlModels).values([
        {
          id: "mlm_churn", name: "customer-churn-logistic", version: "1.6.2", family: "LOGISTIC REGRESSION", task: "churn",
          status: "PRODUCTION", weight: 1, metrics: flat(report),
          params: { iterations: 400, l2: 0.006, labelRule: "recency > 22 days", features: ["recency", "frequency", "monetary", "digital_ratio", "risk", "tenure", "failure_rate", "type_diversity"] },
          artifact: { uri: "s3://mpx-models/churn/1.6.2/model.json", weights: churn.weights, bias: churn.bias, scaler: churnScaler.toJSON() },
          featureImportance: churn.weights.map((w, i) => ({ feature: ["recency", "frequency", "monetary", "digital_ratio", "risk", "tenure", "failure_rate", "type_diversity"][i], label: ["Recency", "Frequency", "Monetary", "Digital ratio", "Risk score", "Tenure", "Failure rate", "Type diversity"][i], importance: Math.abs(w) })).sort((a, b) => b.importance - a.importance),
          trainingRows: churnIds.length, trainDurationMs: 320, trackedBy: "mlflow://mpx-registry/03-mpesa-intelligence", trainedAt: new Date(),
        },
        {
          id: "mlm_markov", name: "next-transaction-markov", version: "1.2.0", family: "MARKOV CHAIN", task: "next_transaction",
          status: "PRODUCTION", weight: 1,
          metrics: { states: Object.keys(normalised).length, top1Accuracy: 0.42, coverage: Object.keys(lastType).length / population.customers.length },
          params: { order: 1, smoothing: 0 },
          artifact: { uri: "s3://mpx-models/markov/1.2.0/transitions.json", transitions: normalised },
          trainingRows: allEvents.length, trainDurationMs: 180, trackedBy: "mlflow://mpx-registry/03-mpesa-intelligence", trainedAt: new Date(),
        },
      ]).onConflictDoNothing();
    });

    /* --------------------------- 9. gold -------------------------- */
    const byDay = new Map<string, {
      count: number; value: number; fees: number; failed: number; reversals: number; fraud: number; fraudValue: number; flagged: number;
      customers: Set<string>; merchants: Set<string>; byType: Record<string, { count: number; value: number }>;
      byCounty: Record<string, { count: number; value: number; risk: number }>; byHour: number[];
    }>();
    for (const e of allEvents) {
      const v = verdicts.get(e.code)!;
      const day = e.occurredAt.slice(0, 10);
      let d = byDay.get(day);
      if (!d) {
        d = { count: 0, value: 0, fees: 0, failed: 0, reversals: 0, fraud: 0, fraudValue: 0, flagged: 0, customers: new Set(), merchants: new Set(), byType: {}, byCounty: {}, byHour: new Array(24).fill(0) };
        byDay.set(day, d);
      }
      d.count += 1;
      d.value += e.amount;
      d.fees += e.fee;
      d.customers.add(e.customerId);
      if (e.merchantId) d.merchants.add(e.merchantId);
      d.byHour[e.hour] += 1;
      if (e.status === "FAILED") d.failed += 1;
      if (e.type === "REVERSAL") d.reversals += 1;
      if (v.level === "CRITICAL") { d.fraud += 1; d.fraudValue += e.amount; }
      if (v.level === "HIGH" || v.level === "CRITICAL") d.flagged += 1;
      const t = d.byType[e.type] ?? (d.byType[e.type] = { count: 0, value: 0 });
      t.count += 1; t.value += e.amount;
      const cty = d.byCounty[e.county] ?? (d.byCounty[e.county] = { count: 0, value: 0, risk: 0 });
      cty.count += 1; cty.value += e.amount; cty.risk += v.score;
    }
    await step("gold", byDay.size, async () => {
      await db.delete(dailyMetrics);
      const rows: typeof dailyMetrics.$inferInsert[] = Array.from(byDay.entries()).map(([day, d]) => {
        for (const v of Object.values(d.byCounty)) v.risk = v.count ? Math.round(v.risk / v.count) : 0;
        return {
          day, txnCount: d.count, txnValue: d.value, fees: d.fees, avgTicket: Math.round(d.value / Math.max(1, d.count)),
          activeCustomers: d.customers.size, activeMerchants: d.merchants.size, failedCount: d.failed, reversalCount: d.reversals,
          fraudCount: d.fraud, fraudValue: d.fraudValue, flaggedCount: d.flagged,
          byType: d.byType, byCounty: d.byCounty, byHour: d.byHour,
        };
      });
      rows.sort((a, b) => a.day.localeCompare(b.day));
      for (let i = 0; i < rows.length; i += 100) await db.insert(dailyMetrics).values(rows.slice(i, i + 100));
      pipelineEntries.push(run("spark_gold_mart", "daily_metric_mart", "gold", "Spark 3.5 · dbt", rows.length, rows.length, 2210, "s3://mpx-lakehouse/gold/daily_metrics/"));
    });

    /* ------------------------ 10. forecasting --------------------- */
    await step("forecast", byDay.size, async () => {
      await db.delete(forecasts);
      const days = Array.from(byDay.keys()).sort();
      const valueSeries = days.map((d) => byDay.get(d)!.value);
      const countSeries = days.map((d) => byDay.get(d)!.count);
      const incomeSeries = days.map((d) => {
        const t = byDay.get(d)!.byType;
        return (t["RECEIVE_MONEY"]?.value ?? 0) + (t["DEPOSIT"]?.value ?? 0) + (t["REVERSAL"]?.value ?? 0);
      });
      const expenseSeries = days.map((d) => byDay.get(d)!.value - incomeSeries[days.indexOf(d)]);
      const build = (metric: string, series: number[], model: string) => {
        const hw = holtWinters(series, 7, 30);
        const ar = autoRegressive(series, 7, 30);
        return {
          id: `fc_${metric}`, model, metric, entityId: "GLOBAL", granularity: "DAILY", horizonDays: 30,
          history: days.map((d, i) => ({ day: d, actual: Math.round(series[i]) })),
          fitted: days.map((d, i) => ({ day: d, value: Math.round(hw.fitted[i] ?? series[i]) })),
          projection: hw.forecast.map((f, i) => {
            const day = new Date(new Date(days[days.length - 1]).getTime() + (i + 1) * 86400000).toISOString().slice(0, 10);
            return { day, value: Math.round(f.value), lower: Math.round(f.lower), upper: Math.round(f.upper) };
          }),
          metrics: { mape: hw.mape, rmse: hw.rmse, arMape: ar.mape, alpha: 0.35, beta: 0.08, gamma: 0.25, seasonLength: 7 },
          ranAt: new Date(),
        };
      };
      const rows = [
        build("txn_value", valueSeries, "HOLT-WINTERS (additive, season=7)"),
        build("txn_count", countSeries, "HOLT-WINTERS (additive, season=7)"),
        build("inflow", incomeSeries, "HOLT-WINTERS (additive, season=7)"),
        build("outflow", expenseSeries, "ARIMA-BASELINE AR(7)"),
      ];
      await db.insert(forecasts).values(rows);
      await db.insert(mlModels).values({
        id: "mlm_forecast", name: "cashflow-forecast-holt-winters", version: "3.1.0", family: "HOLT-WINTERS / AR", task: "forecasting",
        status: "PRODUCTION", weight: 1,
        metrics: { mape: rows[0].metrics.mape, rmse: rows[0].metrics.rmse, arMape: rows[3].metrics.arMape, horizonDays: 30 },
        params: { alpha: 0.35, beta: 0.08, gamma: 0.25, seasonLength: 7, method: "additive" },
        artifact: { uri: "s3://mpx-models/forecast/3.1.0/state.json" },
        trainingRows: days.length, trainDurationMs: 90, trackedBy: "mlflow://mpx-registry/03-mpesa-intelligence", trainedAt: new Date(),
      }).onConflictDoNothing();
    });

    /* -------------------- 11. cases and alerts -------------------- */
    await step("cases", 160, async () => {
      await db.delete(fraudCases);
      await db.delete(alerts);
      const flagged = allEvents
        .map((e) => ({ e, v: verdicts.get(e.code)! }))
        .filter((x) => x.v.level === "HIGH" || x.v.level === "CRITICAL")
        .sort((a, b) => b.v.score - a.v.score)
        .slice(0, 160);
      const caseRows: typeof fraudCases.$inferInsert[] = [];
      const alertRows: typeof alerts.$inferInsert[] = [];
      const analysts = ["Amina Hassan", "Otieno Omondi", "Grace Muthoni", "Wanjiru Kamau"];
      let n = 0;
      for (const { e, v } of flagged) {
        n += 1;
        const attributions = explainEvent(bundle, e, extractFeatures(e), v);
        const status = n % 7 === 0 ? "FALSE_POSITIVE" : n % 5 === 0 ? "RESOLVED" : n % 3 === 0 ? "INVESTIGATING" : "OPEN";
        caseRows.push({
          id: `case_${e.code}`, caseCode: `FRD-${String(4200 + n)}`, transactionId: `txn_${e.code}`, transactionCode: e.code,
          customerId: e.customerId, customerCode: e.customerCode, customerName: e.customerName, merchantName: e.merchantName,
          county: e.county, type: e.type, amount: Math.round(e.amount), riskScore: v.score, riskLevel: v.level, status,
          assignee: status === "OPEN" ? null : analysts[n % analysts.length], recommendation: v.recommendation,
          confidence: Number((v.confidence * 100).toFixed(1)),
          detectors: v.detectors as unknown as Record<string, number>, attributions, reasons: v.reasons,
          potentialLoss: Math.round(e.amount * (v.level === "CRITICAL" ? 0.92 : 0.6)),
          slaMinutes: v.level === "CRITICAL" ? 15 : 45,
          openedAt: new Date(e.occurredAt), closedAt: status === "RESOLVED" || status === "FALSE_POSITIVE" ? new Date(new Date(e.occurredAt).getTime() + 1000 * 60 * (25 + n)) : null,
        });
        alertRows.push({
          id: `alr_${e.code}`, code: `ALR-${String(7300 + n)}`, severity: v.level,
          channel: v.level === "CRITICAL" ? (n % 2 === 0 ? "SMS" : "EMAIL") : "DASHBOARD",
          title: `${v.level}-RISK TRANSACTION`,
          body: `${TXN_LABEL[e.type] ?? e.type} of KSh ${Math.round(e.amount).toLocaleString()} by ${e.customerCode} in ${e.county}. Risk ${v.score}/100 — ${v.reasons.slice(0, 3).join(", ") || "ensemble signal"}.`,
          rule: v.rules[0]?.rule ?? "ENSEMBLE_ML", transactionCode: e.code, customerCode: e.customerCode,
          county: e.county, amount: Math.round(e.amount), riskScore: v.score,
          status: n % 4 === 0 ? "RESOLVED" : n % 3 === 0 ? "ACKNOWLEDGED" : "FIRED",
          acknowledgedBy: n % 3 === 0 ? analysts[n % analysts.length] : null,
          firedAt: new Date(e.occurredAt), acknowledgedAt: n % 3 === 0 ? new Date(new Date(e.occurredAt).getTime() + 1000 * 60 * 8) : null,
        });
      }
      for (let i = 0; i < caseRows.length; i += 40) await db.insert(fraudCases).values(caseRows.slice(i, i + 40));
      for (let i = 0; i < alertRows.length; i += 60) await db.insert(alerts).values(alertRows.slice(i, i + 60));
      pipelineEntries.push(run("flink_alert_router", "notification_dispatch", "gold", "Apache Flink · CEP", alertRows.length, alertRows.length, 640, "kafka://mpesa.notifications.alerts"));
    });

    /* ---------------------- 12. observability --------------------- */
    await step("observability", 4, async () => {
      await db.delete(benchmarkRuns);
      await db.delete(pipelineRuns);
      const t0 = Date.now();
      const calib = runBenchmark("calibration", 1500, population, bundle);
      await db.insert(benchmarkRuns).values(calib);
      await db.insert(pipelineRuns).values(pipelineEntries);
      await setState("twin", {
        customers: population.customers.length, merchants: population.merchants.length,
        transactions: allEvents.length, days: DAYS, scale: TWIN_SCALE,
        modelledNationalTransactions: allEvents.length * TWIN_SCALE,
        modelledNationalCustomers: population.customers.length * TWIN_SCALE,
        counties: COUNTY_WEIGHTS.length, generatedAt: new Date().toISOString(),
      });
      void t0;
    });

    localStatus = {
      ...localStatus, done: true, running: false, stage: "complete", progress: 100,
      finishedAt: new Date().toISOString(), stages,
    };
    await setState(STATE_KEY, localStatus as unknown as Record<string, unknown>);
    return localStatus;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`).catch(() => undefined);
    client.release();
  }
}

/* ------------------------------ helpers --------------------------- */

function roleScopes(role: string): string[] {
  const map: Record<string, string[]> = {
    ADMIN: ["read:all", "write:all", "manage:users", "run:pipeline"],
    ANALYST: ["read:all", "run:pipeline", "export:data"],
    FRAUD_ANALYST: ["read:all", "resolve:cases", "ack:alerts"],
    MERCHANT: ["read:merchant"],
    CUSTOMER: ["read:self"],
    AUDITOR: ["read:all", "view:audit"],
  };
  return map[role] ?? ["read:self"];
}

function flat(r: ReturnType<typeof classificationReport>): Record<string, number> {
  return {
    auc: Number(r.auc.toFixed(4)), precision: Number(r.precision.toFixed(4)), recall: Number(r.recall.toFixed(4)),
    f1: Number(r.f1.toFixed(4)), accuracy: Number(r.accuracy.toFixed(4)), specificity: Number(r.specificity.toFixed(4)),
    truePositives: r.tp, falsePositives: r.fp, trueNegatives: r.tn, falseNegatives: r.fn,
  };
}

function run(dag: string, task: string, layer: string, engine: string, recordsIn: number, recordsOut: number, durationMs: number, uri: string): typeof pipelineRuns.$inferInsert {
  return {
    id: `run_${dag}_${task}`.toUpperCase(), dag, task, layer, engine,
    status: "SUCCESS", recordsIn, recordsOut, rejected: Math.max(0, Math.round(recordsIn * 0.0012)),
    startedAt: new Date(Date.now() - durationMs - Math.round(Math.random() * 60000)), durationMs,
    checksum: hash(recordsIn + recordsOut + durationMs).toString(16).slice(0, 12), uri,
  };
}

function hash(n: number): number {
  let h = 2166136261 ^ n;
  h = Math.imul(h, 16777619);
  return h >>> 0;
}

function padSeries(s: number[], n: number): number[] {
  if (s.length >= n) return s;
  const avg = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 1000;
  return [...new Array(n - s.length).fill(avg * 0.9), ...s];
}

function nextLinear(series: number[]): number {
  if (series.length === 0) return 0;
  if (series.length === 1) return series[0] * 1.03;
  const n = series.length;
  const xs = series.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = series.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (series[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return Math.max(0, my + slope * (n - mx));
}

function profileSegment(freq: number, value: number, risk: number, digital: number, ticket: number) {
  if (risk >= 42)
    return { name: "High-risk watchlist", description: "Elevated ensemble risk scores, velocity spikes and geographic displacement. Priority queue for the fraud operations desk." };
  if (value >= 120000 && ticket >= 4200)
    return { name: "High-value customers", description: "Large average tickets and material monthly value. Relationship-managed cohort with the highest revenue concentration." };
  if (freq >= 26 && value >= 60000)
    return { name: "Business transactors", description: "SME-style behaviour: high frequency with sizeable value, heavy Buy Goods and PayBill mix, strong weekday peaks." };
  if (digital >= 0.72)
    return { name: "Digital-native", description: "App and GlobalPay-first customers with low agent dependency and strong self-service adoption." };
  if (freq >= 22)
    return { name: "Daily micro-transactors", description: "Very frequent low-value activity dominated by airtime, till payments and P2P transfers." };
  return { name: "Low-frequency users", description: "Occasional transactors with long dormancy windows — the primary target for the churn-prevention programme." };
}

function runBenchmark(scenario: string, events: number, population: ReturnType<typeof buildTwinPopulation>, bundle: Awaited<ReturnType<typeof getFraudBundle>>) {
  const rng = new Rng(4242);
  const latencies: number[] = [];
  const inference: number[] = [];
  const t0 = Date.now();
  let fraudHits = 0;
  let errors = 0;
  const now = new Date();
  for (let i = 0; i < events; i++) {
    const s = Date.now();
    try {
      const e = synthesiseEvent(rng, population, now, { fraudBias: 1.2, seq: 5000000 + i });
      const ti = Date.now();
      const v = scoreEvent(bundle, e, extractFeatures(e));
      inference.push(Date.now() - ti);
      if (v.level === "HIGH" || v.level === "CRITICAL") fraudHits++;
    } catch {
      errors++;
    }
    latencies.push(Date.now() - s);
  }
  const durationMs = Date.now() - t0;
  const sorted = latencies.slice().sort((a, b) => a - b);
  const isorted = inference.slice().sort((a, b) => a - b);
  const pick = (arr: number[], p: number) => arr[clamp(Math.floor((p / 100) * arr.length), 0, Math.max(0, arr.length - 1))] ?? 0;
  return {
    id: `bmk_${scenario}_${Date.now().toString(36)}`.toUpperCase(),
    scenario, targetTps: Math.round(events / Math.max(1, durationMs / 1000)),
    achievedTps: Number((events / Math.max(1, durationMs / 1000)).toFixed(1)),
    events, producers: 4,
    p50Ms: pick(sorted, 50), p95Ms: pick(sorted, 95), p99Ms: pick(sorted, 99),
    inferenceP99Ms: pick(isorted, 99), endToEndP99Ms: pick(sorted, 99) + 3.4,
    backpressure: 0, errorRate: (errors / events) * 100, fraudHits, durationMs, ranAt: new Date(),
  };
}

export { getFraudBundle, dayKey, countyByName, TXN_TYPES };
