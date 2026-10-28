import { db } from "@/db";
import { sql, desc, asc, eq, and, gte } from "drizzle-orm";
import {
  transactions, customers, merchants, dailyMetrics, fraudCases, alerts,
  segments, mlModels, forecasts, pipelineRuns, benchmarkRuns, systemState, auditLogs,
} from "@/db/schema";
import { ensureReady, TWIN_SCALE } from "./seed";
import { TXN_LABEL, compactKsh } from "./core";

type Row = Record<string, unknown>;

async function q<T = Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  await ensureReady();
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows ?? [];
}

async function direct<T = Row>(query: ReturnType<typeof sql>): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows ?? [];
}

export { TWIN_SCALE };

/* ------------------------------ overview -------------------------- */

export async function getOverview(days = 30) {
  const rows = await q<{
    txn_count: string; txn_value: string; fees: string; customers: string; merchants: string;
    avg_ticket: string; failed: string; reversals: string; flagged: string; critical: string; fraud_value: string;
  }>(sql`
    SELECT
      count(*)::text AS txn_count,
      coalesce(sum(amount),0)::text AS txn_value,
      coalesce(sum(fee),0)::text AS fees,
      count(distinct customer_id)::text AS customers,
      count(distinct merchant_id)::text AS merchants,
      coalesce(round(avg(amount)),0)::text AS avg_ticket,
      count(*) filter (where status = 'FAILED')::text AS failed,
      count(*) filter (where type = 'REVERSAL')::text AS reversals,
      count(*) filter (where flagged = 1)::text AS flagged,
      count(*) filter (where risk_level = 'CRITICAL')::text AS critical,
      coalesce(sum(amount) filter (where risk_level = 'CRITICAL'),0)::text AS fraud_value
    FROM transactions
    WHERE occurred_at >= now() - make_interval(days => ${days})
  `);
  const prev = await q<{ txn_count: string; txn_value: string; customers: string; flagged: string }>(sql`
    SELECT
      count(*)::text AS txn_count,
      coalesce(sum(amount),0)::text AS txn_value,
      count(distinct customer_id)::text AS customers,
      count(*) filter (where flagged = 1)::text AS flagged
    FROM transactions
    WHERE occurred_at >= now() - make_interval(days => ${days * 2})
      AND occurred_at < now() - make_interval(days => ${days})
  `);
  const cur = rows[0];
  const old = prev[0];
  const delta = (a: string | undefined, b: string | undefined) => {
    const x = Number(a ?? 0);
    const y = Number(b ?? 0);
    if (y === 0) return 0;
    return ((x - y) / y) * 100;
  };
  const caseCounts = await q<{ open: string; investigating: string; resolved: string; false_positive: string; total: string }>(sql`
    SELECT
      count(*) filter (where status = 'OPEN')::text AS open,
      count(*) filter (where status = 'INVESTIGATING')::text AS investigating,
      count(*) filter (where status = 'RESOLVED')::text AS resolved,
      count(*) filter (where status = 'FALSE_POSITIVE')::text AS false_positive,
      count(*)::text AS total
    FROM fraud_cases
  `);
  return {
    windowDays: days,
    transactions: Number(cur?.txn_count ?? 0),
    value: Number(cur?.txn_value ?? 0),
    fees: Number(cur?.fees ?? 0),
    customers: Number(cur?.customers ?? 0),
    merchants: Number(cur?.merchants ?? 0),
    avgTicket: Number(cur?.avg_ticket ?? 0),
    failed: Number(cur?.failed ?? 0),
    reversals: Number(cur?.reversals ?? 0),
    flagged: Number(cur?.flagged ?? 0),
    critical: Number(cur?.critical ?? 0),
    fraudValue: Number(cur?.fraud_value ?? 0),
    deltas: {
      transactions: delta(cur?.txn_count, old?.txn_count),
      value: delta(cur?.txn_value, old?.txn_value),
      customers: delta(cur?.customers, old?.customers),
      fraud: delta(cur?.flagged, old?.flagged),
    },
    cases: {
      open: Number(caseCounts[0]?.open ?? 0),
      investigating: Number(caseCounts[0]?.investigating ?? 0),
      resolved: Number(caseCounts[0]?.resolved ?? 0),
      falsePositive: Number(caseCounts[0]?.false_positive ?? 0),
      total: Number(caseCounts[0]?.total ?? 0),
    },
    projected: {
      transactions: Number(cur?.txn_count ?? 0) * TWIN_SCALE,
      value: Number(cur?.txn_value ?? 0) * TWIN_SCALE,
      customers: Number(cur?.customers ?? 0) * TWIN_SCALE,
      fraud: Number(cur?.flagged ?? 0) * TWIN_SCALE,
    },
  };
}

/* ------------------------------ series ---------------------------- */

export async function getVolumeSeries(days = 90) {
  return q<{ day: string; count: string; value: string; fees: string; avg_ticket: string; flagged: string; fraud: string; customers: string }>(sql`
    SELECT day, txn_count::text AS count, txn_value::text AS value, fees::text AS fees,
           avg_ticket::text AS avg_ticket, flagged_count::text AS flagged, fraud_count::text AS fraud,
           active_customers::text AS customers
    FROM daily_metrics
    WHERE day >= to_char(now() - make_interval(days => ${days}), 'YYYY-MM-DD')
    ORDER BY day ASC
  `);
}

export async function getTypeBreakdown(days = 30) {
  const rows = await q<{ type: string; count: string; value: string; avg_amount: string; risk: string }>(sql`
    SELECT type, count(*)::text AS count, sum(amount)::text AS value,
           round(avg(amount))::text AS avg_amount, round(avg(risk_score))::text AS risk
    FROM transactions
    WHERE occurred_at >= now() - make_interval(days => ${days})
    GROUP BY type ORDER BY sum(amount) DESC
  `);
  return rows.map((r) => ({
    type: r.type, label: TXN_LABEL[r.type] ?? r.type, count: Number(r.count),
    value: Number(r.value), avgAmount: Number(r.avg_amount), risk: Number(r.risk),
  }));
}

export async function getChannelMix(days = 30) {
  const rows = await q<{ channel: string; count: string; value: string; risk: string }>(sql`
    SELECT channel, count(*)::text AS count, sum(amount)::text AS value, round(avg(risk_score))::text AS risk
    FROM transactions WHERE occurred_at >= now() - make_interval(days => ${days})
    GROUP BY channel ORDER BY count(*) DESC
  `);
  return rows.map((r) => ({ channel: r.channel, count: Number(r.count), value: Number(r.value), risk: Number(r.risk) }));
}

export async function getHourProfile(days = 30) {
  const rows = await q<{ hour: string; count: string; value: string; risk: string }>(sql`
    SELECT extract(hour from occurred_at)::int::text AS hour, count(*)::text AS count,
           sum(amount)::text AS value, round(avg(risk_score))::text AS risk
    FROM transactions WHERE occurred_at >= now() - make_interval(days => ${days})
    GROUP BY 1 ORDER BY 1 ASC
  `);
  return rows.map((r) => ({ hour: Number(r.hour), count: Number(r.count), value: Number(r.value), risk: Number(r.risk) }));
}

export async function getCountyBreakdown(days = 30) {
  const rows = await q<{ county: string; count: string; value: string; risk: string; customers: string; merchants: string; flagged: string }>(sql`
    SELECT county, count(*)::text AS count, sum(amount)::text AS value,
           round(avg(risk_score))::text AS risk,
           count(distinct customer_id)::text AS customers,
           count(distinct merchant_id)::text AS merchants,
           count(*) filter (where flagged = 1)::text AS flagged
    FROM transactions WHERE occurred_at >= now() - make_interval(days => ${days})
    GROUP BY county ORDER BY sum(amount) DESC
  `);
  return rows.map((r) => ({
    county: r.county, count: Number(r.count), value: Number(r.value), risk: Number(r.risk),
    customers: Number(r.customers), merchants: Number(r.merchants), flagged: Number(r.flagged),
    fraudRate: Number(r.count) ? (Number(r.flagged) / Number(r.count)) * 100 : 0,
  }));
}

export async function getFraudTrend(days = 60) {
  return q<{ day: string; flagged: string; critical: string; value: string; cases: string }>(sql`
    SELECT day, flagged_count::text AS flagged, fraud_count::text AS critical,
           fraud_value::text AS value, '0'::text AS cases
    FROM daily_metrics WHERE day >= to_char(now() - make_interval(days => ${days}), 'YYYY-MM-DD')
    ORDER BY day ASC
  `);
}

/* ------------------------------ fraud ----------------------------- */

export type FraudQueueFilters = { level?: string; status?: string; county?: string; limit?: number; minScore?: number };

export async function getFraudQueue(f: FraudQueueFilters = {}) {
  const level = f.level && f.level !== "ALL" ? f.level : null;
  const status = f.status && f.status !== "ALL" ? f.status : null;
  const county = f.county && f.county !== "ALL" ? f.county : null;
  const limit = Math.min(f.limit ?? 60, 400);
  const minScore = f.minScore ?? 0;
  return q<{
    id: string; case_code: string; transaction_code: string; customer_code: string; customer_name: string;
    merchant_name: string | null; county: string | null; type: string | null; amount: number; risk_score: number;
    risk_level: string; status: string; assignee: string | null; recommendation: string | null; confidence: number;
    opened_at: string; potential_loss: number; reasons: string[] | null;
  }>(sql`
    SELECT id, case_code, transaction_code, customer_code, customer_name, merchant_name, county, type,
           amount, risk_score, risk_level, status, assignee, recommendation, confidence,
           to_char(opened_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS opened_at, potential_loss, reasons
    FROM fraud_cases
    WHERE risk_score >= ${minScore}
      ${level ? sql`AND risk_level = ${level}` : sql``}
      ${status ? sql`AND status = ${status}` : sql``}
      ${county ? sql`AND county = ${county}` : sql``}
    ORDER BY risk_score DESC, opened_at DESC
    LIMIT ${limit}
  `);
}

export async function getFraudCase(id: string) {
  const rows = await db.select().from(fraudCases).where(sql`${fraudCases.id} = ${id} OR ${fraudCases.caseCode} = ${id} OR ${fraudCases.transactionCode} = ${id}`).limit(1);
  const c = rows[0];
  if (!c) return null;
  const txn = await db.select().from(transactions).where(sql`${transactions.code} = ${c.transactionCode}`).limit(1);
  const cust = await db.select().from(customers).where(sql`${customers.id} = ${c.customerId}`).limit(1);
  const history = await db
    .select()
    .from(transactions)
    .where(sql`${transactions.customerId} = ${c.customerId}`)
    .orderBy(desc(transactions.occurredAt))
    .limit(25);
  const similar = await q<{ count: string; avg_amount: string; flagged: string }>(sql`
    SELECT count(*)::text AS count, round(avg(amount))::text AS avg_amount,
           count(*) filter (where flagged = 1)::text AS flagged
    FROM transactions WHERE type = ${c.type} AND county = ${c.county} AND amount BETWEEN ${Math.max(1, c.amount * 0.5)} AND ${c.amount * 2}
  `);
  return { case: c, transaction: txn[0] ?? null, customer: cust[0] ?? null, history, cohort: similar[0] ?? null };
}

export async function getFraudSummary() {
  const rows = await q<{ level: string; count: string; value: string }>(sql`
    SELECT risk_level AS level, count(*)::text AS count, coalesce(sum(amount),0)::text AS value
    FROM fraud_cases GROUP BY risk_level
  `);
  const byRule = await q<{ rule: string; count: string }>(sql`
    SELECT rule, count(*)::text AS count FROM alerts GROUP BY rule ORDER BY count(*) DESC LIMIT 12
  `);
  const totals = await q<{ open: string; mtta: string; resolved: string; loss: string }>(sql`
    SELECT count(*) filter (where status='OPEN')::text AS open,
      coalesce(round(avg(case when closed_at is not null then extract(epoch from (closed_at - opened_at))/60 end)),0)::text AS mtta,
      count(*) filter (where status='RESOLVED')::text AS resolved,
      coalesce(sum(potential_loss),0)::text AS loss
    FROM fraud_cases
  `);
  return { byLevel: rows, byRule, totals: totals[0] };
}

/* ---------------------------- customers --------------------------- */

export async function getCustomerList(opts: { search?: string; segment?: string; sort?: string; limit?: number; risk?: string } = {}) {
  const limit = Math.min(opts.limit ?? 60, 400);
  const search = opts.search?.trim() ? `%${opts.search.trim()}%` : null;
  const sortMap: Record<string, string> = {
    value: "value_30d DESC", txn: "txn_30d DESC", risk: "risk_score DESC", churn: "churn_probability DESC",
  };
  const orderBy = sortMap[opts.sort ?? "value"] ?? "value_30d DESC";
  return q<{
    id: string; code: string; name: string; msisdn: string; county: string; segment_name: string | null;
    risk_score: number; txn_30d: number; value_30d: number; avg_ticket: number; churn_probability: number;
    status: string; top_category: string | null; peak_window: string | null; savings_rate: number;
  }>(sql`
    SELECT id, code, name, msisdn, county, segment_name, risk_score, txn_30d, value_30d, avg_ticket,
           churn_probability, status, top_category, peak_window, savings_rate
    FROM customers
    WHERE 1=1
      ${search ? sql`AND (name ILIKE ${search} OR code ILIKE ${search} OR msisdn ILIKE ${search})` : sql``}
      ${opts.segment && opts.segment !== "ALL" ? sql`AND segment_name = ${opts.segment}` : sql``}
      ${opts.risk && opts.risk !== "ALL" ? sql`AND risk_score >= ${opts.risk === "HIGH" ? 45 : opts.risk === "ELEVATED" ? 25 : 0}` : sql``}
    ORDER BY ${sql.raw(orderBy)}
    LIMIT ${limit}
  `);
}

export async function getCustomer360(id: string) {
  const rows = await db.select().from(customers).where(sql`${customers.id} = ${id} OR ${customers.code} = ${id}`).limit(1);
  const c = rows[0];
  if (!c) return null;
  const [series, types, merchantsUsed, recurring, riskHistory] = await Promise.all([
    q<{ day: string; count: string; value: string; inflow: string; outflow: string }>(sql`
      SELECT to_char(date_trunc('day', occurred_at), 'YYYY-MM-DD') AS day,
             count(*)::text AS count, sum(amount)::text AS value,
             coalesce(sum(amount) filter (where type in ('RECEIVE_MONEY','DEPOSIT','REVERSAL')),0)::text AS inflow,
             coalesce(sum(amount) filter (where type not in ('RECEIVE_MONEY','DEPOSIT','REVERSAL')),0)::text AS outflow
      FROM transactions WHERE customer_id = ${c.id}
      GROUP BY 1 ORDER BY 1 ASC
    `),
    q<{ type: string; count: string; value: string }>(sql`
      SELECT type, count(*)::text AS count, sum(amount)::text AS value FROM transactions
      WHERE customer_id = ${c.id} GROUP BY type ORDER BY sum(amount) DESC
    `),
    q<{ name: string; category: string; count: string; value: string }>(sql`
      SELECT coalesce(merchant_name, 'P2P / Other') AS name, coalesce(category,'GENERAL') AS category,
             count(*)::text AS count, sum(amount)::text AS value
      FROM transactions WHERE customer_id = ${c.id} AND merchant_id IS NOT NULL
      GROUP BY 1,2 ORDER BY sum(amount) DESC LIMIT 8
    `),
    q<{ name: string; count: string; avg_amount: string; total: string; category: string }>(sql`
      SELECT merchant_name AS name, count(*)::text AS count, round(avg(amount))::text AS avg_amount,
             sum(amount)::text AS total, max(category) AS category
      FROM transactions
      WHERE customer_id = ${c.id} AND merchant_id IS NOT NULL
      GROUP BY merchant_name HAVING count(*) >= 3 AND stddev_pop(amount) < avg(amount) * 0.6
      ORDER BY sum(amount) DESC LIMIT 6
    `),
    q<{ level: string; count: string }>(sql`
      SELECT risk_level AS level, count(*)::text AS count FROM transactions WHERE customer_id = ${c.id} GROUP BY 1
    `),
  ]);
  const recent = await db.select().from(transactions).where(sql`${transactions.customerId} = ${c.id}`).orderBy(desc(transactions.occurredAt)).limit(20);
  const segment = c.segmentId ? (await db.select().from(segments).where(sql`${segments.id} = ${c.segmentId}`).limit(1))[0] : null;
  const peer = await q<{ n: string; avg_value: string; avg_txn: string; avg_risk: string }>(sql`
    SELECT count(*)::text AS n, round(avg(value_30d))::text AS avg_value,
           round(avg(txn_30d))::text AS avg_txn, round(avg(risk_score))::text AS avg_risk
    FROM customers WHERE segment_id = ${c.segmentId}
  `);
  return { customer: c, series, types, merchantsUsed, recurring, riskHistory, recent, segment, peer: peer[0] };
}

/* ---------------------------- merchants --------------------------- */

export async function getMerchantList(opts: { category?: string; county?: string; sort?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 60, 300);
  const sortMap: Record<string, string> = {
    revenue: "revenue_30d DESC", growth: "growth_pct DESC", customers: "unique_customers DESC", risk: "fraud_risk DESC",
  };
  const orderBy = sortMap[opts.sort ?? "revenue"] ?? "revenue_30d DESC";
  return q<{
    id: string; code: string; name: string; category: string; county: string; till_number: string; paybill: string | null;
    revenue_30d: number; txn_30d: number; avg_ticket: number; unique_customers: number; returning_rate: number;
    growth_pct: number; peak_hour: number; fraud_risk: string; forecast_next_30d: number; benchmark_percentile: number; status: string;
  }>(sql`
    SELECT id, code, name, category, county, till_number, paybill, revenue_30d, txn_30d, avg_ticket,
           unique_customers, returning_rate, growth_pct, peak_hour, fraud_risk, forecast_next_30d,
           benchmark_percentile, status
    FROM merchants WHERE status = 'ACTIVE'
      ${opts.category && opts.category !== "ALL" ? sql`AND category = ${opts.category}` : sql``}
      ${opts.county && opts.county !== "ALL" ? sql`AND county = ${opts.county}` : sql``}
    ORDER BY ${sql.raw(orderBy)} LIMIT ${limit}
  `);
}

export async function getMerchantDetail(id: string) {
  const rows = await db.select().from(merchants).where(sql`${merchants.id} = ${id} OR ${merchants.code} = ${id}`).limit(1);
  const m = rows[0];
  if (!m) return null;
  const [series, hours, counties, retention, benchmark] = await Promise.all([
    q<{ day: string; count: string; value: string }>(sql`
      SELECT to_char(date_trunc('day', occurred_at),'YYYY-MM-DD') AS day, count(*)::text AS count, sum(amount)::text AS value
      FROM transactions WHERE merchant_id = ${m.id} GROUP BY 1 ORDER BY 1 ASC
    `),
    q<{ hour: string; count: string; value: string }>(sql`
      SELECT extract(hour from occurred_at)::int::text AS hour, count(*)::text AS count, sum(amount)::text AS value
      FROM transactions WHERE merchant_id = ${m.id} GROUP BY 1 ORDER BY 1 ASC
    `),
    q<{ county: string; count: string; value: string }>(sql`
      SELECT county, count(*)::text AS count, sum(amount)::text AS value FROM transactions
      WHERE merchant_id = ${m.id} GROUP BY 1 ORDER BY 2 DESC LIMIT 10
    `),
    q<{ returning: string; first_time: string }>(sql`
      SELECT count(*) filter (where visits > 1)::text AS returning, count(*) filter (where visits = 1)::text AS first_time
      FROM (SELECT customer_id, count(*) AS visits FROM transactions WHERE merchant_id = ${m.id} GROUP BY customer_id) v
    `),
    q<{ n: string; avg_revenue: string; avg_growth: string; avg_ticket: string }>(sql`
      SELECT count(*)::text AS n, round(avg(revenue_30d))::text AS avg_revenue, round(avg(growth_pct)::numeric,1)::text AS avg_growth,
             round(avg(avg_ticket))::text AS avg_ticket
      FROM merchants WHERE category = ${m.category} AND status='ACTIVE'
    `),
  ]);
  return { merchant: m, series, hours, counties, retention: retention[0], benchmark: benchmark[0] };
}

/* --------------------------- segmentation ------------------------- */

export async function getSegments() {
  const rows = await db.select().from(segments).orderBy(desc(segments.size));
  return rows;
}

/* ----------------------------- cash flow -------------------------- */

export async function getCashFlowAggregate(days = 90) {
  const rows = await q<{ month: string; income: string; expenses: string; fees: string; n: string }>(sql`
    SELECT to_char(date_trunc('month', occurred_at), 'YYYY-MM') AS month,
      coalesce(sum(amount) filter (where type in ('RECEIVE_MONEY','DEPOSIT','REVERSAL')),0)::text AS income,
      coalesce(sum(amount) filter (where type not in ('RECEIVE_MONEY','DEPOSIT','REVERSAL')),0)::text AS expenses,
      coalesce(sum(fee),0)::text AS fees, count(*)::text AS n
    FROM transactions WHERE occurred_at >= now() - make_interval(days => ${days})
    GROUP BY 1 ORDER BY 1 ASC
  `);
  const cohort = await q<{ band: string; customers: string; avg_rate: string }>(sql`
    SELECT CASE WHEN savings_rate >= 40 THEN 'HEALTHY (>40%)'
                WHEN savings_rate >= 15 THEN 'MODERATE (15-40%)'
                WHEN savings_rate >= 0 THEN 'THIN (0-15%)'
                ELSE 'OVER-EXTENDED (<0%)' END AS band,
           count(*)::text AS customers, round(avg(savings_rate)::numeric,1)::text AS avg_rate
    FROM customers GROUP BY 1 ORDER BY min(savings_rate) DESC
  `);
  const recurring = await q<{ name: string; category: string; customers: string; value: string }>(sql`
    SELECT merchant_name AS name, max(category) AS category, count(distinct customer_id)::text AS customers,
           sum(amount)::text AS value
    FROM transactions
    WHERE merchant_id IS NOT NULL AND occurred_at >= now() - make_interval(days => 60)
    GROUP BY merchant_name HAVING count(*) >= 20
    ORDER BY sum(amount) DESC LIMIT 12
  `);
  const largest = await q<{ label: string; value: string; share: string }>(sql`
    SELECT coalesce(merchant_name, type) AS label, sum(amount)::text AS value,
           round(100.0 * sum(amount) / greatest(1,(SELECT sum(amount) FROM transactions WHERE occurred_at >= now() - make_interval(days => 30))),2)::text AS share
    FROM transactions WHERE occurred_at >= now() - make_interval(days => 30)
      AND type NOT IN ('RECEIVE_MONEY','DEPOSIT','REVERSAL')
    GROUP BY 1 ORDER BY sum(amount) DESC LIMIT 10
  `);
  const summary = await q<{ income: string; expenses: string; fees: string }>(sql`
    SELECT
      coalesce(sum(amount) filter (where type in ('RECEIVE_MONEY','DEPOSIT','REVERSAL')),0)::text AS income,
      coalesce(sum(amount) filter (where type not in ('RECEIVE_MONEY','DEPOSIT','REVERSAL')),0)::text AS expenses,
      coalesce(sum(fee),0)::text AS fees
    FROM transactions WHERE occurred_at >= now() - make_interval(days => 30)
  `);
  const s = summary[0];
  const income = Number(s?.income ?? 0);
  const expenses = Number(s?.expenses ?? 0);
  const fees = Number(s?.fees ?? 0);
  return {
    monthly: rows.map((r) => ({ month: r.month, income: Number(r.income), expenses: Number(r.expenses), fees: Number(r.fees), net: Number(r.income) - Number(r.expenses), n: Number(r.n) })),
    cohort, recurring, largest,
    summary: {
      income, expenses, fees, net: income - expenses,
      savingsRate: income ? ((income - expenses) / income) * 100 : 0,
      burnRate: expenses / 30,
      expenseToFeeRatio: expenses ? (fees / expenses) * 100 : 0,
    },
  };
}

/* ---------------------------- predictions ------------------------- */

export async function getPredictions() {
  await ensureReady();
  const [fc, churn, spend, models] = await Promise.all([
    db.select().from(forecasts),
    q<{ id: string; code: string; name: string; county: string; churn_probability: number; txn_30d: number; value_30d: number; segment_name: string | null; status: string }>(sql`
      SELECT id, code, name, county, churn_probability, txn_30d, value_30d, segment_name, status
      FROM customers ORDER BY churn_probability DESC LIMIT 25
    `),
    q<{ id: string; code: string; name: string; monthly_expenses: number; expected_monthly_spend: number; savings_rate: number; county: string }>(sql`
      SELECT id, code, name, monthly_expenses, expected_monthly_spend, savings_rate, county
      FROM customers WHERE status <> 'DORMANT' ORDER BY expected_monthly_spend DESC LIMIT 20
    `),
    db.select().from(mlModels),
  ]);
  const churnBands = await q<{ band: string; count: string }>(sql`
    SELECT CASE WHEN churn_probability >= 0.75 THEN 'SEVERE' WHEN churn_probability >= 0.5 THEN 'HIGH'
                WHEN churn_probability >= 0.3 THEN 'MODERATE' ELSE 'LOW' END AS band, count(*)::text AS count
    FROM customers GROUP BY 1
  `);
  const transactTomorrow = await q<{ likely: string; unlikely: string }>(sql`
    SELECT count(*) filter (where churn_probability < 0.35 AND txn_30d >= 12)::text AS likely,
           count(*) filter (where churn_probability >= 0.6)::text AS unlikely
    FROM customers
  `);
  return { forecasts: fc, churn, spend, models, churnBands, transactTomorrow: transactTomorrow[0] };
}

/* ----------------------------- registry --------------------------- */

export async function getModelRegistry() {
  await ensureReady();
  return db.select().from(mlModels).orderBy(asc(mlModels.task));
}

export async function getPipeline() {
  await ensureReady();
  const [runs, benchmarks, state, twin, layerStats] = await Promise.all([
    db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)),
    db.select().from(benchmarkRuns).orderBy(desc(benchmarkRuns.ranAt)).limit(12),
    db.select().from(systemState).where(sql`${systemState.key} = 'bootstrap'`).limit(1),
    db.select().from(systemState).where(sql`${systemState.key} = 'twin'`).limit(1),
    direct<{ layer: string; tables: string; rows: string }>(sql`
      SELECT 'bronze' AS layer, '1'::text AS tables, count(*)::text AS rows FROM transactions
      UNION ALL SELECT 'silver', '4', (SELECT count(*)::text FROM customers)
      UNION ALL SELECT 'gold', '2', (SELECT count(*)::text FROM daily_metrics)
    `),
  ]);
  const tableSizes = await direct<{ table_name: string; bytes: string; rows: string }>(sql`
    SELECT relname AS table_name, pg_size_pretty(pg_total_relation_size(oid)) AS bytes,
           (reltuples)::bigint::text AS rows
    FROM pg_class WHERE relkind='r' AND relname IN
      ('transactions','customers','merchants','daily_metrics','fraud_cases','alerts','ml_models','pipeline_runs','benchmark_runs','segments','forecasts','users','audit_logs')
    ORDER BY pg_total_relation_size(oid) DESC
  `);
  const audit = await db.select().from(auditLogs).orderBy(desc(auditLogs.at)).limit(15);
  return {
    runs, benchmarks,
    bootstrap: state[0]?.value ?? null,
    twin: twin[0]?.value ?? null,
    layerStats, tableSizes, audit,
  };
}

/* ------------------------------ alerts ---------------------------- */

export async function getAlerts(opts: { severity?: string; status?: string; limit?: number } = {}) {
  const limit = Math.min(opts.limit ?? 80, 400);
  return q<{
    id: string; code: string; severity: string; channel: string; title: string; body: string; rule: string;
    transaction_code: string | null; customer_code: string | null; county: string | null; amount: number;
    risk_score: number; status: string; acknowledged_by: string | null; fired_at: string;
  }>(sql`
    SELECT id, code, severity, channel, title, body, rule, transaction_code, customer_code, county,
           amount, risk_score, status, acknowledged_by, to_char(fired_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS fired_at
    FROM alerts
    WHERE 1=1
      ${opts.severity && opts.severity !== "ALL" ? sql`AND severity = ${opts.severity}` : sql``}
      ${opts.status && opts.status !== "ALL" ? sql`AND status = ${opts.status}` : sql``}
    ORDER BY fired_at DESC LIMIT ${limit}
  `);
}

export async function getAlertStats() {
  const rows = await q<{ severity: string; channel: string; status: string; count: string }>(sql`
    SELECT severity, channel, status, count(*)::text AS count FROM alerts GROUP BY 1,2,3
  `);
  return rows.map((r) => ({ severity: r.severity, channel: r.channel, status: r.status, count: Number(r.count) }));
}

/* ------------------------------ reports --------------------------- */

export async function getReports() {
  const [overview, types, counties, channels, hours] = await Promise.all([
    getOverview(30), getTypeBreakdown(30), getCountyBreakdown(30), getChannelMix(30), getHourProfile(30),
  ]);
  const modelRows = await getModelRegistry();
  return { overview, types, counties, channels, hours, models: modelRows };
}

/* ------------------------------ ticker ---------------------------- */

export async function getRecentTransactions(limit = 25) {
  await ensureReady();
  return db.select().from(transactions).orderBy(desc(transactions.occurredAt)).limit(limit);
}

export async function getTopTransactions(opts: { days?: number; type?: string; limit?: number } = {}) {
  await ensureReady();
  const limit = Math.min(opts.limit ?? 20, 100);
  return db
    .select()
    .from(transactions)
    .where(and(gte(transactions.occurredAt, sql`now() - make_interval(days => ${opts.days ?? 30})`), opts.type && opts.type !== "ALL" ? eq(transactions.type, opts.type) : undefined))
    .orderBy(desc(transactions.amount))
    .limit(limit);
}

/* ------------------------------ helpers --------------------------- */

export function moneyLabel(n: number) {
  return compactKsh(n);
}

export async function countRows() {
  const r = await direct<{ t: string; c: string; m: string; f: string; a: string }>(sql`
    SELECT (SELECT count(*)::text FROM transactions) AS t,
           (SELECT count(*)::text FROM customers) AS c,
           (SELECT count(*)::text FROM merchants) AS m,
           (SELECT count(*)::text FROM fraud_cases) AS f,
           (SELECT count(*)::text FROM alerts) AS a
  `);
  return r[0];
}
