import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { CaseActions, CopyJson } from "@/components/actions";
import { Panel, Badge, Label, RiskTag, Meter, Stat, Table, Td, Tr, Empty } from "@/components/ui";
import { RiskGauge } from "@/components/charts";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getFraudCase } from "@/lib/dashboard-data";
import { DETECTOR_META } from "@/lib/ml/fraud";
import { compactKsh, TXN_LABEL } from "@/lib/core";

export const dynamic = "force-dynamic";

export default async function FraudInvestigation({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePage();
  await ensureReady();
  const { id } = await params;
  const clean = id.replace(/L$/, "");
  const detail = (await getFraudCase(id)) ?? (clean !== id ? await getFraudCase(clean) : null);
  if (!detail) notFound();

  const { case: c, transaction, customer, history, cohort } = detail;
  const attributions = c.attributions ?? [];
  const detectors = c.detectors ?? {};
  const recommendation = c.recommendation ?? "REVIEW TRANSACTION";
  const recTone = recommendation.startsWith("BLOCK") ? "#ff5a5f" : recommendation.startsWith("HOLD") ? "#f5a524" : recommendation.startsWith("STEP") ? "#46c8dc" : "#2fd07a";

  const payload = {
    transaction_id: c.transactionCode, case_id: c.caseCode, customer_id: c.customerCode,
    transaction_type: c.type, amount: c.amount, location: c.county, merchant: c.merchantName,
    risk_score: c.riskScore, risk_level: c.riskLevel.toLowerCase(), recommendation, confidence: c.confidence,
    model_explanation: attributions.map((a) => ({ factor: a.label, share: Number(a.share.toFixed(1)), direction: a.direction })),
  };

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Fraud Investigation"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <Link href="/fraud" className="text-cyan hover:underline">← case queue</Link>
          <span className="text-fog/40">|</span>
          <span className="num">{c.caseCode}</span>
          <span className="text-fog/40">|</span>
          <span>opened {new Date(c.openedAt).toUTCString().slice(5, 22)}</span>
        </span>
      }
      actions={<CopyJson value={payload} label="copy verdict json" />}
    >
      <div className="space-y-4">
        {/* ---------------------------- verdict header --------------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr]">
          <Panel title="Verdict" icon="shield" accent={recTone} bodyClass="p-4">
            <div className="flex flex-col items-center">
              <RiskGauge score={c.riskScore} size={176} />
              <div className="mt-2"><RiskTag level={c.riskLevel} /></div>
              <div className="mt-4 w-full rounded-[3px] border px-3 py-2.5 text-center" style={{ borderColor: `${recTone}55`, background: `${recTone}12` }}>
                <div className="label-xs">recommendation</div>
                <div className="mt-1 flex items-center justify-center gap-2 font-display text-[15px] font-semibold tracking-[0.06em]" style={{ color: recTone }}>
                  {recommendation}
                </div>
                <div className="num mt-1.5 text-[11px] text-fog">confidence {c.confidence.toFixed(1)}%</div>
                <div className="mt-2"><Meter value={c.confidence} tone={recTone} height={3} /></div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Stat label="potential loss" value={compactKsh(c.potentialLoss)} tone="#ff5a5f" />
              <Stat label="sla" value={`${c.slaMinutes} min`} tone="#f5a524" />
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel title="Transaction under review" icon="file" bodyClass="p-0">
              <div className="grid grid-cols-2 gap-px bg-line/60 md:grid-cols-4">
                {[
                  { k: "transaction", v: c.transactionCode, href: null },
                  { k: "amount", v: compactKsh(c.amount), tone: "#2fd07a" },
                  { k: "type", v: TXN_LABEL[c.type ?? ""] ?? c.type ?? "—" },
                  { k: "channel", v: transaction?.channel ?? "—" },
                  { k: "county", v: c.county ?? "—" },
                  { k: "merchant", v: c.merchantName ?? "P2P / none" },
                  { k: "status", v: transaction?.status ?? "—" },
                  { k: "fee charged", v: transaction ? compactKsh(transaction.fee) : "—" },
                ].map((f) => (
                  <div key={f.k} className="bg-panel px-3.5 py-3">
                    <Label>{f.k}</Label>
                    <div className="num mt-1 truncate text-[13.5px] font-medium" style={{ color: f.tone ?? "#e8f0f1" }}>{f.v}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Panel title="Risk factors" subtitle="policies triggered by the rule engine" icon="warning" accent="#f5a524">
                {attributions.length === 0 && (c.reasons ?? []).length === 0 ? (
                  <Empty title="No discrete factors" note="Escalated by the ensemble on statistical evidence alone." />
                ) : (
                  <ul className="space-y-1.5">
                    {Array.from(new Set([...(c.reasons ?? []), ...attributions.map((a) => a.label)])).slice(0, 8).map((r) => (
                      <li key={r} className="flex items-start gap-2 rounded-[3px] border border-line/70 bg-black/25 px-2.5 py-1.5">
                        <span className="mt-0.5 text-amber"><svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5 5L20 6.5" /></svg></span>
                        <span className="text-[12px] text-chalk">{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Detector votes" subtitle="independent model opinions on this event" icon="cpu" accent="#9d8cff">
                <div className="space-y-2">
                  {DETECTOR_META.map((d) => {
                    const raw = Number(detectors[d.key] ?? 0);
                    const score = Math.round(raw * 100);
                    return (
                      <div key={d.key}>
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11.5px] text-chalk">{d.name}</span>
                            <span className="label-xs block">{d.family} · w={d.weight}</span>
                          </span>
                          <span className="num text-[12px]" style={{ color: score >= 65 ? "#ff5a5f" : score >= 40 ? "#f5a524" : "#2fd07a" }}>{score}</span>
                        </div>
                        <div className="mt-1"><Meter value={score} tone={score >= 65 ? "#ff5a5f" : score >= 40 ? "#f5a524" : "#2fd07a"} height={3} /></div>
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </div>
          </div>
        </div>

        {/* -------------------------- model explanation -------------------------- */}
        <Panel
          title="Model explanation"
          subtitle="occlusion-based attribution (SHAP-style) — each feature is replaced by its population baseline and the shift in ensemble fraud probability is measured"
          icon="target"
          accent="#46c8dc"
        >
          {attributions.length === 0 ? (
            <Empty title="No attribution available" />
          ) : (
            <div className="space-y-2.5">
              {attributions.map((a) => (
                <div key={a.feature}>
                  <div className="flex items-baseline gap-3">
                    <span className="w-[240px] shrink-0 truncate text-[12px] text-chalk">{a.label}</span>
                    <span className="relative h-[18px] flex-1 overflow-hidden rounded-[2px] bg-white/[0.03]">
                      <span className="absolute inset-y-0 left-1/2 w-px bg-line-2" />
                      <span
                        className="absolute inset-y-0 rounded-[2px]"
                        style={{
                          background: a.contribution >= 0 ? "linear-gradient(90deg,#f5a52466,#ff5a5f)" : "linear-gradient(90deg,#2fd07a,#2fd07a66)",
                          width: `${Math.min(50, a.share / 2)}%`,
                          left: a.contribution >= 0 ? "50%" : `${50 - Math.min(50, a.share / 2)}%`,
                        }}
                      />
                    </span>
                    <span className="num w-14 shrink-0 text-right text-[12px] text-chalk">{a.share.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 pl-[252px]">
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.12em]" style={{ color: a.contribution >= 0 ? "#ff5a5f" : "#2fd07a" }}>
                      {a.direction}
                    </span>
                    <span className="truncate text-[10.5px] text-fog">{a.evidence}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ---------------------- subject, cohort and workflow ------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.25fr_1fr]">
          <div className="space-y-4">
            <Panel title="Subject profile" subtitle="customer 360 snapshot at decision time" icon="users">
              {customer ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/customers/${customer.code}`} className="font-display text-[15px] font-semibold text-chalk hover:text-signal">{customer.name}</Link>
                    <Badge tone="cyan">{customer.code}</Badge>
                    <Badge tone={customer.status === "ACTIVE" ? "signal" : "amber"}>{customer.status}</Badge>
                    {customer.segmentName && <Badge tone="iris">{customer.segmentName}</Badge>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="county" value={customer.county} />
                    <Stat label="tenure" value={`${customer.tenureDays}d`} />
                    <Stat label="txn / 30d" value={customer.txn30d} />
                    <Stat label="value / 30d" value={compactKsh(customer.value30d)} tone="#2fd07a" />
                    <Stat label="avg ticket" value={compactKsh(customer.avgTicket)} />
                    <Stat label="peak window" value={customer.peakWindow ?? "—"} />
                    <Stat label="baseline risk" value={`${customer.riskScore}/100`} tone={customer.riskScore > 45 ? "#ff5a5f" : "#f5a524"} />
                    <Stat label="churn probability" value={(customer.churnProbability * 100).toFixed(1) + "%"} tone="#46c8dc" />
                  </div>
                  {cohort && (
                    <div className="mt-4 rounded-[3px] border border-line bg-black/25 p-3">
                      <Label>peer cohort comparison</Label>
                      <div className="mt-2 grid grid-cols-3 gap-3">
                        <div><div className="label-xs">similar txn</div><div className="num mt-0.5 text-[13px] text-chalk">{Number(cohort.count).toLocaleString()}</div></div>
                        <div><div className="label-xs">cohort avg amount</div><div className="num mt-0.5 text-[13px] text-chalk">{compactKsh(Number(cohort.avg_amount))}</div></div>
                        <div><div className="label-xs">cohort flagged</div><div className="num mt-0.5 text-[13px] text-alert">{Number(cohort.flagged).toLocaleString()}</div></div>
                      </div>
                      <p className="mt-2 text-[10.5px] leading-snug text-fog">
                        Same transaction type, same county, amount within ±50%. A subject materially outside this cohort is the
                        statistical basis of the amount-anomaly signal.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <Empty title="Subject record unavailable" />
              )}
            </Panel>

            <Panel title="Subject transaction history" subtitle="last 25 events preceding this decision" icon="pulse" bodyClass="p-0">
              {history.length === 0 ? (
                <Empty title="No prior history" note="First observed activity for this subject — treated as a cold-start risk amplifier." />
              ) : (
                <Table head={["timestamp", "type", "county", "amount", "channel", "risk"]}>
                  {history.map((h) => (
                    <Tr key={h.id}>
                      <Td className="num whitespace-nowrap text-[10.5px] text-fog">{new Date(h.occurredAt).toISOString().slice(5, 16).replace("T", " ")}</Td>
                      <Td className="whitespace-nowrap">{TXN_LABEL[h.type] ?? h.type}</Td>
                      <Td className="whitespace-nowrap text-fog">{h.county}</Td>
                      <Td className="num whitespace-nowrap text-right text-chalk">{compactKsh(h.amount)}</Td>
                      <Td className="whitespace-nowrap text-fog">{h.channel}</Td>
                      <Td className="text-right"><RiskTag level={h.riskLevel} score={h.riskScore} /></Td>
                    </Tr>
                  ))}
                </Table>
              )}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Case workflow" subtitle="state transitions are written to the immutable audit log" icon="check" accent="#2fd07a">
              <CaseActions caseId={c.id} status={c.status} />
              <div className="mt-4 space-y-1.5 border-t border-line pt-3">
                <div className="flex justify-between"><Label>case id</Label><span className="num text-[11px] text-chalk">{c.id}</span></div>
                <div className="flex justify-between"><Label>assignee</Label><span className="num text-[11px] text-chalk">{c.assignee ?? "unassigned"}</span></div>
                <div className="flex justify-between"><Label>opened</Label><span className="num text-[11px] text-fog">{new Date(c.openedAt).toISOString().slice(0, 19).replace("T", " ")}</span></div>
                <div className="flex justify-between"><Label>closed</Label><span className="num text-[11px] text-fog">{c.closedAt ? new Date(c.closedAt).toISOString().slice(0, 19).replace("T", " ") : "—"}</span></div>
              </div>
            </Panel>

            <Panel title="Notification fan-out" subtitle="alert service routing for this verdict" icon="bell" accent="#f5a524">
              <div className="space-y-2">
                {[
                  { ch: "SMS", target: "subject handset + registered guardian", sent: c.riskLevel === "CRITICAL" },
                  { ch: "EMAIL", target: "fraud-ops@mpx.co.ke", sent: true },
                  { ch: "DASHBOARD", target: "investigation queue · sse push", sent: true },
                  { ch: "WEBHOOK", target: "soc-bridge · siem ingest", sent: c.riskLevel === "CRITICAL" },
                ].map((n) => (
                  <div key={n.ch} className="flex items-center gap-2 rounded-[3px] border border-line/70 bg-black/25 px-2.5 py-2">
                    <Badge tone={n.sent ? "signal" : "neutral"}>{n.sent ? "SENT" : "SKIPPED"}</Badge>
                    <span className="num w-[86px] shrink-0 text-[11px] text-chalk">{n.ch}</span>
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-fog">{n.target}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10.5px] leading-relaxed text-fog/70">
                Routing policy: CRITICAL → SMS + WEBHOOK + EMAIL under a 15-minute SLA; HIGH → dashboard push under a
                45-minute SLA. All dispatches are recorded with delivery latency.
              </p>
            </Panel>

            <Panel title="Raw event" subtitle="bronze-layer payload as ingested" icon="code" accent="#46c8dc">
              <pre className="max-h-[240px] overflow-auto rounded-[3px] border border-line bg-black/50 p-3 font-mono text-[10.5px] leading-relaxed text-cyan/85">
{JSON.stringify({ transaction_id: c.transactionCode, customer_id: c.customerCode, transaction_type: c.type, amount: c.amount, merchant_id: c.merchantName, location: c.county, timestamp: transaction?.occurredAt ?? c.openedAt, channel: transaction?.channel ?? "MPESA", risk_score: c.riskScore, risk_level: c.riskLevel.toLowerCase(), detectors, reasons: c.reasons }, null, 2)}
              </pre>
            </Panel>
          </div>
        </div>
      </div>
    </Shell>
  );
}
