import { db } from "@/db";
import { fraudCases } from "@/db/schema";
import { sql } from "drizzle-orm";
import { api, envelope, errorResponse } from "@/lib/api";
import { getFraudCase } from "@/lib/queries";
import { ensureReady } from "@/lib/seed";
import { DETECTOR_META } from "@/lib/ml/fraud";

export const dynamic = "force-dynamic";

/** GET /api/v1/fraud/cases/:id — full investigation dossier with model explanation. */
export const GET = api(
  "read:all",
  async ({ params }) => {
    await ensureReady();
    const detail = await getFraudCase(params.id);
    if (!detail) return errorResponse(404, "not_found", `No fraud case matches '${params.id}'.`);
    const { case: c, transaction, customer, history, cohort } = detail;
    return envelope({
      transaction: {
        transaction_id: c.transactionCode, case_id: c.caseCode, type: c.type,
        amount: c.amount, location: c.county, merchant: c.merchantName,
        customer_id: c.customerCode, customer_name: c.customerName,
        occurred_at: transaction?.occurredAt ?? c.openedAt, channel: transaction?.channel ?? null,
        status: transaction?.status ?? null, fee: transaction?.fee ?? null,
      },
      risk: {
        score: c.riskScore, level: c.riskLevel, confidence: c.confidence,
        recommendation: c.recommendation, potential_loss: c.potentialLoss,
        sla_minutes: c.slaMinutes, status: c.status, assignee: c.assignee,
      },
      risk_factors: (c.reasons ?? []).map((r, i) => ({ id: `RF-${i + 1}`, label: r, triggered: true })),
      model_explanation: c.attributions ?? [],
      detector_votes: Object.entries(c.detectors ?? {}).map(([key, value]) => ({
        key, score: Number(value), meta: DETECTOR_META.find((d) => d.key === key) ?? null,
      })),
      customer_profile: customer
        ? {
            code: customer.code, county: customer.county, tenure_days: customer.tenureDays,
            monthly_transactions: customer.txn30d, monthly_value: customer.value30d,
            average_transaction: customer.avgTicket, risk_score: customer.riskScore,
            segment: customer.segmentName, churn_probability: customer.churnProbability,
            status: customer.status, peak_window: customer.peakWindow,
          }
        : null,
      peer_cohort: cohort ? { similar_transactions: Number(cohort.count), cohort_avg_amount: Number(cohort.avg_amount), cohort_flagged: Number(cohort.flagged) } : null,
      customer_history: history.map((h) => ({
        transaction_id: h.code, type: h.type, amount: h.amount, county: h.county,
        risk_score: h.riskScore, risk_level: h.riskLevel, status: h.status, occurred_at: h.occurredAt,
      })),
    });
  },
  { audit: "api.fraud.case.detail" },
);

/** PATCH /api/v1/fraud/cases/:id — workflow transition (acknowledge / resolve / escalate). */
export const PATCH = api(
  "resolve:cases",
  async ({ req, params, session }) => {
    const body = (await req.json().catch(() => ({}))) as { status?: string; assignee?: string; note?: string };
    const allowed = ["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE", "ESCALATED"];
    if (!body.status || !allowed.includes(body.status)) {
      return errorResponse(400, "invalid_status", `status must be one of ${allowed.join(", ")}`);
    }
    const rows = await db.select().from(fraudCases).where(sql`${fraudCases.id} = ${params.id} OR ${fraudCases.caseCode} = ${params.id}`).limit(1);
    if (!rows[0]) return errorResponse(404, "not_found", `No fraud case matches '${params.id}'.`);
    const closed = body.status === "RESOLVED" || body.status === "FALSE_POSITIVE";
    await db
      .update(fraudCases)
      .set({ status: body.status, assignee: body.assignee ?? session.name ?? null, closedAt: closed ? new Date() : null })
      .where(sql`${fraudCases.id} = ${rows[0].id}`);
    return envelope({ case_id: rows[0].caseCode, status: body.status, assignee: body.assignee ?? session.name, closed, updated_by: session.email });
  },
  { audit: "api.fraud.case.update", limit: 60 },
);
