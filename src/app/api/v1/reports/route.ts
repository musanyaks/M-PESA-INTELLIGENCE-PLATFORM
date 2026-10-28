import { api, envelope } from "@/lib/api";
import { getReports } from "@/lib/queries";
import { getModelRegistry } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async ({ search }) => {
    const report = search.get("report") ?? "executive";
    const data = await getReports();
    if (report === "models") {
      const models = await getModelRegistry();
      return envelope({
        report: "model_governance",
        models: models.map((m) => ({
          name: m.name, version: m.version, family: m.family, task: m.task, status: m.status,
          weight: m.weight, metrics: m.metrics, params: m.params, tracked_by: m.trackedBy,
          training_rows: m.trainingRows, train_duration_ms: m.trainDurationMs, trained_at: m.trainedAt,
          feature_importance: m.featureImportance,
        })),
      });
    }
    return envelope({
      report: "executive_financial_intelligence",
      generated_for: new Date().toISOString().slice(0, 10),
      window_days: data.overview.windowDays,
      headline: {
        transactions: data.overview.transactions,
        value: data.overview.value,
        fees_revenue: data.overview.fees,
        active_customers: data.overview.customers,
        active_merchants: data.overview.merchants,
        average_ticket: data.overview.avgTicket,
        flagged: data.overview.flagged,
        critical: data.overview.critical,
        fraud_exposure: data.overview.fraudValue,
        open_cases: data.overview.cases.open,
        national_projection: data.overview.projected,
      },
      breakdowns: { by_type: data.types, by_county: data.counties.slice(0, 20), by_channel: data.channels, by_hour: data.hours },
      models: data.models.map((m) => ({ name: m.name, version: m.version, task: m.task, status: m.status, metrics: m.metrics })),
    });
  },
  { audit: "api.reports.read" },
);
