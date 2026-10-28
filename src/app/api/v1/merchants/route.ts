import { db } from "@/db";
import { sql } from "drizzle-orm";
import { api, envelope } from "@/lib/api";
import { getMerchantList, getMerchantDetail } from "@/lib/queries";
import { ensureReady } from "@/lib/seed";

export const dynamic = "force-dynamic";

export const GET = api(
  "read:all",
  async ({ search }) => {
    await ensureReady();
    const id = search.get("id");
    if (id) {
      const detail = await getMerchantDetail(id);
      if (!detail) return envelope(null, { error: "not_found" });
      const { merchant, series, hours, counties, retention, benchmark } = detail;
      return envelope({
        merchant_dashboard: {
          id: merchant.code, name: merchant.name, category: merchant.category, county: merchant.county,
          till: merchant.tillNumber, paybill: merchant.paybill,
          revenue: merchant.revenue30d, transactions: merchant.txn30d, average_ticket: merchant.avgTicket,
          returning_customers: Math.round(merchant.uniqueCustomers * merchant.returningRate),
          unique_customers: merchant.uniqueCustomers, growth: Number(merchant.growthPct.toFixed(2)),
          fraud_risk: merchant.fraudRisk, peak_hour: merchant.peakHour,
          revenue_forecast_30d: merchant.forecastNext30d, benchmark_percentile: merchant.benchmarkPercentile,
        },
        retention: retention ? { returning: Number(retention.returning), first_time: Number(retention.first_time) } : null,
        category_benchmark: benchmark
          ? { merchants: Number(benchmark.n), avg_revenue: Number(benchmark.avg_revenue), avg_growth: Number(benchmark.avg_growth), avg_ticket: Number(benchmark.avg_ticket) }
          : null,
        revenue_series: series.map((s) => ({ day: s.day, count: Number(s.count), value: Number(s.value) })),
        peak_hours: hours.map((h) => ({ hour: Number(h.hour), count: Number(h.count), value: Number(h.value) })),
        geographic: counties.map((c) => ({ county: c.county, count: Number(c.count), value: Number(c.value) })),
      });
    }

    const rows = await getMerchantList({
      category: search.get("category") ?? undefined,
      county: search.get("county") ?? undefined,
      sort: search.get("sort") ?? "revenue",
      limit: Number(search.get("limit") ?? 50),
    });
    const facets = await db.execute(sql`
      SELECT category, count(*)::text AS count, sum(revenue_30d)::text AS revenue,
             round(avg(growth_pct)::numeric,1)::text AS growth, round(avg(avg_ticket))::text AS ticket
      FROM merchants WHERE status='ACTIVE' GROUP BY category ORDER BY sum(revenue_30d) DESC
    `) as unknown as { rows: { category: string; count: string; revenue: string; growth: string; ticket: string }[] };
    return envelope(
      rows.map((r) => ({
        merchant_id: r.code, name: r.name, category: r.category, county: r.county, till: r.till_number,
        revenue: r.revenue_30d, transactions: r.txn_30d, average_ticket: r.avg_ticket,
        unique_customers: r.unique_customers, returning_rate: Number(r.returning_rate.toFixed(3)),
        growth: Number(r.growth_pct.toFixed(2)), peak_hour: r.peak_hour, fraud_risk: r.fraud_risk,
        forecast_next_30d: r.forecast_next_30d, benchmark_percentile: r.benchmark_percentile,
      })),
      { count: rows.length, categories: facets.rows.map((f) => ({ category: f.category, merchants: Number(f.count), revenue: Number(f.revenue), growth: Number(f.growth), avg_ticket: Number(f.ticket) })) },
    );
  },
  { audit: "api.merchants.read" },
);
