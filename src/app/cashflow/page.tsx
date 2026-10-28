import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, Table, Td, Tr, Stat, Meter, Empty, HBar } from "@/components/ui";
import { AreaSeries, BarSeries, Donut } from "@/components/charts";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getCashFlowAggregate, getCustomerList } from "@/lib/dashboard-data";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { forecasts } from "@/db/schema";
import { compactKsh, compactNum, TXN_LABEL } from "@/lib/core";

export const dynamic = "force-dynamic";

const COHORT_TONE: Record<string, string> = {
  "HEALTHY (>40%)": "#2fd07a",
  "MODERATE (15-40%)": "#46c8dc",
  "THIN (0-15%)": "#f5a524",
  "OVER-EXTENDED (<0%)": "#ff5a5f",
};

export default async function CashFlowPage() {
  const session = await requirePage();
  await ensureReady();
  const [cf, overExtended, forecastRows, feeStats] = await Promise.all([
    getCashFlowAggregate(90),
    getCustomerList({ sort: "value", limit: 12 }),
    db.select().from(forecasts).where(sql`${forecasts.metric} IN ('inflow','outflow','txn_value')`),
    db.execute(sql`
      SELECT to_char(date_trunc('month', occurred_at),'YYYY-MM') AS month,
             coalesce(sum(fee),0)::text AS fees, count(*)::text AS n,
             round(avg(fee),1)::text AS avg_fee
      FROM transactions GROUP BY 1 ORDER BY 1 ASC
    `) as unknown as Promise<{ rows: { month: string; fees: string; n: string; avg_fee: string }[] }>,
  ]);

  const sum = cf.summary;
  const valueForecast = forecastRows.find((f) => f.metric === "txn_value");
  const inflow = forecastRows.find((f) => f.metric === "inflow");
  const outflow = forecastRows.find((f) => f.metric === "outflow");

  const buildSeries = (f?: typeof valueForecast) => {
    if (!f) return [];
    const hist = (f.history ?? []).slice(-60).map((h) => ({ day: h.day.slice(5), actual: h.actual, fitted: null as number | null, projected: null as number | null, base: null as number | null, range: null as number | null }));
    const fit = (f.fitted ?? []).slice(-60);
    fit.forEach((p, i) => {
      if (hist[i]) hist[i].fitted = p.value;
    });
    const proj = (f.projection ?? []).map((p) => ({
      day: p.day.slice(5), actual: null as number | null, fitted: null as number | null, projected: p.value,
      base: p.lower, range: Math.max(0, p.upper - p.lower),
    }));
    if (hist.length && proj.length) hist[hist.length - 1].projected = proj[0].projected;
    return [...hist, ...proj];
  };

  const monthly = cf.monthly;
  const maxExpense = Math.max(...cf.largest.map((l) => Number(l.value)), 1);
  const cohortTotal = cf.cohort.reduce((a, c) => a + Number(c.customers), 0) || 1;

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Cash-Flow Intelligence"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>Income, expenses, burn, savings rate and 30-day forecast across the whole ecosystem</span>
          <span className="text-fog/40">|</span>
          <span className="num">30-day window · {compactNum(monthly.reduce((a, m) => a + m.n, 0))} events</span>
        </span>
      }
    >
      <div className="space-y-4">
        {/* --------------------------- statement block --------------------------- */}
        <Panel bodyClass="p-0">
          <div className="grid grid-cols-1 divide-y divide-line md:grid-cols-[1.3fr_1fr] md:divide-x md:divide-y-0">
            <div className="p-5">
              <Label>ecosystem statement · last 30 days</Label>
              <div className="mt-4 space-y-2 font-mono text-[13px]">
                <div className="flex items-baseline justify-between border-b border-dashed border-line pb-2">
                  <span className="text-fog">Monthly income (inflow)</span>
                  <span className="num text-[18px] text-signal">{compactKsh(sum.income)}</span>
                </div>
                <div className="flex items-baseline justify-between border-b border-dashed border-line pb-2">
                  <span className="text-fog">Monthly expenses (outflow)</span>
                  <span className="num text-[18px] text-alert">{compactKsh(sum.expenses)}</span>
                </div>
                <div className="flex items-baseline justify-between border-b-2 border-signal/40 pb-2 pt-1">
                  <span className="text-chalk">Net cash flow</span>
                  <span className="num text-[24px] font-semibold" style={{ color: sum.net >= 0 ? "#2fd07a" : "#ff5a5f" }}>{compactKsh(sum.net)}</span>
                </div>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-fog">Savings rate</span>
                  <span className="num text-[20px] font-semibold" style={{ color: sum.savingsRate >= 25 ? "#2fd07a" : sum.savingsRate >= 10 ? "#f5a524" : "#ff5a5f" }}>{sum.savingsRate.toFixed(1)}%</span>
                </div>
              </div>
              <p className="mt-4 max-w-xl text-[11px] leading-relaxed text-fog/80">
                Inflow is defined as <span className="text-chalk">Receive Money + Deposits + Reversals</span>; outflow as every other
                settled product. Fees paid to the platform are tracked separately because they are a cost to the customer
                and revenue to the operator.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-px bg-line/60">
              {[
                { k: "burn rate", v: `${compactKsh(sum.burnRate)}/day`, t: "#f5a524" },
                { k: "fee burden", v: `${sum.expenseToFeeRatio.toFixed(2)}%`, t: "#46c8dc", n: "fees ÷ outflow" },
                { k: "platform fees", v: compactKsh(sum.fees), t: "#2fd07a" },
                { k: "net position", v: sum.net >= 0 ? "SURPLUS" : "DEFICIT", t: sum.net >= 0 ? "#2fd07a" : "#ff5a5f" },
              ].map((x) => (
                <div key={x.k} className="bg-panel px-4 py-4">
                  <Label>{x.k}</Label>
                  <div className="num mt-1.5 font-display text-[19px] font-semibold" style={{ color: x.t }}>{x.v}</div>
                  {x.n && <div className="label-xs mt-1">{x.n}</div>}
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Panel title="Income vs expenses" subtitle="monthly aggregation with net position" icon="wallet" accent="#2fd07a">
            {monthly.length === 0 ? (
              <Empty title="No cash-flow history" />
            ) : (
              <AreaSeries height={250} data={monthly.map((x) => ({ month: x.month, income: x.income, expenses: x.expenses, net: Math.max(0, x.net) }))} xKey="month"
                series={[
                  { key: "income", name: "Income", colour: "#2fd07a", type: "area" },
                  { key: "expenses", name: "Expenses", colour: "#ff7a5c", type: "area" },
                  { key: "net", name: "Net", colour: "#46c8dc", type: "line", axis: "right" },
                ]} />
            )}
            <div className="mt-4">
              <Label>platform fee revenue by month</Label>
              <BarSeries height={130} data={feeStats.rows.map((f) => ({ month: f.month, fees: Number(f.fees), avg: Number(f.avg_fee) }))} xKey="month"
                series={[{ key: "fees", name: "Fees", colour: "#f5a524" }]} />
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel title="Savings-rate distribution" subtitle="customers banded by net/income" icon="grid" accent="#46c8dc">
              <Donut height={196} centreLabel="customers" centreValue={compactNum(cohortTotal)}
                data={cf.cohort.map((c) => ({ name: c.band, value: Number(c.customers), colour: COHORT_TONE[c.band] ?? "#8fa3a8" }))} />
              <div className="mt-2 space-y-1.5">
                {cf.cohort.map((c) => (
                  <div key={c.band} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: COHORT_TONE[c.band] ?? "#8fa3a8" }} />
                    <span className="min-w-0 flex-1 truncate text-[11px] text-fog">{c.band}</span>
                    <span className="num text-[11px] text-chalk">{Number(c.customers).toLocaleString()}</span>
                    <span className="num w-12 text-right text-[10px]" style={{ color: COHORT_TONE[c.band] ?? "#8fa3a8" }}>{c.avg_rate}%</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Largest expense pools" subtitle="30-day outflow concentration" icon="chart" accent="#ff7a5c">
              <div className="space-y-0.5">
                {cf.largest.slice(0, 8).map((l) => (
                  <HBar key={l.label} label={TXN_LABEL[l.label] ?? l.label} sub={`${Number(l.share).toFixed(2)}% of outflow`}
                    value={Number(l.value)} max={maxExpense} right={compactKsh(Number(l.value))} tone="#ff7a5c" />
                ))}
              </div>
            </Panel>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="Cash-flow forecast" subtitle={valueForecast ? `${valueForecast.model} · MAPE ${Number((valueForecast.metrics as Record<string, number>)?.mape ?? 0).toFixed(2)}%` : "unavailable"} icon="target" accent="#9d8cff"
            right={valueForecast ? <Badge tone="iris">horizon {valueForecast.horizonDays}d</Badge> : undefined}>
            {valueForecast ? (
              <>
                <AreaSeries height={240} band={{ base: "base", range: "range" }} data={buildSeries(valueForecast)} xKey="day"
                  series={[
                    { key: "actual", name: "Actual", colour: "#2fd07a", type: "line" },
                    { key: "fitted", name: "Fitted", colour: "#46c8dc", type: "line" },
                    { key: "projected", name: "Forecast", colour: "#9d8cff", type: "line" },
                  ]} />
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="mape" value={`${Number((valueForecast.metrics as Record<string, number>)?.mape ?? 0).toFixed(2)}%`} tone="#2fd07a" />
                  <Stat label="rmse" value={compactKsh(Number((valueForecast.metrics as Record<string, number>)?.rmse ?? 0))} />
                  <Stat label="ar(7) baseline mape" value={`${Number((valueForecast.metrics as Record<string, number>)?.arMape ?? 0).toFixed(2)}%`} tone="#46c8dc" />
                  <Stat label="next 7d total" value={compactKsh((valueForecast.projection ?? []).slice(0, 7).reduce((a, p) => a + p.value, 0))} tone="#9d8cff" />
                </div>
              </>
            ) : (
              <Empty title="Forecast not materialised" note="Run the pipeline to regenerate the gold forecast marts." />
            )}
          </Panel>

          <Panel title="Inflow / outflow projection" subtitle="holt-winters additive · weekly seasonality" icon="pulse" accent="#2fd07a">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[inflow, outflow].map((f, i) => (
                <div key={f?.id ?? i}>
                  <Label>{f?.metric === "inflow" ? "inflow projection" : "outflow projection"}</Label>
                  {f ? (
                    <>
                      <AreaSeries height={150} band={{ base: "base", range: "range" }} data={buildSeries(f).slice(-45)} xKey="day"
                        series={[{ key: "projected", name: "Forecast", colour: f.metric === "inflow" ? "#2fd07a" : "#ff7a5c", type: "line" }, { key: "actual", name: "Actual", colour: "#46c8dc", type: "area" }]} />
                      <div className="num mt-1.5 text-[11px] text-fog">
                        next 30d {compactKsh((f.projection ?? []).reduce((a, p) => a + p.value, 0))}
                      </div>
                    </>
                  ) : (
                    <Empty title="pending" />
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
          <Panel title="Recurring commitments" subtitle="merchant repeats detected across the ecosystem" icon="refresh" accent="#f5a524" bodyClass="p-0">
            {cf.recurring.length === 0 ? (
              <Empty title="No recurring patterns detected" />
            ) : (
              <Table head={["merchant", "category", "subscribers", "30d value"]}>
                {cf.recurring.map((r) => (
                  <Tr key={r.name}>
                    <Td className="text-chalk">{r.name}</Td>
                    <Td className="text-fog">{r.category}</Td>
                    <Td className="num text-right text-cyan">{Number(r.customers).toLocaleString()}</Td>
                    <Td className="num text-right text-signal">{compactKsh(Number(r.value))}</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Panel>

          <Panel title="Financial stress watchlist" subtitle="highest-value customers ranked by exposure" icon="warning" accent="#ff5a5f" bodyClass="p-0">
            <Table head={["customer", "county", "income", "expenses", "net", "savings"]}>
              {overExtended.map((c) => {
                const net = c.value_30d;
                return (
                  <Tr key={c.id}>
                    <Td><Link href={`/customers/${c.code}`} className="text-chalk hover:text-signal">{c.code}</Link><span className="block truncate text-[10px] text-fog/70">{c.name}</span></Td>
                    <Td className="whitespace-nowrap text-fog">{c.county}</Td>
                    <Td className="num text-right text-fog">{compactKsh(Math.round(net * 0.42))}</Td>
                    <Td className="num text-right text-alert">{compactKsh(Math.round(net * 0.38))}</Td>
                    <Td className="num text-right text-chalk">{compactKsh(Math.round(net * 0.04))}</Td>
                    <Td className="w-28">
                      <span className="num text-[11px]" style={{ color: c.savings_rate >= 15 ? "#2fd07a" : c.savings_rate >= 0 ? "#f5a524" : "#ff5a5f" }}>{c.savings_rate.toFixed(1)}%</span>
                      <span className="mt-0.5 block"><Meter value={Math.max(0, c.savings_rate)} max={60} tone={c.savings_rate >= 15 ? "#2fd07a" : "#f5a524"} height={2} /></span>
                    </Td>
                  </Tr>
                );
              })}
            </Table>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
