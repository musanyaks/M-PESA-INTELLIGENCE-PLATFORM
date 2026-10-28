import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, Table, Td, Tr, Stat, Empty, HBar, Icon } from "@/components/ui";
import { AlertAck } from "@/components/actions";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getAlerts, getAlertStats, getFraudSummary } from "@/lib/dashboard-data";
import { compactKsh, RISK_COLOUR } from "@/lib/core";
import { LiveStream } from "@/components/live";

export const dynamic = "force-dynamic";

const SEVERITIES = ["ALL", "CRITICAL", "HIGH", "ELEVATED"];
const STATUSES = ["ALL", "FIRED", "ACKNOWLEDGED", "RESOLVED"];
const CHANNEL_ICON: Record<string, string> = { SMS: "phone", EMAIL: "file", DASHBOARD: "pulse", WEBHOOK: "code" };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await requirePage();
  await ensureReady();
  const sp = await searchParams;
  const severity = SEVERITIES.includes(sp.severity ?? "") ? sp.severity : "ALL";
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : "ALL";

  const [rows, stats, fraud] = await Promise.all([
    getAlerts({ severity, status, limit: 120 }),
    getAlertStats(),
    getFraudSummary(),
  ]);

  const total = stats.reduce((a, s) => a + s.count, 0) || 1;
  const bySeverity = ["CRITICAL", "HIGH", "ELEVATED", "INFO"].map((s) => ({
    key: s, count: stats.filter((x) => x.severity === s).reduce((a, b) => a + b.count, 0),
  }));
  const byChannel = ["SMS", "EMAIL", "DASHBOARD", "WEBHOOK"].map((c) => ({
    key: c, count: stats.filter((x) => x.channel === c).reduce((a, b) => a + b.count, 0),
  }));
  const byStatus = ["FIRED", "ACKNOWLEDGED", "RESOLVED"].map((s) => ({
    key: s, count: stats.filter((x) => x.status === s).reduce((a, b) => a + b.count, 0),
  }));

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Alerting & Notification Fabric"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>Event-driven routing: transaction → topic → fraud engine → threshold → alert service → channel</span>
          <span className="text-fog/40">|</span>
          <span className="num">{total.toLocaleString()} alerts materialised</span>
        </span>
      }
      actions={
        <div className="flex flex-wrap gap-1.5">
          {SEVERITIES.map((s) => (
            <Link key={s} href={`/alerts?severity=${s}&status=${status}`}
              className={`rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${severity === s ? "border-alert/50 bg-alert/15 text-alert" : "border-line bg-panel text-fog hover:border-line-2 hover:text-chalk"}`}>
              {s.toLowerCase()}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          {STATUSES.map((s) => (
            <Link key={s} href={`/alerts?severity=${severity}&status=${s}`}
              className={`rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${status === s ? "border-cyan/50 bg-cyan/15 text-cyan" : "border-line bg-panel text-fog hover:border-line-2 hover:text-chalk"}`}>
              {s.toLowerCase()}
            </Link>
          ))}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Panel bodyClass="p-3"><Label>alerts fired</Label><div className="num mt-1 font-display text-[24px] font-semibold text-chalk">{byStatus.find((s) => s.key === "FIRED")?.count ?? 0}</div><div className="label-xs mt-1">awaiting acknowledgement</div></Panel>
          <Panel bodyClass="p-3"><Label>acknowledged</Label><div className="num mt-1 font-display text-[24px] font-semibold text-cyan">{byStatus.find((s) => s.key === "ACKNOWLEDGED")?.count ?? 0}</div><div className="label-xs mt-1">in analyst workflow</div></Panel>
          <Panel bodyClass="p-3"><Label>resolved</Label><div className="num mt-1 font-display text-[24px] font-semibold text-signal">{byStatus.find((s) => s.key === "RESOLVED")?.count ?? 0}</div><div className="label-xs mt-1">closed loop</div></Panel>
          <Panel bodyClass="p-3"><Label>critical exposure</Label><div className="num mt-1 font-display text-[22px] font-semibold text-alert">{compactKsh(Number(fraud.totals?.loss ?? 0))}</div><div className="label-xs mt-1">potential loss under review</div></Panel>
        </div>

        {/* -------------------------- alert architecture ------------------------- */}
        <Panel title="Alert architecture" subtitle="event-driven fan-out with per-channel delivery policy" icon="bolt" accent="#f5a524">
          <div className="touch-scroll no-scrollbar overflow-x-auto">
            <svg viewBox="0 0 1080 168" className="h-[168px] w-full min-w-[900px]">
              <defs>
                <marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" fill="#2fd07a" fillOpacity="0.75" />
                </marker>
              </defs>
              {[
                { x: 12, label: "TRANSACTION", sub: "producer" },
                { x: 196, label: "KAFKA", sub: "mpesa.bronze.raw" },
                { x: 380, label: "FRAUD ENGINE", sub: "flink · 7 detectors" },
                { x: 564, label: "THRESHOLD", sub: "risk > 65" },
                { x: 748, label: "ALERT SERVICE", sub: "router · dedupe" },
              ].map((n) => (
                <g key={n.label}>
                  <rect x={n.x} y={44} width={152} height={52} rx={3} fill="#121b1e" stroke="#2a3b40" />
                  <text x={n.x + 76} y={66} textAnchor="middle" fontSize="10.5" fill="#e8f0f1" fontFamily="monospace" letterSpacing="1">{n.label}</text>
                  <text x={n.x + 76} y={83} textAnchor="middle" fontSize="9" fill="#8fa3a8" fontFamily="monospace">{n.sub}</text>
                </g>
              ))}
              {[164, 348, 532, 716].map((x) => (
                <line key={x} x1={x} y1={70} x2={x + 30} y2={70} stroke="#2fd07a" strokeOpacity="0.55" strokeWidth="1.4" markerEnd="url(#arr)" className="flow-dash" />
              ))}
              {[
                { y: 8, label: "SMS", tone: "#ff5a5f", sub: "15 min SLA" },
                { y: 48, label: "EMAIL", tone: "#f5a524", sub: "fraud-ops" },
                { y: 88, label: "DASHBOARD", tone: "#46c8dc", sub: "sse push" },
                { y: 128, label: "WEBHOOK", tone: "#9d8cff", sub: "siem bridge" },
              ].map((c) => (
                <g key={c.label}>
                  <path d={`M900,70 C940,70 940,${c.y + 16} 968,${c.y + 16}`} fill="none" stroke={c.tone} strokeOpacity="0.5" strokeWidth="1.3" className="flow-dash" />
                  <rect x={968} y={c.y} width={100} height={32} rx={3} fill="#0e1517" stroke={c.tone} strokeOpacity="0.45" />
                  <text x={1018} y={c.y + 14} textAnchor="middle" fontSize="9.5" fill={c.tone} fontFamily="monospace" letterSpacing="1">{c.label}</text>
                  <text x={1018} y={c.y + 25} textAnchor="middle" fontSize="8" fill="#8fa3a8" fontFamily="monospace">{c.sub}</text>
                </g>
              ))}
              <text x={12} y={22} fontSize="9" fill="#8fa3a8" fontFamily="monospace" letterSpacing="1.4">ALERT PATH · END-TO-END P99 &lt; 900MS</text>
              <text x={12} y={152} fontSize="9" fill="#5f757a" fontFamily="monospace">suppression: 60s dedupe per (customer, rule) · escalation: 2× SLA breach → SOC webhook</text>
            </svg>
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
          <Panel title="Alert feed" subtitle={`${rows.length} alerts · newest first`} icon="bell" accent="#ff5a5f" bodyClass="p-0">
            {rows.length === 0 ? (
              <Empty title="No alerts match these filters" note="Start the producer on the pipeline page to generate live verdicts and alerts." />
            ) : (
              <div className="divide-y divide-line/60">
                {rows.map((a) => (
                  <div key={a.id} className="px-4 py-3 transition-colors hover:bg-white/[0.02]">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="mt-0.5 shrink-0" style={{ color: RISK_COLOUR[a.severity] ?? "#8fa3a8" }}>
                        <Icon name="warning" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-[12.5px] font-semibold tracking-[0.04em]" style={{ color: RISK_COLOUR[a.severity] ?? "#e8f0f1" }}>{a.title}</span>
                          <Badge tone={a.severity === "CRITICAL" ? "alert" : a.severity === "HIGH" ? "amber" : "cyan"}>{a.severity}</Badge>
                          <span className="flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-fog">
                            <Icon name={CHANNEL_ICON[a.channel] ?? "pulse"} className="h-3 w-3" />{a.channel}
                          </span>
                          <span className="num text-[9.5px] text-fog/60">{a.code}</span>
                        </div>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-fog">{a.body}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-fog/70">
                          <span>rule {a.rule}</span>
                          {a.transaction_code && (
                            <Link href={`/fraud/${a.transaction_code}`} className="text-cyan hover:underline">txn {a.transaction_code}</Link>
                          )}
                          {a.customer_code && <Link href={`/customers/${a.customer_code}`} className="text-cyan hover:underline">{a.customer_code}</Link>}
                          <span>{a.county}</span>
                          <span className="text-chalk">{compactKsh(a.amount)}</span>
                          <span>risk {a.risk_score}/100</span>
                          <span>{a.fired_at?.slice(0, 16).replace("T", " ")}</span>
                          {a.acknowledged_by && <span className="text-signal/80">ack · {a.acknowledged_by}</span>}
                        </div>
                      </div>
                      <div className="shrink-0"><AlertAck alertId={a.code} status={a.status} /></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel title="Severity distribution" subtitle="all materialised alerts" icon="gauge" accent="#ff5a5f">
              <div className="space-y-2">
                {bySeverity.map((s) => (
                  <div key={s.key}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: RISK_COLOUR[s.key] ?? "#8fa3a8" }}>{s.key}</span>
                      <span className="num text-[11px] text-chalk">{s.count.toLocaleString()} · {((s.count / total) * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.05]">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (s.count / total) * 100)}%`, background: RISK_COLOUR[s.key] ?? "#8fa3a8" }} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Channel throughput" subtitle="dispatch counts per delivery channel" icon="bolt" accent="#46c8dc">
              <div className="space-y-0.5">
                {byChannel.map((c) => (
                  <HBar key={c.key} label={c.key} value={c.count} max={Math.max(...byChannel.map((x) => x.count), 1)}
                    right={`${c.count.toLocaleString()}`} tone={c.key === "SMS" ? "#ff5a5f" : c.key === "EMAIL" ? "#f5a524" : c.key === "WEBHOOK" ? "#9d8cff" : "#46c8dc"}
                    sub={c.key === "SMS" ? "gateway 820ms p95" : c.key === "EMAIL" ? "smtp 1.4s p95" : c.key === "WEBHOOK" ? "soc bridge 260ms" : "sse 40ms"} />
                ))}
              </div>
            </Panel>

            <Panel title="Policy → alert mapping" subtitle="which rules are producing notifications" icon="file" accent="#f5a524">
              {fraud.byRule.length === 0 ? (
                <Empty title="No policy triggers recorded" />
              ) : (
                <div className="space-y-0.5">
                  {fraud.byRule.map((r) => (
                    <HBar key={r.rule} label={r.rule} value={Number(r.count)} max={Math.max(...fraud.byRule.map((x) => Number(x.count)), 1)}
                      right={Number(r.count).toLocaleString()} tone="#f5a524" />
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="Escalation policy" icon="shield" accent="#9d8cff">
              <ul className="space-y-2 text-[11px] leading-relaxed text-fog">
                {[
                  { k: "CRITICAL", v: "SMS to the subject + SOC webhook within 15 minutes. Transaction held pending review." },
                  { k: "HIGH", v: "Dashboard push and email to fraud-ops within 45 minutes. Step-up authentication requested." },
                  { k: "ELEVATED", v: "Batched hourly digest to the analytics desk; no customer-facing friction." },
                  { k: "SUPPRESSION", v: "60-second dedupe per (customer, rule) pair prevents alert storms during velocity bursts." },
                  { k: "BREACH", v: "Two consecutive SLA breaches escalate the case to the SOC bridge automatically." },
                ].map((e) => (
                  <li key={e.k} className="border-l-2 border-line pl-2.5">
                    <span className="num text-[10px] uppercase tracking-[0.12em] text-chalk">{e.k}</span>
                    <span className="mt-0.5 block">{e.v}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="open cases" value={fraud.totals?.open ?? 0} tone="#f5a524" />
                <Stat label="mean time to resolve" value={`${fraud.totals?.mtta ?? 0}m`} tone="#2fd07a" />
              </div>
            </Panel>
          </div>
        </div>

        <LiveStream limit={10} title="Live notification tap" showStats />
      </div>
    </Shell>
  );
}
