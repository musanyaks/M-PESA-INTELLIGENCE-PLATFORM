import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, Table, Td, Tr, Stat, Meter, Empty, HBar, Icon } from "@/components/ui";
import { AreaSeries, BarSeries } from "@/components/charts";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getMerchantList, getMerchantDetail } from "@/lib/dashboard-data";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { MERCHANT_CATEGORIES } from "@/lib/simulator";
import { compactKsh, compactNum } from "@/lib/core";

export const dynamic = "force-dynamic";

const SORTS = [
  { key: "revenue", label: "revenue" },
  { key: "growth", label: "growth" },
  { key: "customers", label: "customers" },
  { key: "risk", label: "risk" },
] as const;

export default async function MerchantsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await requirePage();
  await ensureReady();
  const sp = await searchParams;
  const sort = (SORTS.some((s) => s.key === sp.sort) ? sp.sort : "revenue") as string;
  const category = sp.category ?? "ALL";
  const id = sp.id ?? null;

  const [rows, categories, detail] = await Promise.all([
    getMerchantList({ category, sort, limit: 60 }),
    db.execute(sql`
      SELECT category, count(*)::text AS n, coalesce(sum(revenue_30d),0)::text AS revenue,
             round(avg(growth_pct)::numeric,1)::text AS growth, round(avg(returning_rate)::numeric,3)::text AS returning,
             round(avg(benchmark_percentile))::text AS percentile,
             count(*) filter (where fraud_risk='HIGH')::text AS high_risk
      FROM merchants WHERE status='ACTIVE' GROUP BY category ORDER BY sum(revenue_30d) DESC
    `) as unknown as Promise<{ rows: { category: string; n: string; revenue: string; growth: string; returning: string; percentile: string; high_risk: string }[] }>,
    id ? getMerchantDetail(id) : Promise.resolve(null),
  ]);

  const cats = categories.rows;
  const maxRev = Math.max(...cats.map((c) => Number(c.revenue)), 1);
  const m = detail?.merchant;

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Merchant Intelligence"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>Acquirer performance · retention · forecasting · category benchmarking</span>
          <span className="text-fog/40">|</span>
          <span className="num">{cats.reduce((a, c) => a + Number(c.n), 0).toLocaleString()} active merchants</span>
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          {SORTS.map((x) => (
            <Link key={x.key} href={`/merchants?sort=${x.key}&category=${encodeURIComponent(category)}${id ? `&id=${id}` : ""}`}
              className={`rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${sort === x.key ? "border-signal/50 bg-signal/15 text-signal" : "border-line bg-panel text-fog hover:border-line-2 hover:text-chalk"}`}>
              {x.label}
            </Link>
          ))}
        </div>
      }
    >
      <div className="space-y-4">
        {m && detail && (
          <Panel
            title={m.name}
            subtitle={`${m.category} · ${m.county} · till ${m.tillNumber}${m.paybill ? ` · paybill ${m.paybill}` : ""}`}
            icon="store"
            right={
              <div className="flex items-center gap-2">
                <Badge tone={m.fraudRisk === "HIGH" ? "alert" : m.fraudRisk === "MEDIUM" ? "amber" : "signal"}>fraud {m.fraudRisk}</Badge>
                <Link href="/merchants" className="font-mono text-[10px] uppercase tracking-[0.12em] text-fog hover:text-alert">close</Link>
              </div>
            }
          >
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
              <div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="revenue 30d" value={compactKsh(m.revenue30d)} tone="#2fd07a" />
                  <Stat label="transactions" value={m.txn30d.toLocaleString()} />
                  <Stat label="average ticket" value={compactKsh(m.avgTicket)} />
                  <Stat label="unique customers" value={m.uniqueCustomers.toLocaleString()} />
                  <Stat label="returning" value={`${(m.returningRate * 100).toFixed(1)}%`} tone="#46c8dc" />
                  <Stat label="growth" value={`${m.growthPct >= 0 ? "+" : ""}${m.growthPct.toFixed(1)}%`} tone={m.growthPct >= 0 ? "#2fd07a" : "#ff5a5f"} />
                </div>
                <div className="mt-4">
                  <Label>daily revenue</Label>
                  <AreaSeries height={190} data={detail.series.slice(-45).map((s) => ({ day: s.day.slice(5), revenue: Number(s.value), volume: Number(s.count) }))} xKey="day"
                    series={[{ key: "revenue", name: "Revenue", colour: "#2fd07a", type: "area" }, { key: "volume", name: "Txn", colour: "#46c8dc", type: "line", axis: "right" }]} />
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <Label>peak hours</Label>
                  <BarSeries height={150} data={detail.hours.map((h) => ({ hour: `${String(h.hour).padStart(2, "0")}h`, v: Number(h.count) }))} xKey="hour"
                    series={[{ key: "v", name: "Transactions", colour: "#f5a524" }]} />
                </div>
                <div>
                  <Label>catchment counties</Label>
                  <div className="mt-2 space-y-0.5">
                    {detail.counties.slice(0, 6).map((c) => (
                      <HBar key={c.county} label={c.county} value={Number(c.value)} max={Math.max(...detail.counties.map((x) => Number(x.value)), 1)} right={compactKsh(Number(c.value))} tone="#46c8dc" />
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line/60">
                  <div className="bg-panel px-3 py-2"><Label>30-day forecast</Label><div className="num mt-1 text-[14px] text-signal">{compactKsh(m.forecastNext30d)}</div></div>
                  <div className="bg-panel px-3 py-2"><Label>category percentile</Label><div className="num mt-1 text-[14px] text-cyan">P{m.benchmarkPercentile}</div></div>
                </div>
                {detail.benchmark && (
                  <div className="rounded-[3px] border border-line bg-black/25 p-3">
                    <Label>category benchmark · {m.category}</Label>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <Stat label="avg revenue" value={compactKsh(Number(detail.benchmark.avg_revenue))} />
                      <Stat label="avg ticket" value={compactKsh(Number(detail.benchmark.avg_ticket))} />
                      <Stat label="avg growth" value={`${Number(detail.benchmark.avg_growth).toFixed(1)}%`} />
                      <Stat label="peers" value={Number(detail.benchmark.n)} />
                    </div>
                    <div className="mt-3">
                      <Label>this merchant vs category</Label>
                      <div className="mt-1.5"><Meter value={m.benchmarkPercentile} tone="#2fd07a" /></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Panel>
        )}

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Panel title="Merchant register" subtitle={`${rows.length} merchants · sorted by ${sort}`} icon="store" bodyClass="p-0"
            right={<Badge tone={category === "ALL" ? "neutral" : "cyan"}>{category === "ALL" ? "all verticals" : category.toLowerCase()}</Badge>}>
            {rows.length === 0 ? (
              <Empty title="No merchants in this category" />
            ) : (
              <Table head={["merchant", "category", "county", "revenue", "txn", "ticket", "customers", "returning", "growth", "p-ctl", "risk"]}>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/merchants?id=${r.id}&sort=${sort}&category=${encodeURIComponent(category)}`} className="text-chalk hover:text-signal">{r.name}</Link>
                      <span className="num block text-[10px] text-fog/70">{r.code} · till {r.till_number}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-fog">{r.category}</Td>
                    <Td className="whitespace-nowrap text-fog">{r.county}</Td>
                    <Td className="num whitespace-nowrap text-right text-signal">{compactKsh(r.revenue_30d)}</Td>
                    <Td className="num text-right text-chalk">{r.txn_30d.toLocaleString()}</Td>
                    <Td className="num whitespace-nowrap text-right text-fog">{compactKsh(r.avg_ticket)}</Td>
                    <Td className="num text-right text-fog">{r.unique_customers.toLocaleString()}</Td>
                    <Td className="num text-right text-cyan">{(r.returning_rate * 100).toFixed(0)}%</Td>
                    <Td className="num text-right" style={{ color: r.growth_pct >= 0 ? "#2fd07a" : "#ff5a5f" }}>{r.growth_pct >= 0 ? "+" : ""}{r.growth_pct.toFixed(1)}%</Td>
                    <Td className="num text-right text-fog">P{r.benchmark_percentile}</Td>
                    <Td><Badge tone={r.fraud_risk === "HIGH" ? "alert" : r.fraud_risk === "MEDIUM" ? "amber" : "signal"}>{r.fraud_risk}</Badge></Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel title="Category filter" subtitle="revenue concentration by vertical" icon="grid" accent="#f5a524">
              <div className="flex flex-wrap gap-1.5">
                <Link href={`/merchants?sort=${sort}&category=ALL`} className={`rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${category === "ALL" ? "border-signal/50 bg-signal/15 text-signal" : "border-line bg-panel text-fog hover:text-chalk"}`}>
                  all · {cats.reduce((a, c) => a + Number(c.n), 0)}
                </Link>
                {MERCHANT_CATEGORIES.map((c) => {
                  const row = cats.find((x) => x.category === c);
                  if (!row) return null;
                  return (
                    <Link key={c} href={`/merchants?sort=${sort}&category=${encodeURIComponent(c)}`}
                      className={`rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.08em] transition-colors ${category === c ? "border-signal/50 bg-signal/15 text-signal" : "border-line bg-panel text-fog hover:border-line-2 hover:text-chalk"}`}>
                      {c.toLowerCase()} · {row.n}
                    </Link>
                  );
                })}
              </div>
            </Panel>

            <Panel title="Category league" subtitle="settled revenue · 30 days" icon="chart" accent="#2fd07a">
              <div className="space-y-0.5">
                {cats.map((c) => (
                  <HBar key={c.category} label={c.category} sub={`${c.n} merchants · ${compactNum(Number(c.revenue))} · growth ${c.growth}%`}
                    value={Number(c.revenue)} max={maxRev} right={compactKsh(Number(c.revenue))}
                    tone={Number(c.high_risk) > 0 ? "#f5a524" : "#2fd07a"} />
                ))}
              </div>
            </Panel>

            <Panel title="Retention & loyalty" subtitle="returning-customer rate per vertical" icon="users" accent="#46c8dc" bodyClass="p-0">
              <Table head={["category", "merchants", "returning", "growth", "high risk"]}>
                {cats.map((c) => (
                  <Tr key={c.category}>
                    <Td className="text-chalk">{c.category}</Td>
                    <Td className="num text-right text-fog">{c.n}</Td>
                    <Td className="num text-right text-cyan">{(Number(c.returning) * 100).toFixed(1)}%</Td>
                    <Td className="num text-right" style={{ color: Number(c.growth) >= 0 ? "#2fd07a" : "#ff5a5f" }}>{Number(c.growth) >= 0 ? "+" : ""}{c.growth}%</Td>
                    <Td className="num text-right text-alert">{c.high_risk}</Td>
                  </Tr>
                ))}
              </Table>
            </Panel>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-[3px] border border-line bg-panel px-3 py-2 font-mono text-[10px] text-fog/70">
          <Icon name="code" className="h-3 w-3 text-cyan" />
          GET /api/v1/merchants?category={category}&sort={sort}&limit=60 {id ? `· GET /api/v1/merchants?id=${id}` : ""}
        </div>
      </div>
    </Shell>
  );
}
