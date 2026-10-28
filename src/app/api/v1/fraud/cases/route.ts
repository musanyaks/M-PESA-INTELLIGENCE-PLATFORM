import { api, envelope } from "@/lib/api";
import { getFraudQueue, getFraudSummary } from "@/lib/queries";
import { ensureReady } from "@/lib/seed";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async ({ search }) => {
    await ensureReady();
    const rows = await getFraudQueue({
      level: search.get("level") ?? undefined,
      status: search.get("status") ?? undefined,
      county: search.get("county") ?? undefined,
      minScore: Number(search.get("min_score") ?? 0),
      limit: Number(search.get("limit") ?? 60),
    });
    const summary = await getFraudSummary();
    return envelope(
      {
        count: rows.length,
        cases: rows.map((r) => ({
          case_id: r.case_code, transaction_id: r.transaction_code, customer_id: r.customer_code,
          amount: r.amount, county: r.county, type: r.type, risk_score: r.risk_score,
          risk_level: r.risk_level, status: r.status, assignee: r.assignee,
          recommendation: r.recommendation, confidence: r.confidence, potential_loss: r.potential_loss,
          opened_at: r.opened_at, reasons: r.reasons,
        })),
      },
      { summary, filters: Object.fromEntries(search.entries()) },
    );
  },
  { audit: "api.fraud.cases" },
);
