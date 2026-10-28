import { db } from "@/db";
import { sql } from "drizzle-orm";
import { api, envelope, maskCustomer } from "@/lib/api";
import { getCustomerList, getSegments } from "@/lib/queries";
import { ensureReady } from "@/lib/seed";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async ({ search, session }) => {
    await ensureReady();
    const rows = await getCustomerList({
      search: search.get("q") ?? undefined,
      segment: search.get("segment") ?? undefined,
      risk: search.get("risk") ?? undefined,
      sort: search.get("sort") ?? "value",
      limit: Number(search.get("limit") ?? 50),
    });
    const facets = await db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM customers) AS total,
        (SELECT count(*)::int FROM customers WHERE status='ACTIVE') AS active,
        (SELECT count(*)::int FROM customers WHERE status='AT_RISK') AS at_risk,
        (SELECT count(*)::int FROM customers WHERE status='DORMANT') AS dormant,
        (SELECT round(avg(risk_score))::int FROM customers) AS avg_risk,
        (SELECT count(*)::int FROM customers WHERE risk_score >= 45) AS high_risk,
        (SELECT round(avg(churn_probability)::numeric,3) FROM customers) AS avg_churn,
        (SELECT count(*)::int FROM customers WHERE churn_probability >= 0.6) AS churn_watch
    `) as unknown as { rows: Record<string, number>[] };
    const segs = await getSegments();
    return envelope(
      rows.map((r) => maskCustomer(r, session)),
      {
        count: rows.length,
        facets: facets.rows[0],
        segments: segs.map((s) => ({ id: s.id, code: s.code, name: s.name, size: s.size, share: Number(s.share.toFixed(2)), colour: s.colour })),
        filters: { q: search.get("q"), segment: search.get("segment"), risk: search.get("risk"), sort: search.get("sort") },
        pii_policy: session && session.role === "ADMIN" ? "unmasked" : "masked",
      },
    );
  },
  { audit: "api.customers.read" },
);
