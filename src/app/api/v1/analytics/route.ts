import { api, envelope } from "@/lib/api";
import {
  getOverview, getVolumeSeries, getTypeBreakdown, getChannelMix, getHourProfile,
  getCountyBreakdown, getFraudTrend, getCashFlowAggregate,
} from "@/lib/queries";
import { streamStatus } from "@/lib/stream";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async ({ search }) => {
    const days = Number(search.get("days") ?? 30);
    const seriesDays = Number(search.get("series_days") ?? 90);
    const [overview, series, types, channels, hours, counties, fraud, cashflow] = await Promise.all([
      getOverview(days),
      getVolumeSeries(seriesDays),
      getTypeBreakdown(days),
      getChannelMix(days),
      getHourProfile(days),
      getCountyBreakdown(days),
      getFraudTrend(seriesDays),
      getCashFlowAggregate(seriesDays),
    ]);
    const stream = streamStatus();
    return envelope(
      {
        overview,
        volume_series: series.map((s) => ({
          day: s.day, count: Number(s.count), value: Number(s.value), fees: Number(s.fees),
          avg_ticket: Number(s.avg_ticket), flagged: Number(s.flagged), fraud: Number(s.fraud), customers: Number(s.customers),
        })),
        transaction_types: types,
        channels,
        hour_profile: hours,
        counties,
        fraud_trend: fraud.map((f) => ({ day: f.day, flagged: Number(f.flagged), critical: Number(f.critical), value: Number(f.value) })),
        cash_flow: cashflow,
      },
      { window_days: days, series_days: seriesDays, stream: { running: stream.running, live_tps: stream.liveTps, produced: stream.produced } },
    );
  },
  { audit: "api.analytics.read" },
);
