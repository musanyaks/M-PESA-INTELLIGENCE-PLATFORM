import { api, envelope } from "@/lib/api";
import { getPredictions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async ({ search }) => {
    const model = search.get("model") ?? "all";
    const p = await getPredictions();
    const data: Record<string, unknown> = {};

    if (model === "all" || model === "cashflow") {
      data.cash_flow_forecast = p.forecasts.map((f) => ({
        metric: f.metric, model: f.model, granularity: f.granularity, horizon_days: f.horizonDays,
        metrics: f.metrics,
        history: f.history?.slice(-60),
        projection: f.projection,
      }));
    }
    if (model === "all" || model === "churn") {
      data.churn = {
        model: "customer-churn-logistic v1.6.2",
        bands: p.churnBands.map((b) => ({ band: b.band, customers: Number(b.count) })),
        watchlist: p.churn.slice(0, 15).map((c) => ({
          customer_id: c.code, name: c.name, county: c.county, segment: c.segment_name,
          churn_probability: Number(c.churn_probability.toFixed(4)), status: c.status,
          monthly_transactions: c.txn_30d, monthly_value: c.value_30d,
        })),
      };
      data.transact_tomorrow = p.transactTomorrow
        ? { likely: Number(p.transactTomorrow.likely), unlikely: Number(p.transactTomorrow.unlikely) }
        : null;
    }
    if (model === "all" || model === "spend") {
      data.spending_prediction = p.spend.map((c) => ({
        customer_id: c.code, name: c.name, county: c.county,
        current_monthly_spend: c.monthly_expenses, predicted_next_month_spend: c.expected_monthly_spend,
        delta_pct: c.monthly_expenses ? Number((((c.expected_monthly_spend - c.monthly_expenses) / c.monthly_expenses) * 100).toFixed(2)) : 0,
        savings_rate: Number(c.savings_rate.toFixed(2)),
      }));
    }
    if (model === "all" || model === "registry") {
      data.models = p.models.map((m) => ({
        name: m.name, version: m.version, family: m.family, task: m.task, status: m.status,
        metrics: m.metrics, tracked_by: m.trackedBy, trained_at: m.trainedAt, training_rows: m.trainingRows,
      }));
    }
    return envelope(data, { model, generated_at: new Date().toISOString() });
  },
  { audit: "api.predictions.read" },
);
