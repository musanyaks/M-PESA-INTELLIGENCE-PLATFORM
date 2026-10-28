import { db } from "@/db";
import { sql } from "drizzle-orm";
import { api, envelope } from "@/lib/api";
import { getSegments } from "@/lib/queries";
import { ensureReady } from "@/lib/seed";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async () => {
    await ensureReady();
    const rows = await getSegments();
    const matrix = await db.execute(sql`
      SELECT s.name AS segment, s.colour, count(*)::text AS customers,
             coalesce(sum(c.value_30d),0)::text AS value,
             round(avg(c.risk_score))::text AS risk,
             round(avg(c.churn_probability)::numeric,3)::text AS churn,
             round(avg(c.savings_rate)::numeric,1)::text AS savings,
             round(avg(c.digital_ratio)::numeric,3)::text AS digital
      FROM customers c JOIN segments s ON s.id = c.segment_id
      GROUP BY s.name, s.colour, s.size ORDER BY s.size DESC
    `) as unknown as { rows: Record<string, string>[] };
    const transitions = await db.execute(sql`
      SELECT s.name AS segment, c.status, count(*)::text AS customers
      FROM customers c JOIN segments s ON s.id = c.segment_id
      GROUP BY s.name, c.status
    `) as unknown as { rows: { segment: string; status: string; customers: string }[] };
    return envelope(
      {
        algorithm: "K-Means++ · k=6 · standardized 7-feature behavioural space",
        features: ["frequency_30d", "value_30d", "average_ticket", "digital_ratio", "risk_score", "burn_rate", "savings_rate"],
        segments: rows.map((r) => ({
          id: r.code, name: r.name, description: r.description, algorithm: r.algorithm, colour: r.colour,
          size: r.size, share: Number(r.share.toFixed(2)), avg_txn_30d: r.avgTxn30d, avg_value_30d: r.avgValue30d,
          avg_ticket: r.avgTicket, avg_risk: r.avgRisk, digital_ratio: Number(r.digitalRatio.toFixed(3)),
          revenue_share: Number(r.revenueShare.toFixed(2)), centroid: r.centroid,
        })),
      },
      { total_customers: rows.reduce((a, r) => a + r.size, 0), segment_matrix: matrix.rows, lifecycle: transitions.rows },
    );
  },
  { audit: "api.segments.read" },
);
