import { db } from "@/db";
import { transactions } from "@/db/schema";
import { sql, desc, and, gte, eq } from "drizzle-orm";
import { api, envelope } from "@/lib/api";
import { ensureReady } from "@/lib/seed";
import { synthesiseEvent, buildTwinPopulation } from "@/lib/simulator";
import { getFraudBundle, scoreEvent } from "@/lib/ml/fraud";
import { Rng, TXN_TYPES } from "@/lib/core";
import { publishExternal } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async ({ search }) => {
    await ensureReady();
    const num = (v: string | null, d: number) => { const n = Number(v ?? d); return Number.isFinite(n) ? Math.trunc(n) : d; };
    const limit = Math.min(num(search.get("limit"), 50), 500);
    const offset = Math.max(0, num(search.get("offset"), 0));
    const days = Math.max(1, num(search.get("days"), 30));
    const type = search.get("type");
    const county = search.get("county");
    const customer = search.get("customer_id") ?? search.get("customer");
    const merchant = search.get("merchant_id");
    const status = search.get("status");
    const minRisk = search.get("min_risk");
    const channel = search.get("channel");

    const conditions = [
      gte(transactions.occurredAt, sql`now() - make_interval(days => ${days})`),
      type && type !== "ALL" ? eq(transactions.type, type) : undefined,
      county && county !== "ALL" ? eq(transactions.county, county) : undefined,
      customer ? sql`(${transactions.customerId} = ${customer} OR ${transactions.customerCode} = ${customer})` : undefined,
      merchant ? eq(transactions.merchantId, merchant) : undefined,
      status && status !== "ALL" ? eq(transactions.status, status) : undefined,
      channel && channel !== "ALL" ? eq(transactions.channel, channel) : undefined,
      minRisk ? sql`${transactions.riskScore} >= ${Math.trunc(Number(minRisk)) || 0}` : undefined,
    ].filter(Boolean);

    const where = conditions.length ? and(...(conditions as never[])) : undefined;
    const rows = await db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.occurredAt))
      .limit(limit)
      .offset(offset);

    const agg = await db.execute(sql`
      SELECT count(*)::text AS count, coalesce(sum(amount),0)::text AS value,
             coalesce(round(avg(amount)),0)::text AS avg_amount,
             count(*) filter (where flagged=1)::text AS flagged
      FROM transactions
      WHERE occurred_at >= now() - make_interval(days => ${days})
    `) as unknown as { rows: { count: string; value: string; avg_amount: string; flagged: string }[] };

    const a = agg.rows[0];
    return envelope(
      rows.map((r) => ({
        transaction_id: r.code, customer_id: r.customerCode, merchant_id: r.merchantCode,
        merchant_name: r.merchantName, transaction_type: r.type, status: r.status, channel: r.channel,
        amount: r.amount, fee: r.fee, location: r.county, category: r.category,
        risk_score: r.riskScore, risk_level: r.riskLevel, reasons: r.reasons,
        timestamp: r.occurredAt,
      })),
      {
        count: Number(a?.count ?? 0), window_days: days, returned: rows.length, offset,
        aggregates: { value: Number(a?.value ?? 0), avg_amount: Number(a?.avg_amount ?? 0), flagged: Number(a?.flagged ?? 0) },
        filters: { type, county, customer, merchant, status, channel, min_risk: minRisk },
      },
    );
  },
  { audit: "api.transactions.read" },
);

/** POST /api/v1/transactions — inject an event into the streaming backbone. */
export const POST = api(
  "write:all",
  async ({ req }) => {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const bundle = await getFraudBundle();
    if (body && typeof body.transaction_type === "string") {
      const event = await publishExternal(body, bundle);
      return envelope({ accepted: true, event: { transaction_id: event.event.code, risk_score: event.verdict.score, risk_level: event.verdict.level, recommendation: event.verdict.recommendation, reasons: event.verdict.reasons } }, { topic: event.meta.topic, partition: event.meta.partition, offset: event.meta.offset, inference_ms: event.meta.inferenceMs });
    }
    const count = Math.min(Number(body?.count ?? 1), 50);
    const population = buildTwinPopulation({ customers: 2400, merchants: 320, seed: 9001 });
    const rng = new Rng(Date.now() % 100000);
    const out = [];
    for (let i = 0; i < count; i++) {
      const e = synthesiseEvent(rng, population, new Date(), { fraudBias: Number(body?.fraud_bias ?? 1), seq: (Date.now() % 900000) * 10 + i });
      const v = scoreEvent(bundle, e);
      out.push({ transaction_id: e.code, amount: e.amount, type: e.type, location: e.county, risk_score: v.score, risk_level: v.level });
      void publishExternal({ ...e, transaction_type: e.type }, bundle);
    }
    return envelope({ accepted: true, generated: out.length, events: out }, { available_types: TXN_TYPES });
  },
  { audit: "api.transactions.write", limit: 60 },
);
