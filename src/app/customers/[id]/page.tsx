import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, Table, Td, Tr, Stat, Meter, Empty, RiskTag, Icon } from "@/components/ui";
import { AreaSeries, RadarProfile, Donut } from "@/components/charts";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getCustomer360 } from "@/lib/dashboard-data";
import { compactKsh, compactNum, maskMsisdn, maskName, TXN_LABEL } from "@/lib/core";

export const dynamic = "force-dynamic";

const PALETTE = ["#2fd07a", "#46c8dc", "#f5a524", "#9d8cff", "#ff7a5c", "#ff5a5f", "#7dd3a8", "#c084fc"];

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage();
  await ensureReady();
  const { id } = await params;
  const detail = await getCustomer360(id);
  if (!detail) notFound();
  const { customer: c, series, types, merchantsUsed, recurring, riskHistory, recent, segment, peer } = detail;

  const full = session.role === "ADMIN";
  const name = full ? c.name : maskName(c.name);
  const msisdn = full ? c.msisdn : maskMsisdn(c.msisdn);

  const chart = series.slice(-45).map((s) => ({
    day: s.day.slice(5),
    inflow: Number(s.inflow),
    outflow: Number(s.outflow),
    count: Number(s.count),
  }));
  const totalValue = types.reduce((a, t) => a + Number(t.value), 0) || 1;
  const riskTotal = riskHistory.reduce((a, r) => a + Number(r.count), 0) || 1;

  const norm = (v: number, max: number) => Math.min(100, Math.round((v / Math.max(1, max)) * 100));
  const radar = [
    { axis: "frequency", value: norm(c.txn30d, 90), peer: norm(Number(peer?.avg_txn ?? 0), 90) },
    { axis: "value", value: norm(c.value30d, 600000), peer: norm(Number(peer?.avg_value ?? 0), 600000) },
    { axis: "ticket", value: norm(c.avgTicket, 40000), peer: norm(Number(peer?.avg_value ?? 0) / Math.max(1, Number(peer?.avg_txn ?? 1)), 40000) },
    { axis: "digital", value: Math.round(c.digitalRatio * 100), peer: Math.round((segment?.digitalRatio ?? 0) * 100) },
    { axis: "risk", value: c.riskScore, peer: Number(peer?.avg_risk ?? 0) },
    { axis: "savings", value: Math.max(0, Math.min(100, Math.round(c.savingsRate))), peer: 35 },
  ];

  const churn = Number(c.churnProbability);
  const churnBand = churn >= 0.75 ? "SEVERE" : churn >= 0.5 ? "HIGH" : churn >= 0.3 ? "MODERATE" : "LOW";
  const churnTone = churn >= 0.5 ? "#ff5a5f" : churn >= 0.3 ? "#f5a524" : "#2fd07a";

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Customer 360"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <Link href="/customers" className="text-cyan hover:underline">← register</Link>
          <span className="text-fog/40">|</span>
          <span className="num">{c.code}</span>
          <span className="text-fog/40">|</span>
          <span>{c.county}</span>
          {segment && <Badge tone="iris">{segment.name}</Badge>}
        </span>
      }
    >
      <div className="space-y-4">
        {/* ------------------------------ identity ------------------------------ */}
        <Panel bodyClass="p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-[4px] border border-signal/30 bg-signal/[0.08] font-display text-[18px] font-semibold text-signal">
                {name[0]}
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-[19px] font-semibold text-chalk">{name}</h2>
                  <Badge tone="cyan">{c.code}</Badge>
                  <Badge tone={c.status === "ACTIVE" ? "signal" : c.status === "AT_RISK" ? "amber" : "neutral"}>{c.status.replace("_", " ")}</Badge>
                  <Badge>{c.kycTier.replace("_", " ")}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-fog">
                  <span className="flex items-center gap-1.5"><Icon name="phone" className="h-3 w-3" />{msisdn}</span>
                  <span className="flex items-center gap-1.5"><Icon name="map" className="h-3 w-3" />{c.county}</span>
                  <span className="flex items-center gap-1.5"><Icon name="pulse" className="h-3 w-3" />tenure {c.tenureDays}d</span>
                  <span className="flex items-center gap-1.5"><Icon name="grid" className="h-3 w-3" />digital ratio {(c.digitalRatio * 100).toFixed(0)}%</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-5">
              <Stat label="risk score" value={`${c.riskScore}/100`} tone={c.riskScore >= 65 ? "#ff5a5f" : c.riskScore >= 40 ? "#f5a524" : "#2fd07a"} />
              <Stat label="churn probability" value={`${(churn * 100).toFixed(1)}%`} tone={churnTone} />
              <Stat label="lifetime value" value={compactKsh(c.lifetimeValue)} tone="#46c8dc" />
            </div>
          </div>
        </Panel>

        {/* --------------------------- headline metrics ------------------------- */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <Panel bodyClass="p-3"><Label>monthly transactions</Label><div className="num mt-1 font-display text-[22px] font-semibold text-chalk">{c.txn30d}</div><div className="label-xs mt-1">peer {Number(peer?.avg_txn ?? 0)}</div></Panel>
          <Panel bodyClass="p-3"><Label>monthly value</Label><div className="num mt-1 font-display text-[20px] font-semibold text-signal">{compactKsh(c.value30d)}</div><div className="label-xs mt-1">peer {compactKsh(Number(peer?.avg_value ?? 0))}</div></Panel>
          <Panel bodyClass="p-3"><Label>average transaction</Label><div className="num mt-1 font-display text-[22px] font-semibold text-chalk">{compactKsh(c.avgTicket)}</div><div className="label-xs mt-1">{compactNum(series.reduce((a, x) => a + Number(x.count), 0))} lifetime events</div></Panel>
          <Panel bodyClass="p-3"><Label>top category</Label><div className="mt-1 font-display text-[15px] font-semibold text-cyan">{c.topCategory}</div><div className="label-xs mt-1">peak {c.peakWindow}</div></Panel>
          <Panel bodyClass="p-3"><Label>predicted next</Label><div className="mt-1 font-display text-[15px] font-semibold text-amber">{TXN_LABEL[c.predictedNextType ?? ""] ?? c.predictedNextType}</div><div className="label-xs mt-1">markov chain · window {c.predictedNextWindow}</div></Panel>
          <Panel bodyClass="p-3"><Label>savings rate</Label><div className="num mt-1 font-display text-[22px] font-semibold" style={{ color: c.savingsRate >= 15 ? "#2fd07a" : c.savingsRate >= 0 ? "#f5a524" : "#ff5a5f" }}>{c.savingsRate.toFixed(1)}%</div><div className="label-xs mt-1">burn {compactKsh(c.burnRate)}/day</div></Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Panel title="Cash-flow rhythm" subtitle="inflow vs outflow · last 45 days" icon="wallet" accent="#2fd07a">
            {chart.length === 0 ? (
              <Empty title="No transaction history" />
            ) : (
              <AreaSeries height={250} data={chart} xKey="day"
                series={[
                  { key: "inflow", name: "Inflow", colour: "#2fd07a", type: "area" },
                  { key: "outflow", name: "Outflow", colour: "#ff7a5c", type: "area" },
                  { key: "count", name: "Events", colour: "#46c8dc", type: "line", axis: "right" },
                ]} />
            )}
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line/60 sm:grid-cols-4">
              {[
                { k: "monthly income", v: compactKsh(c.monthlyIncome), t: "#2fd07a" },
                { k: "monthly expenses", v: compactKsh(c.monthlyExpenses), t: "#ff7a5c" },
                { k: "net cash flow", v: compactKsh(c.monthlyIncome - c.monthlyExpenses), t: c.monthlyIncome - c.monthlyExpenses >= 0 ? "#2fd07a" : "#ff5a5f" },
                { k: "next-month forecast", v: compactKsh(c.expectedMonthlySpend), t: "#46c8dc" },
              ].map((x) => (
                <div key={x.k} className="bg-panel px-3 py-2.5">
                  <Label>{x.k}</Label>
                  <div className="num mt-1 text-[14px] font-medium" style={{ color: x.t }}>{x.v}</div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel title="Behavioural profile" subtitle="subject vs segment centroid" icon="target" accent="#9d8cff">
              <RadarProfile data={radar} compare={segment?.name ?? "peer"} height={248} />
            </Panel>

            <Panel title="Churn outlook" subtitle="logistic regression · RFM + risk features" icon="pulse" accent={churnTone}>
              <div className="flex items-baseline gap-3">
                <span className="num font-display text-[34px] font-semibold leading-none" style={{ color: churnTone }}>{(churn * 100).toFixed(1)}%</span>
                <Badge tone={churn >= 0.5 ? "alert" : churn >= 0.3 ? "amber" : "signal"}>{churnBand}</Badge>
              </div>
              <div className="mt-3"><Meter value={churn * 100} tone={churnTone} height={5} /></div>
              <p className="mt-3 text-[11px] leading-relaxed text-fog">
                {churn >= 0.5
                  ? "Retention intervention recommended: this profile has breached the inactivity threshold used to label the training set."
                  : churn >= 0.3
                    ? "Watchlist. Activity is thinning relative to the customer's own baseline."
                    : "Healthy engagement. Predicted to transact again inside the normal inter-arrival window."}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Stat label="will transact tomorrow" value={churn < 0.35 && c.txn30d >= 12 ? "LIKELY" : "UNLIKELY"} tone={churn < 0.35 && c.txn30d >= 12 ? "#2fd07a" : "#f5a524"} />
                <Stat label="next expected" value={TXN_LABEL[c.predictedNextType ?? ""] ?? "—"} />
              </div>
            </Panel>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Transaction mix" subtitle="lifetime distribution by product" icon="grid" accent="#46c8dc">
            <Donut height={210} centreLabel="events" centreValue={compactNum(series.reduce((a, x) => a + Number(x.count), 0))}
              data={types.slice(0, 7).map((t, i) => ({ name: TXN_LABEL[t.type] ?? t.type, value: Number(t.count), colour: PALETTE[i % PALETTE.length] }))} />
            <div className="mt-2 space-y-1">
              {types.slice(0, 5).map((t, i) => (
                <div key={t.type} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                  <span className="min-w-0 flex-1 truncate text-[11px] text-fog">{TXN_LABEL[t.type] ?? t.type}</span>
                  <span className="num text-[11px] text-chalk">{((Number(t.value) / totalValue) * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Recurring commitments" subtitle="detected by amount-stable merchant repeats" icon="refresh" accent="#f5a524">
            {recurring.length === 0 ? (
              <Empty title="No recurring payments detected" note="Requires ≥3 visits to the same merchant with low amount variance." />
            ) : (
              <div className="space-y-2">
                {recurring.map((r) => (
                  <div key={r.name} className="rounded-[3px] border border-line/70 bg-black/25 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] text-chalk">{r.name}</span>
                      <span className="num text-[11px] text-amber">{compactKsh(Number(r.avg_amount))}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="label-xs">{r.category}</span>
                      <span className="num ml-auto text-[10px] text-fog">{r.count}× · {compactKsh(Number(r.total))} total</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Risk distribution" subtitle="ensemble verdicts across history" icon="shield" accent="#ff5a5f">
            <div className="space-y-2.5">
              {["CRITICAL", "HIGH", "ELEVATED", "NORMAL"].map((lvl, i) => {
                const count = Number(riskHistory.find((r) => r.level === lvl)?.count ?? 0);
                return (
                  <div key={lvl}>
                    <div className="flex items-center justify-between">
                      <RiskTag level={lvl} />
                      <span className="num text-[11px] text-chalk">{count.toLocaleString()}</span>
                    </div>
                    <div className="mt-1"><Meter value={count} max={riskTotal} tone={PALETTE[[3, 2, 1, 0][i]]} height={3} /></div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4">
              <Label>top merchants</Label>
              <div className="mt-2 space-y-1.5">
                {merchantsUsed.slice(0, 5).map((m) => (
                  <div key={m.name} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-chalk/90">{m.name}</span>
                    <span className="label-xs">{m.category}</span>
                    <span className="num text-[11px] text-signal">{compactKsh(Number(m.value))}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <Panel title="Recent activity" subtitle="last 20 conformed facts for this subject" icon="pulse" bodyClass="p-0">
          {recent.length === 0 ? (
            <Empty title="No transactions recorded" />
          ) : (
            <Table head={["timestamp", "transaction", "type", "merchant", "county", "channel", "amount", "fee", "status", "risk"]}>
              {recent.map((t) => (
                <Tr key={t.id}>
                  <Td className="num whitespace-nowrap text-[10.5px] text-fog">{new Date(t.occurredAt).toISOString().slice(0, 16).replace("T", " ")}</Td>
                  <Td className="num whitespace-nowrap text-[11px] text-cyan">
                    {t.flagged ? <Link href={`/fraud/${t.code}`} className="hover:underline">{t.code}</Link> : t.code}
                  </Td>
                  <Td className="whitespace-nowrap">{TXN_LABEL[t.type] ?? t.type}</Td>
                  <Td className="max-w-[160px] truncate text-fog">{t.merchantName ?? "—"}</Td>
                  <Td className="whitespace-nowrap text-fog">{t.county}</Td>
                  <Td className="whitespace-nowrap text-fog">{t.channel}</Td>
                  <Td className="num whitespace-nowrap text-right text-chalk">{compactKsh(t.amount)}</Td>
                  <Td className="num whitespace-nowrap text-right text-fog">{compactKsh(t.fee)}</Td>
                  <Td><Badge tone={t.status === "COMPLETED" ? "signal" : t.status === "FAILED" ? "alert" : "amber"}>{t.status}</Badge></Td>
                  <Td className="text-right"><RiskTag level={t.riskLevel} score={t.riskScore} /></Td>
                </Tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
