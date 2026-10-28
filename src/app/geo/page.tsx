import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, HBar, Table, Td, Tr, Meter, Stat } from "@/components/ui";
import { KenyaMap } from "@/components/kenya-map";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getCountyBreakdown, getMerchantList } from "@/lib/dashboard-data";
import { COUNTIES, compactKsh, compactNum } from "@/lib/core";

export const dynamic = "force-dynamic";

const METRICS = {
  value: { label: "transaction value", short: "value" },
  count: { label: "transaction volume", short: "volume" },
  risk: { label: "mean risk score", short: "risk" },
  merchants: { label: "merchant density", short: "merchants" },
  customers: { label: "customer density", short: "customers" },
} as const;
type MetricKey = keyof typeof METRICS;

export default async function GeographicIntelligence({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await requirePage();
  await ensureReady();
  const sp = await searchParams;
  const metric = (Object.keys(METRICS).includes(sp.metric ?? "") ? sp.metric : "value") as MetricKey;
  const selected = sp.county ?? null;

  const [counties, merchantRows] = await Promise.all([getCountyBreakdown(30), getMerchantList({ limit: 200 })]);

  const byName = new Map(counties.map((c) => [c.county, c]));
  const ranked = counties.slice().sort((a, b) => Number(b[metric]) - Number(a[metric]));
  const metricMax = Math.max(...ranked.map((r) => Number(r[metric])), 1);
  const metricTotal = ranked.reduce((a, r) => a + Number(r[metric]), 0);
  const covered = COUNTIES.filter((c) => (byName.get(c.name)?.count ?? 0) > 0).length;

  const sel = selected ? byName.get(selected) : null;
  const selMeta = selected ? COUNTIES.find((c) => c.name === selected) : null;
  const selMerchants = selected ? merchantRows.filter((m) => m.county === selected).slice(0, 8) : merchantRows.slice(0, 8);

  const regionRollup = new Map<string, { value: number; count: number; risk: number; n: number; flagged: number }>();
  for (const c of counties) {
    const region = COUNTIES.find((x) => x.name === c.county)?.region ?? "OTHER";
    const cur = regionRollup.get(region) ?? { value: 0, count: 0, risk: 0, n: 0, flagged: 0 };
    cur.value += c.value;
    cur.count += c.count;
    cur.risk += c.risk * c.count;
    cur.flagged += c.flagged;
    cur.n += 1;
    regionRollup.set(region, cur);
  }
  const regions = Array.from(regionRollup.entries())
    .map(([region, v]) => ({
      region, value: v.value, count: v.count, flagged: v.flagged, counties: v.n,
      risk: Math.round(v.risk / Math.max(1, v.count)),
      fraudRate: (v.flagged / Math.max(1, v.count)) * 100,
    }))
    .sort((a, b) => b.value - a.value);

  const top5Share = metricTotal ? (ranked.slice(0, 5).reduce((a, r) => a + Number(r[metric]), 0) / metricTotal) * 100 : 0;
  const bottom20Share = metricTotal ? (ranked.slice(-20).reduce((a, r) => a + Number(r[metric]), 0) / metricTotal) * 100 : 0;
  const hottest = ranked.slice().sort((a, b) => b.fraudRate - a.fraudRate)[0];

  const fmtMetric = (v: number) => (metric === "value" ? compactKsh(v) : metric === "risk" ? `${v}/100` : compactNum(v));

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Geographic Intelligence"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>47-county topology · value, volume, fraud concentration, merchant &amp; customer density</span>
          <span className="text-fog/40">|</span>
          <span className="num text-signal/80">{compactNum(counties.reduce((a, c) => a + c.count, 0))} events geo-resolved</span>
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(METRICS) as MetricKey[]).map((m) => (
            <Link
              key={m}
              href={`/geo?metric=${m}${selected ? `&county=${encodeURIComponent(selected)}` : ""}`}
              className={`rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${
                metric === m ? "border-signal/50 bg-signal/15 text-signal" : "border-line bg-panel text-fog hover:border-line-2 hover:text-chalk"
              }`}
            >
              {METRICS[m].short}
            </Link>
          ))}
        </div>
      }
      wide
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ------------------------------ real map ------------------------------ */}
        <Panel
          title="Kenya · county choropleth"
          subtitle={`${METRICS[metric].label} across all 47 counties — hover for the breakdown, click to drill down`}
          icon="map"
          right={
            <div className="flex items-center gap-1.5">
              <Badge tone="signal">{covered}/47 live</Badge>
              {selected && <Badge tone="cyan">{selected}</Badge>}
            </div>
          }
          bodyClass="p-3"
        >
          <KenyaMap
            data={COUNTIES.map((c) => {
              const row = byName.get(c.name);
              return {
                county: c.name,
                count: row?.count ?? 0,
                value: row?.value ?? 0,
                risk: row?.risk ?? 0,
                customers: row?.customers ?? 0,
                merchants: row?.merchants ?? 0,
                flagged: row?.flagged ?? 0,
                fraudRate: row?.fraudRate ?? 0,
              };
            })}
            metric={metric}
            selected={selected}
          />
        </Panel>

        {/* ---------------------------- right column ---------------------------- */}
        <div className="space-y-4">
          {sel && selMeta ? (
            <Panel
              title={selMeta.name}
              subtitle={`county code ${String(selMeta.code).padStart(2, "0")} · ${selMeta.region} · centroid ${selMeta.lat.toFixed(3)}, ${selMeta.lon.toFixed(3)}`}
              icon="target"
              accent="#46c8dc"
              right={<Link href={`/geo?metric=${metric}`} className="font-mono text-[10px] uppercase tracking-[0.12em] text-fog hover:text-alert">clear</Link>}
            >
              <div className="grid grid-cols-2 gap-3">
                <Stat label="value 30d" value={compactKsh(sel.value)} tone="#2fd07a" />
                <Stat label="volume 30d" value={compactNum(sel.count)} />
                <Stat label="avg ticket" value={compactKsh(sel.count ? Math.round(sel.value / sel.count) : 0)} />
                <Stat label="mean risk" value={`${sel.risk}/100`} tone={sel.risk > 40 ? "#f5a524" : "#2fd07a"} />
                <Stat label="customers" value={sel.customers.toLocaleString()} />
                <Stat label="merchants" value={sel.merchants.toLocaleString()} />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>share of national {METRICS[metric].short}</Label>
                  <div className="mt-1.5"><Meter value={Number(sel[metric])} max={metricMax} tone="#46c8dc" /></div>
                  <div className="num mt-1 text-[11px] text-cyan">{metricTotal ? ((Number(sel[metric]) / metricTotal) * 100).toFixed(2) : "0.00"}%</div>
                </div>
                <div>
                  <Label>fraud concentration</Label>
                  <div className="mt-1.5"><Meter value={sel.fraudRate} max={Math.max(...counties.map((c) => c.fraudRate), 1)} tone="#ff5a5f" /></div>
                  <div className="num mt-1 text-[11px] text-alert">{sel.fraudRate.toFixed(2)}% · {sel.flagged.toLocaleString()} flagged</div>
                </div>
              </div>
              <div className="mt-4 rounded-[3px] border border-line bg-black/25 p-3">
                <Label>county merchants in view</Label>
                <div className="mt-2 space-y-1.5">
                  {selMerchants.length === 0 ? (
                    <p className="text-[11px] text-fog">No active acquirer registered in this county for the current window.</p>
                  ) : (
                    selMerchants.map((m) => (
                      <Link key={m.id} href={`/merchants?id=${m.id}`} className="flex items-center gap-2 rounded-[2px] px-1 py-0.5 transition-colors hover:bg-white/[0.03]">
                        <span className="min-w-0 flex-1 truncate text-[11.5px] text-chalk">{m.name}</span>
                        <span className="label-xs">{m.category}</span>
                        <span className="num text-[11px] text-signal">{compactKsh(m.revenue_30d)}</span>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </Panel>
          ) : (
            <Panel title="Concentration signals" subtitle="what the current window is telling us" icon="target" accent="#46c8dc">
              <div className="space-y-3">
                {[
                  { k: "counties with traffic", v: `${covered} / 47`, n: "counties settling at least one event in the window" },
                  { k: "top-5 concentration", v: `${top5Share.toFixed(1)}%`, n: `of national ${METRICS[metric].short}` },
                  { k: "bottom-20 share", v: `${bottom20Share.toFixed(1)}%`, n: "long-tail counties combined" },
                  { k: "highest flag rate", v: `${hottest?.county ?? "—"} · ${(hottest?.fraudRate ?? 0).toFixed(2)}%`, n: "fraud concentration hotspot" },
                ].map((row) => (
                  <div key={row.k} className="border-b border-line/60 pb-2.5 last:border-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="label-xs">{row.k}</span>
                      <span className="num text-[14px] font-medium text-chalk">{row.v}</span>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-snug text-fog">{row.n}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10.5px] leading-relaxed text-fog/70">
                Select any county on the map to swap this panel for a full county dossier including its merchant catchment.
              </p>
            </Panel>
          )}

          <Panel title="Regional rollup" subtitle="8 economic regions" icon="layers" accent="#f5a524">
            <div className="space-y-0.5">
              {regions.map((r) => (
                <HBar
                  key={r.region}
                  label={r.region}
                  sub={`${r.counties} counties · ${compactNum(r.count)} txn · ${r.fraudRate.toFixed(2)}% flagged`}
                  value={r.value}
                  max={Math.max(...regions.map((x) => x.value))}
                  right={compactKsh(r.value)}
                  tone={r.risk > 40 ? "#f5a524" : "#2fd07a"}
                />
              ))}
            </div>
          </Panel>

          <Panel title="Merchant density" subtitle={selected ? `acquirers in ${selected}` : "top active acquirers nationally"} icon="store" accent="#46c8dc" bodyClass="p-0">
            <Table head={["merchant", "county", "revenue", "growth"]}>
              {selMerchants.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <Link href={`/merchants?id=${m.id}`} className="text-chalk hover:text-signal">{m.name}</Link>
                    <span className="label-xs block">{m.category}</span>
                  </Td>
                  <Td className="whitespace-nowrap text-fog">{m.county}</Td>
                  <Td className="num whitespace-nowrap text-right text-chalk">{compactKsh(m.revenue_30d)}</Td>
                  <Td className="num whitespace-nowrap text-right" style={{ color: m.growth_pct >= 0 ? "#2fd07a" : "#ff5a5f" }}>
                    {m.growth_pct >= 0 ? "+" : ""}{m.growth_pct.toFixed(1)}%
                  </Td>
                </Tr>
              ))}
            </Table>
          </Panel>
        </div>

        {/* --------------------------- league table ---------------------------- */}
        <Panel
          title="County league table"
          subtitle={`ranked by ${METRICS[metric].label} · 30-day window`}
          icon="chart"
          className="xl:col-span-2"
          bodyClass="p-4"
        >
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <Label>top 12 counties by {METRICS[metric].short}</Label>
                <span className="label-xs">national share</span>
              </div>
              <div className="mt-2.5 space-y-1">
                {ranked.slice(0, 12).map((r, i) => {
                  const v = Number(r[metric]);
                  const share = metricTotal ? (v / metricTotal) * 100 : 0;
                  return (
                    <Link
                      key={r.county}
                      href={`/geo?metric=${metric}&county=${encodeURIComponent(r.county)}`}
                      className={`block rounded-[3px] border px-2.5 py-[7px] transition-colors ${
                        selected === r.county ? "border-signal/45 bg-signal/[0.07]" : "border-transparent hover:border-line hover:bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="num w-4 shrink-0 text-[10px] text-fog/60">{String(i + 1).padStart(2, "0")}</span>
                        <span className="w-[104px] shrink-0 truncate text-[12px] text-chalk">{r.county}</span>
                        <span className="relative h-[8px] flex-1 overflow-hidden rounded-[2px] bg-white/[0.04]">
                          <span
                            className="absolute inset-y-0 left-0 rounded-[2px]"
                            style={{
                              width: `${Math.max(2, (v / metricMax) * 100)}%`,
                              background: metric === "risk" ? "linear-gradient(90deg,#f5a52455,#ff5a5f)" : "linear-gradient(90deg,#2fd07a44,#2fd07a)",
                            }}
                          />
                        </span>
                        <span className="num w-[92px] shrink-0 text-right text-[11.5px] text-chalk">{fmtMetric(v)}</span>
                        <span className="num w-12 shrink-0 text-right text-[10px] text-signal/80">{share.toFixed(1)}%</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 pl-[126px] font-mono text-[9.5px] text-fog/60">
                        <span>{compactNum(r.count)} txn</span>
                        <span>{compactKsh(r.value)}</span>
                        <span>risk {r.risk}</span>
                        <span style={{ color: r.fraudRate > 2 ? "#ff5a5f" : undefined }}>{r.fraudRate.toFixed(2)}% flagged</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
              <p className="mt-3 border-t border-line/60 pt-2.5 text-[10.5px] leading-relaxed text-fog/70">
                Concentration check — the top five counties carry{" "}
                <span className="num text-chalk">{top5Share.toFixed(1)}%</span> of the national {METRICS[metric].short} total,
                while the bottom twenty together carry <span className="num text-chalk">{bottom20Share.toFixed(1)}%</span>.
                {hottest && (
                  <>
                    {" "}The fraud hotspot is <Link className="text-alert hover:underline" href={`/geo?metric=risk&county=${encodeURIComponent(hottest.county)}`}>{hottest.county}</Link>{" "}
                    at <span className="num">{hottest.fraudRate.toFixed(2)}%</span> of events flagged.
                  </>
                )}
              </p>
            </div>

            <div>
              <Label>full ranking · {ranked.length} counties with settled traffic</Label>
              <div className="mt-2 max-h-[460px] overflow-y-auto rounded-[3px] border border-line/70">
                <Table head={["#", "county", "region", METRICS[metric].short, "value", "volume", "risk", "flag rate"]}>
                  {ranked.map((r, i) => (
                    <Tr key={r.county}>
                      <Td className="num text-fog">{i + 1}</Td>
                      <Td>
                        <Link href={`/geo?metric=${metric}&county=${encodeURIComponent(r.county)}`} className={selected === r.county ? "text-signal" : "text-chalk hover:text-signal"}>
                          {r.county}
                        </Link>
                      </Td>
                      <Td className="whitespace-nowrap text-[10px] text-fog/70">{COUNTIES.find((c) => c.name === r.county)?.region ?? "—"}</Td>
                      <Td className="num whitespace-nowrap text-right text-cyan">{fmtMetric(Number(r[metric]))}</Td>
                      <Td className="num whitespace-nowrap text-right text-chalk">{compactKsh(r.value)}</Td>
                      <Td className="num whitespace-nowrap text-right text-fog">{compactNum(r.count)}</Td>
                      <Td className="num text-right" style={{ color: r.risk > 45 ? "#ff5a5f" : r.risk > 30 ? "#f5a524" : "#2fd07a" }}>{r.risk}</Td>
                      <Td className="num whitespace-nowrap text-right text-fog">{r.fraudRate.toFixed(2)}%</Td>
                    </Tr>
                  ))}
                </Table>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </Shell>
  );
}
