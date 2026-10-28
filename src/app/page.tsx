import Link from "next/link";
import { Shell } from "@/components/shell";
import { LiveStream } from "@/components/live";
import { Panel, KPI, Badge, HBar, Label, Meter, RiskTag, Icon, Empty, Table, Td, Tr, Stat } from "@/components/ui";
import { AreaSeries, Donut, RiskGauge, HeatStrip } from "@/components/charts";
import { requirePage } from "@/lib/auth";
import { ensureReady, TWIN_SCALE } from "@/lib/seed";
import {
  getOverview, getVolumeSeries, getTypeBreakdown, getCountyBreakdown,
  getSegments, getFraudSummary, getChannelMix, getHourProfile, getMerchantList, getTopTransactions,
  streamStatusSafe,
} from "@/lib/dashboard-data";
import { compactKsh, compactNum, TXN_LABEL, RISK_COLOUR } from "@/lib/core";

export const dynamic = "force-dynamic";

export default async function CommandCentre() {
  const session = await requirePage();
  await ensureReady();
  const data = await streamStatusSafe();
  const [overview, series, types, counties, segs, fraud, channels, hours, topMerchants, topTxns] = await Promise.all([
    getOverview(30), getVolumeSeries(60), getTypeBreakdown(30), getCountyBreakdown(30),
    getSegments(), getFraudSummary(), getChannelMix(30), getHourProfile(30), getMerchantList({ limit: 6 }),
    getTopTransactions({ limit: 6 }),
  ]);
  const bigTxns = topTxns;
  void data;

  const volumeData = series.map((s) => ({
    day: s.day.slice(5),
    volume: Number(s.count),
    value: Number(s.value),
    flagged: Number(s.flagged),
  }));
  const maxType = Math.max(...types.map((t) => t.value), 1);
  const maxChannel = Math.max(...channels.map((c) => c.count), 1);
  const maxCounty = Math.max(...counties.map((c) => c.value), 1);
  const levelCounts = fraud.byLevel.map((l) => ({ level: l.level, count: Number(l.count), value: Number(l.value) }));
  const totalCases = levelCounts.reduce((a, b) => a + b.count, 0) || 1;

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Financial Intelligence Command Centre"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>30-day rolling window over the synthetic M-PESA twin</span>
          <span className="text-fog/40">|</span>
          <span className="num">{overview.transactions.toLocaleString()} conformed facts</span>
          <span className="text-fog/40">|</span>
          <span className="num text-signal/80">≈ {compactNum(overview.projected.transactions)} nationalised (1:{TWIN_SCALE})</span>
        </span>
      }
      actions={
        <Link href="/pipeline" className="hidden items-center gap-1.5 rounded-[3px] border border-line bg-panel px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fog transition-colors hover:border-signal/40 hover:text-signal sm:flex">
          <Icon name="layers" className="h-3 w-3" /> pipeline
        </Link>
      }
    >
      <div className="space-y-4">
        {/* ------------------------------ KPI strip ----------------------------- */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KPI label="Transactions" value={compactNum(overview.transactions)} delta={overview.deltas.transactions} icon="pulse"
            projected={compactNum(overview.projected.transactions)}
            sub={<span className="num">{overview.failed.toLocaleString()} failed · {overview.reversals.toLocaleString()} reversals</span>} />
          <KPI label="Transaction value" value={compactKsh(overview.value)} delta={overview.deltas.value} icon="wallet" tone="#46c8dc"
            projected={compactKsh(overview.projected.value)}
            sub={<span className="num">fees {compactKsh(overview.fees)} · avg ticket {compactKsh(overview.avgTicket)}</span>} />
          <KPI label="Active customers" value={compactNum(overview.customers)} delta={overview.deltas.customers} icon="users" tone="#9d8cff"
            projected={compactNum(overview.projected.customers)}
            sub={<span className="num">{overview.merchants.toLocaleString()} merchants transacting</span>} />
          <KPI label="Fraud flagged" value={compactNum(overview.flagged)} delta={overview.deltas.fraud} icon="shield" tone="#ff5a5f"
            projected={compactNum(overview.projected.fraud)}
            sub={<span className="num">{overview.cases.open} open cases · exposure {compactKsh(overview.fraudValue)}</span>} />
        </div>

        {/* --------------------- volume + fraud monitoring ---------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.85fr_1fr]">
          <Panel
            title="Transaction volume & value"
            subtitle="daily conformed facts from the gold mart · last 60 days"
            icon="chart"
            right={
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-fog"><span className="h-2 w-2 rounded-[1px] bg-signal" /> count</span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-fog"><span className="h-2 w-2 rounded-[1px] bg-cyan" /> value</span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-fog"><span className="h-2 w-2 rounded-[1px] bg-alert" /> flagged</span>
              </div>
            }
          >
            <AreaSeries
              data={volumeData}
              xKey="day"
              height={268}
              series={[
                { key: "value", name: "Value (KSh)", colour: "#46c8dc", type: "area" },
                { key: "volume", name: "Transactions", colour: "#2fd07a", type: "bar", axis: "right" },
                { key: "flagged", name: "Flagged", colour: "#ff5a5f", type: "line", axis: "right" },
              ]}
            />
          </Panel>

          <Panel title="Fraud monitoring" subtitle="ensemble verdicts · rule engine · case queue" icon="shield" accent="#ff5a5f">
            <div className="flex items-center gap-4">
              <RiskGauge score={Math.round(levelCounts.reduce((a, b) => a + b.count * (b.level === "CRITICAL" ? 92 : b.level === "HIGH" ? 72 : 52), 0) / totalCases)} size={132} />
              <div className="min-w-0 flex-1 space-y-2">
                {(["CRITICAL", "HIGH", "ELEVATED", "NORMAL"] as const).map((lvl) => {
                  const row = levelCounts.find((l) => l.level === lvl);
                  const count = row?.count ?? 0;
                  return (
                    <div key={lvl}>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: RISK_COLOUR[lvl] }}>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_COLOUR[lvl] }} /> {lvl}
                        </span>
                        <span className="num text-[11px] text-chalk">{count.toLocaleString()}</span>
                      </div>
                      <div className="mt-1"><Meter value={count} max={totalCases} tone={RISK_COLOUR[lvl]} height={3} /></div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-line bg-line/60">
              <div className="bg-panel px-2.5 py-2"><Label>open cases</Label><div className="num mt-0.5 text-[15px] text-amber">{overview.cases.open}</div></div>
              <div className="bg-panel px-2.5 py-2"><Label>MTTA</Label><div className="num mt-0.5 text-[15px] text-chalk">{Number(fraud.totals?.mtta ?? 0)}m</div></div>
              <div className="bg-panel px-2.5 py-2"><Label>loss averted</Label><div className="num mt-0.5 text-[15px] text-signal">{compactKsh(Number(fraud.totals?.loss ?? 0))}</div></div>
            </div>

            <div className="mt-4">
              <Label>top triggered policies</Label>
              <div className="mt-2 space-y-0.5">
                {fraud.byRule.slice(0, 5).map((r) => (
                  <HBar key={r.rule} label={r.rule} value={Number(r.count)} max={Math.max(...fraud.byRule.map((x) => Number(x.count)), 1)} tone="#ff5a5f" />
                ))}
                {fraud.byRule.length === 0 && <Empty title="No policy triggers yet" note="Start the producer to generate live verdicts." />}
              </div>
            </div>

            <Link href="/fraud" className="mt-4 flex items-center justify-center gap-2 rounded-[3px] border border-line bg-black/30 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fog transition-colors hover:border-alert/40 hover:text-alert">
              open fraud investigation desk <Icon name="right" className="h-3 w-3" />
            </Link>
          </Panel>
        </div>

        {/* ---------------- segments · categories · channels ------------------- */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Customer segments" subtitle="k-means++ · k=6 · behavioural space" icon="users" accent="#9d8cff">
            <Donut
              height={196}
              centreLabel="customers"
              centreValue={compactNum(segs.reduce((a, s) => a + s.size, 0))}
              data={segs.map((s) => ({ name: s.name, value: s.size, colour: s.colour }))}
            />
            <div className="mt-3 space-y-1.5">
              {segs.slice(0, 4).map((s) => (
                <Link key={s.id} href={`/customers?segment=${encodeURIComponent(s.name)}`} className="flex items-center gap-2 rounded-[2px] px-1 py-0.5 transition-colors hover:bg-white/[0.03]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.colour }} />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-chalk/90">{s.name}</span>
                  <span className="num text-[11px] text-fog">{s.size.toLocaleString()}</span>
                  <span className="num w-11 text-right text-[10px] text-fog/70">{s.share.toFixed(1)}%</span>
                </Link>
              ))}
            </div>
            <Link href="/customers" className="mt-3 flex items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-fog transition-colors hover:text-signal">
              segment explorer <Icon name="right" className="h-3 w-3" />
            </Link>
          </Panel>

          <Panel title="Transaction categories" subtitle="by settled value · 30 days" icon="grid" accent="#46c8dc">
            <div className="space-y-0.5">
              {types.slice(0, 8).map((t) => (
                <HBar
                  key={t.type}
                  label={TXN_LABEL[t.type] ?? t.type}
                  sub={`${compactNum(t.count)} txn · avg ${compactKsh(t.avgAmount)}`}
                  value={t.value}
                  max={maxType}
                  right={compactKsh(t.value)}
                  tone={t.risk > 55 ? "#ff5a5f" : t.risk > 35 ? "#f5a524" : "#46c8dc"}
                />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[3px] border border-line bg-line/60">
              {channels.slice(0, 3).map((c) => (
                <div key={c.channel} className="bg-panel px-2.5 py-2">
                  <Label>{c.channel}</Label>
                  <div className="num mt-0.5 text-[12px] text-chalk">{((c.count / maxChannel) * 100).toFixed(0)}%</div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Activity rhythm" subtitle="hour-of-day intensity & county concentration" icon="gauge" accent="#f5a524">
            <Label>transactions by hour (utc)</Label>
            <div className="mt-2">
              <HeatStrip
                height={64}
                cells={Array.from({ length: 24 }, (_, h) => {
                  const row = hours.find((x) => x.hour === h);
                  return { label: `${String(h).padStart(2, "0")}:00`, value: row?.count ?? 0, max: Math.max(...hours.map((x) => x.count), 1) };
                })}
              />
              <div className="mt-1 flex justify-between font-mono text-[9px] text-fog/60">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
              </div>
            </div>
            <div className="mt-4">
              <Label>top counties by value</Label>
              <div className="mt-2 space-y-0.5">
                {counties.slice(0, 6).map((c) => (
                  <HBar key={c.county} label={c.county} value={c.value} max={maxCounty} right={compactKsh(c.value)}
                    tone={c.risk > 45 ? "#ff5a5f" : c.risk > 30 ? "#f5a524" : "#2fd07a"}
                    sub={`${compactNum(c.count)} txn · risk ${c.risk}`} />
                ))}
              </div>
            </div>
          </Panel>
        </div>

        {/* --------------------------- live stream ----------------------------- */}
        <LiveStream limit={16} />

        {/* ------------------------ merchants + ops table ---------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.3fr]">
          <Panel title="Merchant performance" subtitle="top revenue contributors · 30 days" icon="store" accent="#2fd07a"
            right={<Link href="/merchants" className="font-mono text-[10px] uppercase tracking-[0.12em] text-fog hover:text-signal">all merchants</Link>}>
            <div className="space-y-2.5">
              {topMerchants.slice(0, 6).map((m) => (
                <Link key={m.id} href={`/merchants?id=${m.id}`} className="block rounded-[3px] border border-line/70 bg-black/20 p-2.5 transition-colors hover:border-signal/30">
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[2px] border border-line-2 bg-panel-2 font-mono text-[9px] text-cyan">
                      {m.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-chalk">{m.name}</span>
                    <Badge tone={m.fraud_risk === "HIGH" ? "alert" : m.fraud_risk === "MEDIUM" ? "amber" : "signal"}>{m.fraud_risk}</Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="num text-[12px] text-signal">{compactKsh(m.revenue_30d)}</span>
                    <span className="num text-[10px] text-fog">{m.txn_30d.toLocaleString()} txn · ticket {compactKsh(m.avg_ticket)}</span>
                    <span className={`num text-[10px] ${m.growth_pct >= 0 ? "text-signal" : "text-alert"}`}>
                      {m.growth_pct >= 0 ? "+" : ""}{m.growth_pct.toFixed(1)}%
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title="Operational health" subtitle="platform service levels & data quality" icon="cpu" accent="#46c8dc">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="success rate" value={`${(100 - (overview.failed / Math.max(1, overview.transactions)) * 100).toFixed(2)}%`} tone="#2fd07a" />
              <Stat label="reversal rate" value={`${((overview.reversals / Math.max(1, overview.transactions)) * 100).toFixed(2)}%`} />
              <Stat label="flag rate" value={`${((overview.flagged / Math.max(1, overview.transactions)) * 100).toFixed(2)}%`} tone="#f5a524" />
              <Stat label="fee yield" value={`${((overview.fees / Math.max(1, overview.value)) * 100).toFixed(2)}%`} tone="#46c8dc" />
            </div>
            <div className="mt-4">
              <Label>channel mix</Label>
              <div className="mt-2 space-y-0.5">
                {channels.map((c) => (
                  <HBar key={c.channel} label={c.channel} value={c.count} max={maxChannel} right={`${((c.count / maxChannel) * 100).toFixed(1)}%`}
                    tone={c.risk > 45 ? "#ff5a5f" : "#46c8dc"} sub={`avg risk ${c.risk} · ${compactKsh(c.value)}`} />
                ))}
              </div>
            </div>
            <div className="mt-4">
              <Label>largest settled transactions · 30 days</Label>
              <Table head={["txn id", "type", "county", "amount", "risk"]} className="mt-1.5">
                {bigTxns.map((t) => (
                  <Tr key={t.id}>
                    <Td className="num text-[11px] text-fog">{t.code}</Td>
                    <Td className="whitespace-nowrap">{TXN_LABEL[t.type] ?? t.type}</Td>
                    <Td className="whitespace-nowrap text-fog">{t.county}</Td>
                    <Td className="num whitespace-nowrap text-right text-chalk">{compactKsh(t.amount)}</Td>
                    <Td className="text-right"><RiskTag level={t.riskLevel} score={t.riskScore} /></Td>
                  </Tr>
                ))}
              </Table>
            </div>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
