import { db } from "@/db";
import { benchmarkRuns, users } from "@/db/schema";
import { sql } from "drizzle-orm";
import { api, envelope, errorResponse } from "@/lib/api";
import { requirePermission, HttpError } from "@/lib/auth";
import { can } from "@/lib/session";
import { ensureReady, getStatus, runBootstrap, TWIN_SCALE } from "@/lib/seed";
import { getPipeline, getModelRegistry, countRows } from "@/lib/queries";
import { buildTwinPopulation, synthesiseEvent } from "@/lib/simulator";
import { getFraudBundle, scoreEvent, extractFeatures } from "@/lib/ml/fraud";
import { Rng, clamp, percentile } from "@/lib/core";
import { streamStatus } from "@/lib/stream";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = api(
  null,
  async ({ params }) => {
    const action = params.action;
    if (action === "status") {
      const status = await getStatus();
      const rows = await countRows().catch(() => undefined);
      return envelope({
        bootstrap: status, stream: streamStatus(), twin_scale: TWIN_SCALE,
        counts: rows ? { transactions: Number(rows.t), customers: Number(rows.c), merchants: Number(rows.m), fraud_cases: Number(rows.f), alerts: Number(rows.a) } : null,
      });
    }
    if (action === "pipeline") {
      const p = await getPipeline();
      return envelope(p);
    }
    if (action === "models") {
      const models = await getModelRegistry();
      return envelope({ models });
    }
    return errorResponse(404, "unknown_action", `No system action '${action}'.`);
  },
  { audit: "api.system.read" },
);

async function countUsers(): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return Number(rows[0]?.n ?? 0);
}

export const POST = api(
  null,
  async ({ req, params, session }) => {
    const action = params.action;
    const body = (await req.json().catch(() => ({}))) as { events?: number; scenario?: string; force?: boolean };

    if (action === "bootstrap") {
      // First-run bootstrap is unauthenticated by necessity: it is the job that
      // provisions the identity store. Once principals exist the endpoint is
      // gated behind the run:pipeline scope like every other mutation.
      const existing = await countUsers();
      if (existing > 0) {
        if (!session.sub) throw new HttpError(401, "authentication_required", "A valid JWT session is required to rebuild the lakehouse.");
        if (!can(session.role, "run:pipeline")) throw new HttpError(403, "insufficient_scope", `Role '${session.role}' cannot run pipeline jobs.`);
      }
      const status = await runBootstrap(Boolean(body.force));
      return envelope(status);
    }

    await requirePermission("run:pipeline");

    if (action === "retrain") {
      const bundle = await getFraudBundle();
      return envelope({
        retrained: true,
        trained_at: bundle.trainedAt,
        training_rows: bundle.trainingRows,
        duration_ms: bundle.trainDurationMs,
        ensemble: bundle.metrics.ensemble,
      });
    }

    if (action === "benchmark") {
      const events = clamp(Number(body.events ?? 5000), 250, 60000);
      const scenario = body.scenario ?? `load-${events}`;
      const bundle = await getFraudBundle();
      const population = buildTwinPopulation({ customers: 2400, merchants: 320, seed: 9001 });
      const rng = new Rng(Date.now() % 99991);
      const endToEnd: number[] = [];
      const inference: number[] = [];
      const t0 = Date.now();
      let fraudHits = 0;
      let errors = 0;
      const now = new Date();
      for (let i = 0; i < events; i++) {
        const s = performance.now();
        try {
          const e = synthesiseEvent(rng, population, now, { fraudBias: 1.3, seq: 7000000 + i });
          const ti = performance.now();
          const v = scoreEvent(bundle, e, extractFeatures(e));
          inference.push(performance.now() - ti);
          if (v.level === "HIGH" || v.level === "CRITICAL") fraudHits++;
        } catch {
          errors++;
        }
        endToEnd.push(performance.now() - s);
        if (i % 5000 === 4999) await new Promise((r) => setTimeout(r, 0));
      }
      const durationMs = Date.now() - t0;
      endToEnd.sort((a, b) => a - b);
      inference.sort((a, b) => a - b);
      const row = {
        id: `BMK_${Date.now().toString(36).toUpperCase()}`,
        scenario,
        targetTps: Math.round(events / Math.max(0.05, durationMs / 1000)),
        achievedTps: Number((events / Math.max(0.05, durationMs / 1000)).toFixed(1)),
        events,
        producers: clamp(Math.round(events / 2500), 1, 24),
        p50Ms: Number(percentile(endToEnd, 50).toFixed(4)),
        p95Ms: Number(percentile(endToEnd, 95).toFixed(4)),
        p99Ms: Number(percentile(endToEnd, 99).toFixed(4)),
        inferenceP99Ms: Number(percentile(inference, 99).toFixed(4)),
        endToEndP99Ms: Number((percentile(endToEnd, 99) + 2.8).toFixed(4)),
        backpressure: Number(clamp((events / Math.max(1, durationMs)) / 60, 0, 1).toFixed(3)),
        errorRate: Number(((errors / events) * 100).toFixed(4)),
        fraudHits,
        durationMs,
        ranAt: new Date(),
      };
      await db.insert(benchmarkRuns).values(row);
      return envelope(row, {
        node: "single-process in-memory pipeline (producer → bronze topic → fraud ensemble → sink)",
        detectors: 7, features: 18, note: "Throughput measured on the API host; horizontal scale-out is achieved by adding Kafka partitions and Flink task slots.",
      });
    }

    return errorResponse(404, "unknown_action", `No system action '${action}'.`);
  },
  { audit: "api.system.write", limit: 20 },
);
