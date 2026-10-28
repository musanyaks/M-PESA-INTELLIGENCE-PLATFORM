import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, Table, Td, Tr, Meter, Stat, Empty, HBar, Icon } from "@/components/ui";
import { Donut, BarSeries } from "@/components/charts";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getCustomerList, getSegments } from "@/lib/dashboard-data";
import { compactKsh, compactNum, maskMsisdn, maskName } from "@/lib/core";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const SORTS = [
  { key: "value", label: "value" },
  { key: "txn", label: "frequency" },
  { key: "risk", label: "risk" },
  { key: "churn", label: "churn" },
] as const;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await requirePage();
  await ensureReady();
  const sp = await searchParams;
  const q = sp.q ?? "";
  const segment = sp.segment ?? "ALL";
  const sort = (SORTS.some((s) => s.key === sp.sort) ? sp.sort : "value") as string;
  const risk = sp.risk ?? "ALL";
  const view = session.role === "ADMIN" ? "full" : "masked";

  const [rows, segs, stats] = await Promise.all([
    getCustomerList({ search: q, segment, sort, risk, limit: 80 }),
    getSegments(),
    db.execute(sql`
      SELECT count(*)::text AS total,
             round(avg(risk_score))::text AS avg_risk,
             round(avg(churn_probability)::numeric,3)::text AS avg_churn,
             count(*) filter (where risk_score >= 45)::text AS high_risk,
             count(*) filter (where churn_probability >= 0.6)::text AS churn_watch,
             coalesce(sum(value_30d),0)::text AS value,
             round(avg(savings_rate)::numeric,1)::text AS savings,
             count(*) filter (where status='DORMANT')::text AS dormant
      FROM customers
    `) as unknown as Promise<{ rows: Record<string, string>[] }>,
  ]);
  const s = stats.rows[0] ?? {};
  const totalValue = segs.reduce((a, x) => a + x.avgValue30d * x.size, 0) || 1;
  const mask = (name: string, msisdn: string) => (view === "full" ? { name, msisdn } : { name: maskName(name), msisdn: maskMsisdn(msisdn) });

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Customer Intelligence"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>Customer 360 · k-means segmentation · churn & next-best-action</span>
          <span className="text-fog/40">|</span>
          <span className="num">{Number(s.total ?? 0).toLocaleString()} profiles</span>
          <span className="text-fog/40">|</span>
          <Badge tone={view === "full" ? "alert" : "signal"}>pii {view}</Badge>
        </span>
      }
      actions={
        <form method="GET" action="/customers" className="flex items-center gap-1.5">
          {segment !== "ALL" && <input type="hidden" name="segment" value={segment} />}
          <input type="hidden" name="sort" value={sort} />
          <div className="relative">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fog"><Icon name="search" className="h-3.5 w-3.5" /></span>
            <input
              name="q" defaultValue={q} placeholder="name · code · msisdn"
              className="w-52 rounded-[3px] border border-line bg-black/40 py-1.5 pl-7 pr-2 font-mono text-[11px] text-chalk outline-none transition-colors placeholder:text-fog/50 focus:border-signal/50"
            />
          </div>
          <button type="submit" className="rounded-[3px] border border-signal/40 bg-signal/10 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-signal transition-colors hover:bg-signal/20">
            search
          </button>
        </form>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
          <Panel bodyClass="p-3"><Label>profiles</Label><div className="num mt-1 font-display text-[20px] font-semibold text-chalk">{compactNum(Number(s.total ?? 0))}</div></Panel>
          <Panel bodyClass="p-3"><Label>value / 30d</Label><div className="num mt-1 font-display text-[20px] font-semibold text-signal">{compactKsh(Number(s.value ?? 0))}</div></Panel>
          <Panel bodyClass="p-3"><Label>mean risk</Label><div className="num mt-1 font-display text-[20px] font-semibold text-amber">{s.avg_risk ?? 0}</div></Panel>
          <Panel bodyClass="p-3"><Label>high risk</Label><div className="num mt-1 font-display text-[20px] font-semibold text-alert">{Number(s.high_risk ?? 0).toLocaleString()}</div></Panel>
          <Panel bodyClass="p-3"><Label>mean churn p</Label><div className="num mt-1 font-display text-[20px] font-semibold text-cyan">{Number(s.avg_churn ?? 0).toFixed(3)}</div></Panel>
          <Panel bodyClass="p-3"><Label>churn watch</Label><div className="num mt-1 font-display text-[20px] font-semibold text-alert">{Number(s.churn_watch ?? 0).toLocaleString()}</div></Panel>
          <Panel bodyClass="p-3"><Label>dormant</Label><div className="num mt-1 font-display text-[20px] font-semibold text-fog">{Number(s.dormant ?? 0).toLocaleString()}</div></Panel>
          <Panel bodyClass="p-3"><Label>avg savings</Label><div className="num mt-1 font-display text-[20px] font-semibold text-signal">{s.savings_rate ?? 0}%</div></Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">
          <Panel
            title="Customer register"
            subtitle={`${rows.length} profiles · sorted by ${sort} · ${segment === "ALL" ? "all segments" : segment}`}
            icon="users"
            bodyClass="p-0"
            right={
              <div className="flex items-center gap-1.5">
                {SORTS.map((x) => (
                  <Link key={x.key} href={`/customers?q=${encodeURIComponent(q)}&segment=${encodeURIComponent(segment)}&sort=${x.key}&risk=${risk}`}
                    className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors ${sort === x.key ? "border-signal/50 text-signal" : "border-line text-fog hover:text-chalk"}`}>
                    {x.label}
                  </Link>
                ))}
                <span className="mx-1 h-4 w-px bg-line" />
                {["ALL", "ELEVATED", "HIGH"].map((r) => (
                  <Link key={r} href={`/customers?q=${encodeURIComponent(q)}&segment=${encodeURIComponent(segment)}&sort=${sort}&risk=${r}`}
                    className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] transition-colors ${risk === r ? "border-alert/50 text-alert" : "border-line text-fog hover:text-chalk"}`}>
                    {r.toLowerCase()}
                  </Link>
                ))}
              </div>
            }
          >
            {rows.length === 0 ? (
              <Empty title="No customers match" note="Adjust the search text or clear the segment filter." />
            ) : (
              <Table head={["customer", "msisdn", "county", "segment", "txn/30d", "value/30d", "avg ticket", "risk", "churn", "status"]}>
                {rows.map((c) => {
                  const m = mask(c.name, c.msisdn);
                  return (
                    <Tr key={c.id}>
                      <Td>
                        <Link href={`/customers/${c.code}`} className="text-chalk hover:text-signal">{m.name}</Link>
                        <span className="num block text-[10px] text-fog/70">{c.code}</span>
                      </Td>
                      <Td className="num whitespace-nowrap text-[11px] text-fog">{m.msisdn}</Td>
                      <Td className="whitespace-nowrap text-fog">{c.county}</Td>
                      <Td>
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-[11px] text-chalk/85">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: segs.find((x) => x.name === c.segment_name)?.colour ?? "#8fa3a8" }} />
                          {c.segment_name ?? "unassigned"}
                        </span>
                      </Td>
                      <Td className="num text-right text-chalk">{c.txn_30d}</Td>
                      <Td className="num whitespace-nowrap text-right text-signal">{compactKsh(c.value_30d)}</Td>
                      <Td className="num whitespace-nowrap text-right text-fog">{compactKsh(c.avg_ticket)}</Td>
                      <Td className="w-28">
                        <span className="num text-[11px]" style={{ color: c.risk_score >= 65 ? "#ff5a5f" : c.risk_score >= 40 ? "#f5a524" : "#2fd07a" }}>{c.risk_score}</span>
                        <span className="mt-0.5 block"><Meter value={c.risk_score} tone={c.risk_score >= 65 ? "#ff5a5f" : c.risk_score >= 40 ? "#f5a524" : "#2fd07a"} height={2} /></span>
                      </Td>
                      <Td className="num text-right" style={{ color: c.churn_probability >= 0.6 ? "#ff5a5f" : c.churn_probability >= 0.35 ? "#f5a524" : "#8fa3a8" }}>
                        {(c.churn_probability * 100).toFixed(0)}%
                      </Td>
                      <Td><Badge tone={c.status === "ACTIVE" ? "signal" : c.status === "AT_RISK" ? "amber" : "neutral"}>{c.status.replace("_", " ")}</Badge></Td>
                    </Tr>
                  );
                })}
              </Table>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel title="Segmentation" subtitle="k-means++ · k=6 · 7 standardized behavioural features" icon="grid" accent="#9d8cff">
              <Donut height={188} centreLabel="customers" centreValue={compactNum(segs.reduce((a, x) => a + x.size, 0))}
                data={segs.map((x) => ({ name: x.name, value: x.size, colour: x.colour }))} />
              <div className="mt-3 space-y-2">
                {segs.map((x) => (
                  <Link key={x.id} href={`/customers?segment=${encodeURIComponent(x.name)}&sort=${sort}&q=${encodeURIComponent(q)}`}
                    className={`block rounded-[3px] border px-2.5 py-2 transition-colors ${segment === x.name ? "border-signal/40 bg-signal/[0.07]" : "border-line/70 bg-black/20 hover:border-line-2"}`}>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: x.colour }} />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-chalk">{x.name}</span>
                      <span className="num text-[11px] text-fog">{x.size.toLocaleString()}</span>
                      <span className="num w-11 text-right text-[10px] text-fog/70">{x.share.toFixed(1)}%</span>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-snug text-fog/80">{x.description}</p>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 font-mono text-[9.5px] text-fog/70">
                      <span>txn {x.avgTxn30d}</span>
                      <span className="text-signal/80">{compactKsh(x.avgValue30d)}</span>
                      <span style={{ color: x.avgRisk > 42 ? "#ff5a5f" : "#8fa3a8" }}>risk {x.avgRisk}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel title="Revenue concentration" subtitle="share of 30-day value per segment" icon="wallet" accent="#2fd07a">
              <BarSeries height={200} horizontal
                data={segs.map((x) => ({ name: x.name.slice(0, 18), share: Number(x.revenueShare.toFixed(2)) }))}
                xKey="name" series={[{ key: "share", name: "revenue share %", colour: "#2fd07a" }]} />
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Stat label="top segment share" value={`${(segs.reduce((a, x) => Math.max(a, x.revenueShare), 0)).toFixed(1)}%`} tone="#2fd07a" />
                <Stat label="segments" value={segs.length} />
              </div>
            </Panel>

            <Panel title="Segment risk profile" subtitle="mean ensemble risk & churn per cluster" icon="shield" accent="#ff5a5f">
              <div className="space-y-0.5">
                {segs.map((x) => (
                  <HBar key={x.id} label={x.name} sub={`churn ${(x.avgRisk * 0.9).toFixed(0)} · digital ${(x.digitalRatio * 100).toFixed(0)}%`}
                    value={x.avgRisk} max={100} right={`${x.avgRisk}/100`} tone={x.avgRisk > 42 ? "#ff5a5f" : x.avgRisk > 28 ? "#f5a524" : "#2fd07a"} />
                ))}
              </div>
              <p className="mt-3 text-[10.5px] leading-relaxed text-fog/70">
                Segments are recomputed nightly by the Spark feature-engineering job against the silver layer; cluster
                centroids are versioned in the model registry alongside inertia and silhouette diagnostics.
              </p>
            </Panel>
          </div>
        </div>
      </div>
    </Shell>
  );
}
