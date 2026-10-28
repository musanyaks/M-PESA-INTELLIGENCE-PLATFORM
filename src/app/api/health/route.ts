import { NextResponse } from "next/server";
import { pool } from "@/db";
import { streamStatus } from "@/lib/stream";
import { API_VERSION } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  let database = "up";
  let latency = 0;
  let seeded = false;
  try {
    const t0 = Date.now();
    const res = await pool.query(`SELECT 1 AS ok, (SELECT count(*)::int FROM system_state WHERE key='bootstrap' AND value->>'done' = 'true') AS seeded`);
    latency = Date.now() - t0;
    seeded = Boolean(res.rows[0]?.seeded);
  } catch (err) {
    database = "down";
    latency = Date.now() - started;
    void err;
  }
  const stream = streamStatus();
  return NextResponse.json({
    status: database === "up" ? "ok" : "degraded",
    version: API_VERSION,
    service: "mpesa-intelligence-platform",
    data: {
      database,
      database_latency_ms: latency,
      lakehouse_materialised: seeded,
      stream: { running: stream.running, live_tps: stream.liveTps, produced: stream.produced, subscribers: stream.subscribers },
      models: "in-process runtime (logistic · random-forest · gradient-boosting · isolation-forest · autoencoder · mahalanobis)",
      uptime_seconds: Math.round(process.uptime()),
    },
    meta: { generated_at: new Date().toISOString(), took_ms: Date.now() - started },
  });
}
