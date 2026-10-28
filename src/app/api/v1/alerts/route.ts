import { db } from "@/db";
import { alerts } from "@/db/schema";
import { sql } from "drizzle-orm";
import { api, envelope, errorResponse } from "@/lib/api";
import { getAlerts, getAlertStats } from "@/lib/queries";
import { ensureReady } from "@/lib/seed";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async ({ search }) => {
    await ensureReady();
    const rows = await getAlerts({
      severity: search.get("severity") ?? undefined,
      status: search.get("status") ?? undefined,
      limit: Number(search.get("limit") ?? 80),
    });
    const stats = await getAlertStats();
    return envelope(
      {
        count: rows.length,
        alerts: rows.map((r) => ({
          alert_id: r.code, severity: r.severity, channel: r.channel, title: r.title, body: r.body,
          rule: r.rule, transaction_id: r.transaction_code, customer_id: r.customer_code,
          county: r.county, amount: r.amount, risk_score: r.risk_score, status: r.status,
          acknowledged_by: r.acknowledged_by, fired_at: r.fired_at,
        })),
      },
      {
        routing: [
          { channel: "SMS", provider: "synthetic-gateway", latency_ms: 820 },
          { channel: "EMAIL", provider: "synthetic-smtp", latency_ms: 1450 },
          { channel: "DASHBOARD", provider: "sse://mpesa.notifications.alerts", latency_ms: 40 },
          { channel: "WEBHOOK", provider: "soc-bridge", latency_ms: 260 },
        ],
        stats,
      },
    );
  },
  { audit: "api.alerts.read" },
);

export const POST = api(
  "ack:alerts",
  async ({ req, session }) => {
    const body = (await req.json().catch(() => ({}))) as { alert_id?: string; status?: string };
    if (!body.alert_id) return errorResponse(400, "invalid_payload", "alert_id is required.");
    const status = body.status ?? "ACKNOWLEDGED";
    const rows = await db.select().from(alerts).where(sql`${alerts.code} = ${body.alert_id} OR ${alerts.id} = ${body.alert_id}`).limit(1);
    if (!rows[0]) return errorResponse(404, "not_found", `No alert matches '${body.alert_id}'.`);
    await db
      .update(alerts)
      .set({ status, acknowledgedBy: session.email ?? null, acknowledgedAt: new Date() })
      .where(sql`${alerts.id} = ${rows[0].id}`);
    return envelope({ alert_id: rows[0].code, status, acknowledged_by: session.email });
  },
  { audit: "api.alerts.ack", limit: 60 },
);
