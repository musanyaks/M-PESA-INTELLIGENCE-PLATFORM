import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  bigint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ------------------------------------------------------------------ *
 * IDENTITY & ACCESS
 * ------------------------------------------------------------------ */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("ANALYST"),
    status: text("status").notNull().default("ACTIVE"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    role: text("role").notNull(),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    result: text("result").notNull().default("ALLOW"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    ip: text("ip"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_at_idx").on(t.at)],
);

/* ------------------------------------------------------------------ *
 * MASTER DATA
 * ------------------------------------------------------------------ */

export const customers = pgTable(
  "customers",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    msisdn: text("msisdn").notNull(),
    county: text("county").notNull(),
    kycTier: text("kyc_tier").notNull().default("TIER_3"),
    tenureDays: integer("tenure_days").notNull().default(0),
    segmentId: text("segment_id"),
    segmentName: text("segment_name"),
    riskScore: integer("risk_score").notNull().default(0),
    txn30d: integer("txn_30d").notNull().default(0),
    value30d: integer("value_30d").notNull().default(0),
    avgTicket: integer("avg_ticket").notNull().default(0),
    topCategory: text("top_category"),
    peakWindow: text("peak_window"),
    digitalRatio: doublePrecision("digital_ratio").notNull().default(0),
    churnProbability: doublePrecision("churn_probability").notNull().default(0),
    predictedNextType: text("predicted_next_type"),
    predictedNextWindow: text("predicted_next_window"),
    expectedMonthlySpend: integer("expected_monthly_spend").notNull().default(0),
    monthlyIncome: integer("monthly_income").notNull().default(0),
    monthlyExpenses: integer("monthly_expenses").notNull().default(0),
    savingsRate: doublePrecision("savings_rate").notNull().default(0),
    burnRate: integer("burn_rate").notNull().default(0),
    lifetimeValue: integer("lifetime_value").notNull().default(0),
    status: text("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customers_county_idx").on(t.county), index("customers_risk_idx").on(t.riskScore)],
);

export const merchants = pgTable(
  "merchants",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    county: text("county").notNull(),
    tillNumber: text("till_number").notNull(),
    paybill: text("paybill"),
    revenue30d: integer("revenue_30d").notNull().default(0),
    txn30d: integer("txn_30d").notNull().default(0),
    avgTicket: integer("avg_ticket").notNull().default(0),
    uniqueCustomers: integer("unique_customers").notNull().default(0),
    returningRate: doublePrecision("returning_rate").notNull().default(0),
    growthPct: doublePrecision("growth_pct").notNull().default(0),
    peakHour: integer("peak_hour").notNull().default(12),
    fraudRisk: text("fraud_risk").notNull().default("LOW"),
    forecastNext30d: integer("forecast_next_30d").notNull().default(0),
    benchmarkPercentile: integer("benchmark_percentile").notNull().default(50),
    status: text("status").notNull().default("ACTIVE"),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("merchants_county_idx").on(t.county), index("merchants_category_idx").on(t.category)],
);

/* ------------------------------------------------------------------ *
 * TRANSACTION FACTS (silver / gold)
 * ------------------------------------------------------------------ */

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    customerId: text("customer_id").notNull(),
    customerCode: text("customer_code").notNull(),
    merchantId: text("merchant_id"),
    merchantCode: text("merchant_code"),
    merchantName: text("merchant_name"),
    recipientId: text("recipient_id"),
    type: text("type").notNull(),
    status: text("status").notNull().default("COMPLETED"),
    channel: text("channel").notNull().default("MPESA"),
    amount: integer("amount").notNull(),
    fee: integer("fee").notNull().default(0),
    county: text("county").notNull(),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    category: text("category"),
    riskScore: integer("risk_score").notNull().default(0),
    riskLevel: text("risk_level").notNull().default("NORMAL"),
    isFraud: integer("is_fraud").notNull().default(0),
    flagged: integer("flagged").notNull().default(0),
    detectors: jsonb("detectors").$type<Record<string, number>>(),
    reasons: jsonb("reasons").$type<string[]>(),
    ingestLatencyMs: integer("ingest_latency_ms").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_code_idx").on(t.code),
    index("transactions_occurred_idx").on(t.occurredAt),
    index("transactions_customer_idx").on(t.customerId),
    index("transactions_merchant_idx").on(t.merchantId),
    index("transactions_risk_idx").on(t.riskScore),
    index("transactions_type_idx").on(t.type),
  ],
);

export const dailyMetrics = pgTable(
  "daily_metrics",
  {
    day: text("day").primaryKey(),
    txnCount: integer("txn_count").notNull().default(0),
    txnValue: bigint("txn_value", { mode: "number" }).notNull().default(0),
    fees: bigint("fees", { mode: "number" }).notNull().default(0),
    avgTicket: integer("avg_ticket").notNull().default(0),
    activeCustomers: integer("active_customers").notNull().default(0),
    activeMerchants: integer("active_merchants").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    reversalCount: integer("reversal_count").notNull().default(0),
    fraudCount: integer("fraud_count").notNull().default(0),
    fraudValue: bigint("fraud_value", { mode: "number" }).notNull().default(0),
    flaggedCount: integer("flagged_count").notNull().default(0),
    byType: jsonb("by_type").$type<Record<string, { count: number; value: number }>>(),
    byCounty: jsonb("by_county").$type<Record<string, { count: number; value: number; risk: number }>>(),
    byHour: jsonb("by_hour").$type<number[]>(),
  },
  (t) => [index("daily_metrics_day_idx").on(t.day)],
);

/* ------------------------------------------------------------------ *
 * FRAUD, CASES & ALERTS
 * ------------------------------------------------------------------ */

export const fraudCases = pgTable(
  "fraud_cases",
  {
    id: text("id").primaryKey(),
    caseCode: text("case_code").notNull(),
    transactionId: text("transaction_id").notNull(),
    transactionCode: text("transaction_code").notNull(),
    customerId: text("customer_id").notNull(),
    customerCode: text("customer_code").notNull(),
    customerName: text("customer_name"),
    merchantName: text("merchant_name"),
    county: text("county"),
    type: text("type"),
    amount: integer("amount").notNull().default(0),
    riskScore: integer("risk_score").notNull().default(0),
    riskLevel: text("risk_level").notNull().default("HIGH"),
    status: text("status").notNull().default("OPEN"),
    assignee: text("assignee"),
    recommendation: text("recommendation"),
    confidence: doublePrecision("confidence").notNull().default(0),
    detectors: jsonb("detectors").$type<Record<string, number>>(),
    attributions: jsonb("attributions").$type<{ feature: string; label: string; contribution: number; share: number; direction: string; evidence: string }[]>(),
    reasons: jsonb("reasons").$type<string[]>(),
    potentialLoss: integer("potential_loss").notNull().default(0),
    slaMinutes: integer("sla_minutes").notNull().default(30),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("fraud_status_idx").on(t.status), index("fraud_risk_idx").on(t.riskScore)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    severity: text("severity").notNull().default("INFO"),
    channel: text("channel").notNull().default("DASHBOARD"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    rule: text("rule").notNull(),
    transactionCode: text("transaction_code"),
    customerCode: text("customer_code"),
    county: text("county"),
    amount: integer("amount").notNull().default(0),
    riskScore: integer("risk_score").notNull().default(0),
    status: text("status").notNull().default("FIRED"),
    acknowledgedBy: text("acknowledged_by"),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (t) => [index("alerts_severity_idx").on(t.severity), index("alerts_fired_idx").on(t.firedAt)],
);

/* ------------------------------------------------------------------ *
 * MACHINE LEARNING REGISTRY (MLOps)
 * ------------------------------------------------------------------ */

export const mlModels = pgTable(
  "ml_models",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    family: text("family").notNull(),
    task: text("task").notNull(),
    status: text("status").notNull().default("STAGING"),
    weight: doublePrecision("weight").notNull().default(1),
    metrics: jsonb("metrics").$type<Record<string, number>>(),
    params: jsonb("params").$type<Record<string, unknown>>(),
    artifact: jsonb("artifact").$type<Record<string, unknown>>(),
    featureImportance: jsonb("feature_importance").$type<{ feature: string; label: string; importance: number }[]>(),
    trainingRows: integer("training_rows").notNull().default(0),
    trainDurationMs: integer("train_duration_ms").notNull().default(0),
    trackedBy: text("tracked_by").notNull().default("mlflow://local/03-mpesa-intelligence"),
    trainedAt: timestamp("trained_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ml_models_task_idx").on(t.task)],
);

export const segments = pgTable("segments", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  algorithm: text("algorithm").notNull().default("K-MEANS"),
  colour: text("colour").notNull().default("#35D07F"),
  size: integer("size").notNull().default(0),
  share: doublePrecision("share").notNull().default(0),
  avgTxn30d: integer("avg_txn_30d").notNull().default(0),
  avgValue30d: integer("avg_value_30d").notNull().default(0),
  avgTicket: integer("avg_ticket").notNull().default(0),
  avgRisk: integer("avg_risk").notNull().default(0),
  digitalRatio: doublePrecision("digital_ratio").notNull().default(0),
  centroid: jsonb("centroid").$type<number[]>(),
  revenueShare: doublePrecision("revenue_share").notNull().default(0),
});

export const forecasts = pgTable("forecasts", {
  id: text("id").primaryKey(),
  model: text("model").notNull(),
  metric: text("metric").notNull(),
  entityId: text("entity_id").notNull().default("GLOBAL"),
  granularity: text("granularity").notNull().default("DAILY"),
  horizonDays: integer("horizon_days").notNull().default(30),
  history: jsonb("history").$type<{ day: string; actual: number }[]>(),
  fitted: jsonb("fitted").$type<{ day: string; value: number }[]>(),
  projection: jsonb("projection").$type<{ day: string; value: number; lower: number; upper: number }[]>(),
  metrics: jsonb("metrics").$type<Record<string, number>>(),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ *
 * PIPELINE OBSERVABILITY
 * ------------------------------------------------------------------ */

export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: text("id").primaryKey(),
    dag: text("dag").notNull(),
    task: text("task").notNull(),
    layer: text("layer").notNull(),
    engine: text("engine").notNull(),
    status: text("status").notNull().default("SUCCESS"),
    recordsIn: integer("records_in").notNull().default(0),
    recordsOut: integer("records_out").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    durationMs: integer("duration_ms").notNull().default(0),
    checksum: text("checksum"),
    uri: text("uri"),
  },
  (t) => [index("pipeline_layer_idx").on(t.layer)],
);

export const benchmarkRuns = pgTable("benchmark_runs", {
  id: text("id").primaryKey(),
  scenario: text("scenario").notNull(),
  targetTps: integer("target_tps").notNull().default(0),
  achievedTps: doublePrecision("achieved_tps").notNull().default(0),
  events: integer("events").notNull().default(0),
  producers: integer("producers").notNull().default(1),
  p50Ms: doublePrecision("p50_ms").notNull().default(0),
  p95Ms: doublePrecision("p95_ms").notNull().default(0),
  p99Ms: doublePrecision("p99_ms").notNull().default(0),
  inferenceP99Ms: doublePrecision("inference_p99_ms").notNull().default(0),
  endToEndP99Ms: doublePrecision("end_to_end_p99_ms").notNull().default(0),
  backpressure: doublePrecision("backpressure").notNull().default(0),
  errorRate: doublePrecision("error_rate").notNull().default(0),
  fraudHits: integer("fraud_hits").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
});

export const systemState = pgTable("system_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
