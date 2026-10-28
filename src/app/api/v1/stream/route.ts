import { NextRequest } from "next/server";
import { api, envelope, errorResponse } from "@/lib/api";
import { startStream, stopStream, streamStatus, subscribe, recentEvents } from "@/lib/stream";
import { ensureReady } from "@/lib/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/v1/stream — Server-Sent Events feed of the live transaction backbone.
 * Replay buffer first, then push every scored event from the fraud engine.
 */
export async function GET(req: NextRequest) {
  const accept = req.headers.get("accept") ?? "";
  if (!accept.includes("text/event-stream")) {
    const status = streamStatus();
    return envelope({ ...status, recent: recentEvents(20).map((r) => serialise(r)) });
  }
  await ensureReady();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send("status", streamStatus());
      for (const r of recentEvents(12)) send("transaction", serialise(r));

      const unsubscribe = subscribe((payload) => send("transaction", serialise(payload)));
      const heartbeat = setInterval(() => send("heartbeat", { t: Date.now(), ...pickStatus() }), 5000);
      const statusTick = setInterval(() => send("status", streamStatus()), 10_000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        clearInterval(statusTick);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function pickStatus() {
  const s = streamStatus();
  return { live_tps: s.liveTps, produced: s.produced, fraud_hits: s.fraudHits, p99: s.latency.p99 };
}

function serialise(r: ReturnType<typeof recentEvents>[number]) {
  return {
    transaction_id: r.event.code,
    customer_id: r.event.customerCode,
    customer_name: r.event.customerName,
    merchant: r.event.merchantName,
    transaction_type: r.event.type,
    amount: r.event.amount,
    fee: r.event.fee,
    location: r.event.county,
    channel: r.event.channel,
    status: r.event.status,
    risk_score: r.verdict.score,
    risk_level: r.verdict.level,
    recommendation: r.verdict.recommendation,
    reasons: r.verdict.reasons,
    detectors: r.verdict.detectors,
    timestamp: r.event.occurredAt,
    topic: r.meta.topic,
    partition: r.meta.partition,
    offset: r.meta.offset,
    inference_ms: Number(r.meta.inferenceMs.toFixed(2)),
    end_to_end_ms: Number(r.meta.endToEndMs.toFixed(2)),
  };
}

/** POST /api/v1/stream — start / stop / throttle the synthetic producer. */
export const POST = api(
  "run:pipeline",
  async ({ req }) => {
    const body = (await req.json().catch(() => ({}))) as { action?: string; rate?: number };
    const action = body.action ?? "start";
    if (action === "stop") return envelope(stopStream());
    if (action === "status") return envelope(streamStatus());
    if (action === "start") {
      const res = await startStream(Number(body.rate ?? 6));
      return envelope({ ...res, status: streamStatus() });
    }
    return errorResponse(400, "invalid_action", "action must be start | stop | status");
  },
  { audit: "api.stream.control", limit: 60 },
);
