import { db } from "@/db";
import { mlModels } from "@/db/schema";
import { sql } from "drizzle-orm";
import { api, envelope } from "@/lib/api";
import { getFraudQueue, getFraudSummary } from "@/lib/queries";
import { ensureReady } from "@/lib/seed";
import { RULE_CATALOGUE, DETECTOR_META } from "@/lib/ml/fraud";

export const dynamic = "force-dynamic";

const RISK_FILTER: Record<string, number> = { critical: 85, high: 65, elevated: 40, normal: 0, all: 0 };

export const GET = api(
  "read:all",
  async ({ search }) => {
    await ensureReady();
    const risk = (search.get("risk") ?? "all").toLowerCase();
    const minScore = RISK_FILTER[risk] ?? 0;
    const rows = await getFraudQueue({
      minScore,
      status: search.get("status") ?? undefined,
      county: search.get("county") ?? undefined,
      limit: Number(search.get("limit") ?? 40),
    });
    const summary = await getFraudSummary();
    const models = await db.select().from(mlModels);
    return envelope(
      {
        count: rows.length,
        transactions: rows.map((r) => ({
          transaction_id: r.transaction_code,
          case_id: r.case_code,
          customer_id: r.customer_code,
          amount: r.amount,
          location: r.county,
          type: r.type,
          risk_score: r.risk_score,
          risk_level: r.risk_level.toLowerCase(),
          status: r.status,
          recommendation: r.recommendation,
          confidence: r.confidence,
          potential_loss: r.potential_loss,
          reasons: r.reasons,
          opened_at: r.opened_at,
        })),
      },
      {
        risk_filter: risk,
        min_risk_score: minScore,
        summary: {
          by_level: summary.byLevel.map((b) => ({ level: b.level, count: Number(b.count), value: Number(b.value) })),
          by_rule: summary.byRule.map((r) => ({ rule: r.rule, count: Number(r.count) })),
          open_cases: Number(summary.totals?.open ?? 0),
          mean_time_to_resolve_minutes: Number(summary.totals?.mtta ?? 0),
          resolved: Number(summary.totals?.resolved ?? 0),
          potential_loss_averted: Number(summary.totals?.loss ?? 0),
        },
        rule_catalogue: RULE_CATALOGUE,
        detectors: DETECTOR_META.map((d) => {
          const m = models.find((x) => x.name.includes(d.key) || x.family.toUpperCase().includes(d.name.split(" ")[0].toUpperCase()));
          return { ...d, metrics: m?.metrics ?? null, model: m?.name ?? null, version: m?.version ?? null };
        }),
      },
    );
  },
  { audit: "api.fraud.read" },
);
