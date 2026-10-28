import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, HBar, Table, Td, Tr, Meter, Stat } from "@/components/ui";
import { BarSeries } from "@/components/charts";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getCountyBreakdown, getMerchantList } from "@/lib/dashboard-data";
import { COUNTIES, projectKenya, KENYA_OUTLINE, compactKsh, compactNum } from "@/lib/core";

export const dynamic = "force-dynamic";

const W = 380;
const H = 470;
const METRICS = {
  value: { label: "transaction value", unit: "KSh" },
  count: { label: "transaction volume", unit: "txn" },
  risk: { label: "mean risk score", unit: "/100" },
  merchants: { label: "merchant density", unit: "merchants" },
  customers: { label: "customer density", unit: "customers" },
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
  const values = COUNTIES.map((c) => Number(byName.get(c.name)?.[metric] ?? 0));
  const maxV = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0) || 1;

  const outlinePath = KENYA_OUTLINE.map(([lon, lat], i) => {
    const p = projectKenya(lon, lat);
    return `${i === 0 ? "M" : "L"}${(p.x * W).toFixed(1)},${(p.y * H).toFixed(1)}`;
  }).join(" ") + " Z";

  const ranked = counties.slice().sort((a, b) => Number(b[metric]) - Number(a[metric]));
  const regionRollup = new Map<string, { value: number; count: number; risk: number; n: number }>();
  for (const c of counties) {
    const meta = COUNTIES.find((x) => x.name === c.county);
    const region = meta?.region ?? "OTHER";
    const cur = regionRollup.get(region) ?? { value: 0, count: 0, risk: 0, n: 0 };
    cur.value += c.value;
    cur.count += c.count;
    cur.risk += c.risk * c.count;
    cur.n += 1;
    regionRollup.set(region, cur);
  }
  const regions = Array.from(regionRollup.entries())
    .map(([region, v]) => ({ region, value: v.value, count: v.count, risk: Math.round(v.risk / Math.max(1, v.count)), counties: v.n }))
    .sort((a, b) => b.value - a.value);

  const sel = selected ? byName.get(selected) : null;
  const selMerchants = selected ? merchantRows.filter((m) => m.county === selected).slice(0, 8) : merchantRows.slice(0, 8);

  const heat = (v: number) => {
    const t = Math.min(1, v / maxV);
    const r = Math.round(47 + t * 208);
    const g = Math.round(208 - t * 118);
    const b = Math.round(122 - t * 27);
    return `rgba(${r},${g},${b},${0.16 + t * 0.72})`;
  };

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Geographic Intelligence"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>47-county topology · transaction value, volume, fraud concentration and merchant density</span>
          <span className="text-fog/40">|</span>
          <span className="num text-signal/80">{compactNum(counties.reduce((a, c) => a + c.count, 0))} events geo-resolved</span>
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(METRICS) as MetricKey[]).map((m) => (
            <Link key={m} href={`/geo?metric=${m}${selected ? `&county=${encodeURIComponent(selected)}` : ""}`}
              className={`rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${
                metric === m ? "border-signal/50 bg-signal/15 text-signal" : "border-line bg-panel text-fog hover:border-line-2 hover:text-chalk"
              }`}>
              {METRICS[m].label.split(" ").slice(-1)[0]}
            </Link>
          ))}
        </div>
      }
      wide
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel
          title="Kenya · county heat map"
          subtitle={`${METRICS[metric].label} per county — bubble area scales with share of national total`}
          icon="map"
          right={<Badge tone="signal">{COUNTIES.length} counties</Badge>}
          bodyClass="p-2"
        >
          <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-[560px] w-full max-w-[520px]">
              <defs>
                <linearGradient id="kenyaFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#12241f" />
                  <stop offset="100%" stopColor="#0a1214" />
                </linearGradient>
                <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
                  <feGaussianBlur stdDeviation="5" result="b" />
                  <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              <path d={outlinePath} fill="url(#kenyaFill)" stroke="#2a3b40" strokeWidth="1.2" />
              <path d={outlinePath} fill="none" stroke="#2fd07a" strokeOpacity="0.22" strokeWidth="3" filter="url(#glow)" />

              {COUNTIES.map((c) => {
                const row = byName.get(c.name);
                const v = Number(row?.[metric] ?? 0);
                const share = v / total;
                const p = projectKenya(c.lon, c.lat);
                const r = 3.2 + Math.sqrt(Math.max(0, v / maxV)) * 17;
                const isSel = selected === c.name;
                return (
                  <g key={c.name} className="cursor-pointer">
                    <Link href={`/geo?metric=${metric}&county=${encodeURIComponent(c.name)}`}>
                      <title>{`${c.name} — ${METRICS[metric].label}: ${v.toLocaleString()} · share ${(share * 100).toFixed(2)}% · risk ${row?.risk ?? 0}`}</title>
                      <circle cx={p.x * W} cy={p.y * H} r={r + 7} fill="transparent" />
                      <circle
                        cx={p.x * W} cy={p.y * H} r={r}
                        fill={heat(v)}
                        stroke={isSel ? "#e8f0f1" : "#2fd07a"}
                        strokeOpacity={isSel ? 0.95 : 0.35}
                        strokeWidth={isSel ? 1.6 : 0.8}
                        className="transition-all duration-200 hover:stroke-chalk"
                      />
                      {share > 0.028 && (
                        <text x={p.x * W} y={p.y * H + 3} textAnchor="middle" className="pointer-events-none font-mono" fontSize="8.5" fill="#04120c" fontWeight="600">
                          {c.name.slice(0, 9)}
                        </text>
                      )}
                    </Link>
                  </g>
                );
              })}

              <g transform={`translate(14, ${H - 78})`}>
                <text className="font-mono" fontSize="8" fill="#8fa3a8" letterSpacing="1.4">{METRICS[metric].label.toUpperCase()}</text>
                {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
                  <g key={t} transform={`translate(${i * 40}, 12)`}>
                    <rect width="36" height="7" fill={heat(t * maxV)} stroke="#1e2b2f" strokeWidth="0.5" />
                    <text y="17" className="font-mono" fontSize="7.5" fill="#8fa3a8">
                      {t === 0 ? "low" : t === 1 ? compactNum(maxV) : ""}
                    </text>
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </Panel>

        <div className="space-y-4">
          {sel && (
            <Panel title={sel.county} subtitle={`county ${COUNTIES.find((c) => c.name === sel.county)?.code ?? "—"} · ${COUNTIES.find((c) => c.name === sel.county)?.region ?? ""}`} icon="target" accent="#46c8dc"
              right={<Link href={`/geo?metric=${metric}`} className="font-mono text-[10px] uppercase tracking-[0.12em] text-fog hover:text-alert">clear</Link>}>
              <div className="grid grid-cols-2 gap-3">
                <Stat label="value 30d" value={compactKsh(sel.value)} tone="#2fd07a" />
                <Stat label="volume 30d" value={compactNum(sel.count)} />
                <Stat label="avg ticket" value={compactKsh(sel.count ? Math.round(sel.value / sel.count) : 0)} />
                <Stat label="mean risk" value={`${sel.risk}/100`} tone={sel.risk > 40 ? "#f5a524" : "#2fd07a"} />
                <Stat label="customers" value={sel.customers.toLocaleString()} />
                <Stat label="merchants" value={sel.merchants.toLocaleString()} />
              </div>
              <div className="mt-4">
                <Label>share of national value</Label>
                <div className="mt-1.5"><Meter value={sel.value} max={Math.max(...counties.map((c) => c.value))} tone="#46c8dc" /></div>
                <div className="num mt-1 text-[11px] text-cyan">{((sel.value / total) * 100).toFixed(2)}%</div>
              </div>
              <div className="mt-4">
                <Label>fraud concentration</Label>
                <div className="mt-1.5"><Meter value={sel.fraudRate} max={Math.max(...counties.map((c) => c.fraudRate), 1)} tone="#ff5a5f" /></div>
                <div className="num mt-1 text-[11px] text-alert">{sel.fraudRate.toFixed(2)}% flagged · {sel.flagged.toLocaleString()} events</div>
              </div>
            </Panel>
          )}

          <Panel title="Regional rollup" subtitle="8 economic regions" icon="layers">
            <div className="space-y-0.5">
              {regions.map((r) => (
                <HBar key={r.region} label={r.region} sub={`${r.counties} counties · ${compactNum(r.count)} txn`} value={r.value}
                  max={Math.max(...regions.map((x) => x.value))} right={compactKsh(r.value)}
                  tone={r.risk > 40 ? "#f5a524" : "#2fd07a"} />
              ))}
            </div>
          </Panel>

          <Panel title="Merchant density" subtitle="top active acquirers by county" icon="store" accent="#f5a524" bodyClass="p-0">
            <Table head={["merchant", "county", "revenue", "growth"]}>
              {selMerchants.map((m) => (
                <Tr key={m.id}>
                  <Td><Link href={`/merchants?id=${m.id}`} className="text-chalk hover:text-signal">{m.name}</Link><span className="label-xs block">{m.category}</span></Td>
                  <Td className="whitespace-nowrap text-fog">{m.county}</Td>
                  <Td className="num whitespace-nowrap text-right text-chalk">{compactKsh(m.revenue_30d)}</Td>
                  <Td className={`num whitespace-nowrap text-right ${m.growth_pct >= 0 ? "text-signal" : "text-alert"}`}>{m.growth_pct >= 0 ? "+" : ""}{m.growth_pct.toFixed(1)}%</Td>
                </Tr>
              ))}
            </Table>
          </Panel>
        </div>

        <Panel title="County league table" subtitle={`ranked by ${METRICS[metric].label}`} icon="chart" className="xl:col-span-2" bodyClass="p-0">
          <div className="grid grid-cols-1 gap-4 p-4 xl:grid-cols-2">
            <div>
              <Label>top 12 counties</Label>
              <div className="mt-2"><BarSeries height={300} horizontal data={ranked.slice(0, 12).map((r) => ({ name: r.county, v: Number(r[metric]) }))} xKey="name" series={[{ key: "v", name: METRICS[metric].label, colour: "#2fd07a" }]} /></div>
            </div>
            <div>
              <Label>full ranking</Label>
              <div className="mt-2 max-h-[300px] overflow-y-auto pr-1">
                <Table head={["#", "county", "value", "volume", "risk", "flag rate"]}>
                  {ranked.map((r, i) => (
                    <Tr key={r.county}>
                      <Td className="num text-fog">{i + 1}</Td>
                      <Td><Link href={`/geo?metric=${metric}&county=${encodeURIComponent(r.county)}`} className={selected === r.county ? "text-signal" : "text-chalk hover:text-signal"}>{r.county}</Link></Td>
                      <Td className="num text-right text-chalk">{compactKsh(r.value)}</Td>
                      <Td className="num text-right text-fog">{compactNum(r.count)}</Td>
                      <Td className="num text-right" style={{ color: r.risk > 45 ? "#ff5a5f" : r.risk > 30 ? "#f5a524" : "#2fd07a" }}>{r.risk}</Td>
                      <Td className="num text-right text-fog">{r.fraudRate.toFixed(2)}%</Td>
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
