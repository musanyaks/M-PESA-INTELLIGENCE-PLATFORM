import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, Table, Td, Tr, Stat, Meter, Empty, HBar } from "@/components/ui";
import { AreaSeries, Donut } from "@/components/charts";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getPredictions, getModelRegistry } from "@/lib/dashboard-data";
import { compactKsh, compactNum, TXN_LABEL } from "@/lib/core";

export const dynamic = "force-dynamic";

const BAND_TONE: Record<string, string> = { SEVERE: "#ff5a5f", HIGH: "#f5a524", MODERATE: "#46c8dc", LOW: "#2fd07a" };

export default async function PredictionsPage() {
  const session = await requirePage();
  await ensureReady();
  const [p, models] = await Promise.all([getPredictions(), getModelRegistry()]);

  const buildSeries = (f: (typeof p.forecasts)[number]) => {
    const hist = (f.history ?? []).slice(-70).map((h) => ({ day: h.day.slice(5), actual: h.actual as number | null, fitted: null as number | null, projected: null as number | null, base: null as number | null, range: null as number | null }));
    const fit = (f.fitted ?? []).slice(-70);
    fit.forEach((x, i) => { if (hist[i]) hist[i].fitted = x.value; });
    const proj = (f.projection ?? []).map((x) => ({ day: x.day.slice(5), actual: null, fitted: null, projected: x.value, base: x.lower, range: Math.max(0, x.upper - x.lower) }));
    if (hist.length && proj.length) hist[hist.length - 1].projected = proj[0].projected;
    return [...hist, ...proj];
  };

  const markov = models.find((m) => m.family === "MARKOV CHAIN");
  const transitions = ((markov?.artifact as Record<string, unknown> | null)?.transitions ?? {}) as Record<string, Record<string, number>>;
  const markovRows = Object.entries(transitions).slice(0, 8);
  const churnBands = p.churnBands.map((b) => ({ band: b.band, customers: Number(b.count) }));
  const churnTotal = churnBands.reduce((a, b) => a + b.customers, 0) || 1;
  const maxSpend = Math.max(...p.spend.map((s) => s.expected_monthly_spend), 1);

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Predictive Analytics"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>Forecasting · churn · next-best-action · spend projection</span>
          <span className="text-fog/40">|</span>
          <span className="num text-signal/80">{models.length} registered models</span>
        </span>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Panel bodyClass="p-3">
            <Label>transact tomorrow · likely</Label>
            <div className="num mt-1 font-display text-[24px] font-semibold text-signal">{Number(p.transactTomorrow?.likely ?? 0).toLocaleString()}</div>
            <div className="label-xs mt-1">churn p &lt; 0.35 &amp; ≥12 txn/30d</div>
          </Panel>
          <Panel bodyClass="p-3">
            <Label>transact tomorrow · unlikely</Label>
            <div className="num mt-1 font-display text-[24px] font-semibold text-alert">{Number(p.transactTomorrow?.unlikely ?? 0).toLocaleString()}</div>
            <div className="label-xs mt-1">churn p ≥ 0.60</div>
          </Panel>
          <Panel bodyClass="p-3">
            <Label>30-day value forecast</Label>
            <div className="num mt-1 font-display text-[22px] font-semibold text-iris">
              {compactKsh((p.forecasts.find((f) => f.metric === "txn_value")?.projection ?? []).reduce((a, x) => a + x.value, 0))}
            </div>
            <div className="label-xs mt-1">holt-winters additive · season 7</div>
          </Panel>
          <Panel bodyClass="p-3">
            <Label>forecast accuracy</Label>
            <div className="num mt-1 font-display text-[24px] font-semibold text-cyan">
              {Number((p.forecasts.find((f) => f.metric === "txn_value")?.metrics as Record<string, number> | undefined)?.mape ?? 0).toFixed(2)}%
            </div>
            <div className="label-xs mt-1">mean absolute percentage error</div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {p.forecasts.filter((f) => f.metric === "txn_value" || f.metric === "txn_count").map((f) => (
            <Panel key={f.id} title={f.metric === "txn_value" ? "Transaction value forecast" : "Transaction volume forecast"}
              subtitle={`${f.model} · ${f.granularity.toLowerCase()} · horizon ${f.horizonDays} days`}
              icon="target" accent="#9d8cff"
              right={<Badge tone="iris">shaded band = 95% interval</Badge>}>
              <AreaSeries height={230} band={{ base: "base", range: "range" }} data={buildSeries(f)} xKey="day"
                series={[
                  { key: "actual", name: "Actual", colour: "#2fd07a", type: "line" },
                  { key: "fitted", name: "Fitted", colour: "#46c8dc", type: "line" },
                  { key: "projected", name: "Forecast", colour: "#9d8cff", type: "line" },
                ]} />
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="mape" value={`${Number((f.metrics as Record<string, number>).mape ?? 0).toFixed(2)}%`} tone="#2fd07a" />
                <Stat label="rmse" value={compactNum(Number((f.metrics as Record<string, number>).rmse ?? 0))} />
                <Stat label="ar(7) mape" value={`${Number((f.metrics as Record<string, number>).arMape ?? 0).toFixed(2)}%`} tone="#46c8dc" />
                <Stat label="next 7d" value={compactNum((f.projection ?? []).slice(0, 7).reduce((a, x) => a + x.value, 0))} tone="#9d8cff" />
              </div>
            </Panel>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.5fr]">
          <Panel title="Churn distribution" subtitle="logistic regression · recency-labelled" icon="pulse" accent="#ff5a5f">
            <Donut height={200} centreLabel="customers" centreValue={compactNum(churnTotal)}
              data={churnBands.map((b) => ({ name: b.band, value: b.customers, colour: BAND_TONE[b.band] ?? "#8fa3a8" }))} />
            <div className="mt-3 space-y-2">
              {churnBands.map((b) => (
                <div key={b.band}>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: BAND_TONE[b.band] }}>{b.band}</span>
                    <span className="num text-[11px] text-chalk">{b.customers.toLocaleString()} · {((b.customers / churnTotal) * 100).toFixed(1)}%</span>
                  </div>
                  <div className="mt-1"><Meter value={b.customers} max={churnTotal} tone={BAND_TONE[b.band] ?? "#8fa3a8"} height={3} /></div>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-[3px] border border-line bg-black/25 p-3">
              <Label>label definition</Label>
              <p className="mt-1.5 text-[11px] leading-relaxed text-fog">
                A customer is labelled churned when observed recency exceeds 22 days inside a 96-day observation window.
                Features: recency, frequency, monetary value, digital ratio, ensemble risk, tenure, failure rate and
                product diversity — all standardized before fitting.
              </p>
            </div>
          </Panel>

          <Panel title="Churn watchlist" subtitle="highest-probability profiles for retention campaigns" icon="users" accent="#f5a524" bodyClass="p-0">
            {p.churn.length === 0 ? (
              <Empty title="No churn risk detected" />
            ) : (
              <Table head={["customer", "county", "segment", "txn/30d", "value/30d", "status", "churn p", "action"]}>
                {p.churn.map((c) => (
                  <Tr key={c.id}>
                    <Td><Link href={`/customers/${c.code}`} className="text-chalk hover:text-signal">{c.code}</Link><span className="block truncate text-[10px] text-fog/70">{c.name}</span></Td>
                    <Td className="whitespace-nowrap text-fog">{c.county}</Td>
                    <Td className="whitespace-nowrap text-fog">{c.segment_name ?? "—"}</Td>
                    <Td className="num text-right text-chalk">{c.txn_30d}</Td>
                    <Td className="num whitespace-nowrap text-right text-signal">{compactKsh(c.value_30d)}</Td>
                    <Td><Badge tone={c.status === "ACTIVE" ? "signal" : c.status === "AT_RISK" ? "amber" : "neutral"}>{c.status.replace("_", " ")}</Badge></Td>
                    <Td className="w-24">
                      <span className="num text-[11px]" style={{ color: BAND_TONE[c.churn_probability >= 0.75 ? "SEVERE" : c.churn_probability >= 0.5 ? "HIGH" : c.churn_probability >= 0.3 ? "MODERATE" : "LOW"] }}>
                        {(c.churn_probability * 100).toFixed(1)}%
                      </span>
                      <span className="mt-0.5 block"><Meter value={c.churn_probability * 100} tone="#ff5a5f" height={2} /></span>
                    </Td>
                    <Td><span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-cyan">retain</span></Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Panel title="Next-month spend projection" subtitle="per-customer linear trend over monthly outflow buckets" icon="chart" accent="#2fd07a" bodyClass="p-0">
            <Table head={["customer", "county", "current", "projected", "delta", "savings rate"]}>
              {p.spend.map((c) => {
                const delta = c.monthly_expenses ? ((c.expected_monthly_spend - c.monthly_expenses) / c.monthly_expenses) * 100 : 0;
                return (
                <Tr key={c.id}>
                  <Td><Link href={`/customers/${c.code}`} className="text-chalk hover:text-signal">{c.code}</Link><span className="block truncate text-[10px] text-fog/70">{c.name}</span></Td>
                  <Td className="whitespace-nowrap text-fog">{c.county}</Td>
                  <Td className="num whitespace-nowrap text-right text-fog">{compactKsh(c.monthly_expenses)}</Td>
                  <Td className="num whitespace-nowrap text-right text-signal">{compactKsh(c.expected_monthly_spend)}</Td>
                  <Td className="num text-right" style={{ color: delta >= 0 ? "#f5a524" : "#2fd07a" }}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}%</Td>
                  <Td className="w-28">
                    <span className="num text-[11px] text-chalk">{c.savings_rate.toFixed(1)}%</span>
                    <span className="mt-0.5 block"><Meter value={Math.max(0, c.savings_rate)} max={60} tone="#46c8dc" height={2} /></span>
                  </Td>
                </Tr>
                );
              })}
            </Table>
          </Panel>

          <Panel title="Next-transaction model" subtitle={`${markov?.name ?? "markov"} ${markov?.version ?? ""} · first-order transition probabilities`} icon="grid" accent="#46c8dc">
            {markovRows.length === 0 ? (
              <Empty title="Transition matrix unavailable" />
            ) : (
              <div className="space-y-3">
                {markovRows.map(([from, to]) => {
                  const top = Object.entries(to).sort((a, b) => b[1] - a[1]).slice(0, 3);
                  return (
                    <div key={from} className="rounded-[3px] border border-line/70 bg-black/25 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="num text-[10.5px] uppercase tracking-[0.1em] text-cyan">{TXN_LABEL[from] ?? from}</span>
                        <span className="text-fog/50">→</span>
                        <span className="text-[11px] text-chalk">{TXN_LABEL[top[0][0]] ?? top[0][0]}</span>
                        <span className="num ml-auto text-[11px] text-signal">{(top[0][1] * 100).toFixed(1)}%</span>
                      </div>
                      <div className="mt-2 space-y-0.5">
                        {top.map(([t, prob]) => (
                          <HBar key={t} label={TXN_LABEL[t] ?? t} value={prob * 100} max={100} right={`${(prob * 100).toFixed(1)}%`} tone="#46c8dc" />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>
        </div>

        <Panel title="Model registry" subtitle="MLflow-tracked artefacts · production and staging" icon="cpu" accent="#9d8cff" bodyClass="p-0">
          <Table head={["model", "version", "family", "task", "status", "auc / metric", "precision", "recall", "f1", "rows", "train ms", "trained"]}>
            {models.map((m) => {
              const met = (m.metrics ?? {}) as Record<string, number>;
              const headline = met.auc ?? met.inertia ?? met.mape ?? met.top1Accuracy ?? 0;
              return (
                <Tr key={m.id}>
                  <Td className="text-chalk">{m.name}</Td>
                  <Td className="num text-fog">{m.version}</Td>
                  <Td className="whitespace-nowrap text-fog">{m.family}</Td>
                  <Td><Badge tone="cyan">{m.task.replace("_", " ")}</Badge></Td>
                  <Td><Badge tone={m.status === "PRODUCTION" ? "signal" : "amber"}>{m.status}</Badge></Td>
                  <Td className="num text-right text-iris">{Number(headline).toFixed(4)}</Td>
                  <Td className="num text-right text-fog">{met.precision !== undefined ? Number(met.precision).toFixed(3) : "—"}</Td>
                  <Td className="num text-right text-fog">{met.recall !== undefined ? Number(met.recall).toFixed(3) : "—"}</Td>
                  <Td className="num text-right text-signal">{met.f1 !== undefined ? Number(met.f1).toFixed(3) : "—"}</Td>
                  <Td className="num text-right text-fog">{m.trainingRows.toLocaleString()}</Td>
                  <Td className="num text-right text-fog">{m.trainDurationMs.toLocaleString()}</Td>
                  <Td className="num whitespace-nowrap text-right text-[10px] text-fog/70">{new Date(m.trainedAt).toISOString().slice(0, 16).replace("T", " ")}</Td>
                </Tr>
              );
            })}
          </Table>
        </Panel>
      </div>
    </Shell>
  );
}
