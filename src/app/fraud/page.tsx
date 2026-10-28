import Link from "next/link";
import { Shell } from "@/components/shell";
import { LiveStream } from "@/components/live";
import { Panel, Badge, Label, Table, Td, Tr, RiskTag, Empty, HBar, Meter, Stat } from "@/components/ui";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getFraudQueue, getFraudSummary, getModelRegistry, getSegments } from "@/lib/dashboard-data";
import { RULE_CATALOGUE } from "@/lib/ml/fraud";
import { compactKsh, COUNTIES } from "@/lib/core";

export const dynamic = "force-dynamic";

const LEVELS = ["ALL", "CRITICAL", "HIGH", "ELEVATED"];
const STATUSES = ["ALL", "OPEN", "INVESTIGATING", "ESCALATED", "RESOLVED", "FALSE_POSITIVE"];

export default async function FraudOperations({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const session = await requirePage();
  await ensureReady();
  const sp = await searchParams;
  const level = LEVELS.includes(sp.level ?? "") ? sp.level : "ALL";
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : "ALL";
  const county = sp.county ?? "ALL";

  const [queue, summary, models, segs] = await Promise.all([
    getFraudQueue({ level, status, county, limit: 80 }),
    getFraudSummary(),
    getModelRegistry(),
    getSegments(),
  ]);

  const fraudModels = models.filter((m) => m.task === "fraud_detection" || m.task === "anomaly_detection");
  const ensemble = fraudModels.find((m) => m.family === "STACKED ENSEMBLE") ?? fraudModels[0];
  const em = ensemble?.metrics ?? {};
  const importance = (ensemble?.featureImportance ?? []).slice(0, 8);
  const maxImportance = Math.max(...importance.map((i) => i.importance), 0.0001);
  const maxRule = Math.max(...summary.byRule.map((r) => Number(r.count)), 1);
  const highRisk = segs.find((s) => s.name.toLowerCase().includes("high-risk"));

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Fraud Investigation Desk"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Seven-detector ensemble + ten-policy rule engine</span>
          <span className="text-fog/40">|</span>
          <span className="num">{queue.length} cases in view</span>
          <span className="text-fog/40">|</span>
          <span className="num text-signal/80">AUC {Number(em.auc ?? 0).toFixed(4)} · precision {Number(em.precision ?? 0).toFixed(3)}</span>
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {LEVELS.map((l) => (
            <Link key={l} href={`/fraud?level=${l}&status=${status}&county=${county}`}
              className={`rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] transition-colors ${
                level === l ? "border-alert/50 bg-alert/15 text-alert" : "border-line bg-panel text-fog hover:border-line-2 hover:text-chalk"
              }`}>
              {l}
            </Link>
          ))}
          <span className="mx-1 h-4 w-px bg-line" />
          {STATUSES.map((st) => (
            <Link key={st} href={`/fraud?level=${level}&status=${st}&county=${county}`}
              className={`rounded-[3px] border px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.1em] transition-colors ${
                status === st ? "border-cyan/50 bg-cyan/15 text-cyan" : "border-line bg-panel text-fog hover:border-line-2 hover:text-chalk"
              }`}>
              {st.replace("_", " ").toLowerCase()}
            </Link>
          ))}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Panel bodyClass="p-3"><Label>open cases</Label><div className="num mt-1 font-display text-[24px] font-semibold text-amber">{summary.totals?.open ?? 0}</div></Panel>
          <Panel bodyClass="p-3"><Label>mean time to resolve</Label><div className="num mt-1 font-display text-[24px] font-semibold text-chalk">{Number(summary.totals?.mtta ?? 0)}<span className="text-[12px] text-fog">m</span></div></Panel>
          <Panel bodyClass="p-3"><Label>resolved</Label><div className="num mt-1 font-display text-[24px] font-semibold text-signal">{summary.totals?.resolved ?? 0}</div></Panel>
          <Panel bodyClass="p-3"><Label>loss averted</Label><div className="num mt-1 font-display text-[20px] font-semibold text-signal">{compactKsh(Number(summary.totals?.loss ?? 0))}</div></Panel>
          <Panel bodyClass="p-3"><Label>recall</Label><div className="num mt-1 font-display text-[24px] font-semibold text-cyan">{Number(em.recall ?? 0).toFixed(3)}</div></Panel>
          <Panel bodyClass="p-3"><Label>watchlist segment</Label><div className="num mt-1 font-display text-[24px] font-semibold text-alert">{highRisk?.size ?? 0}</div></Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
          <Panel
            title="Case queue"
            subtitle={`${queue.length} investigations · sorted by ensemble risk score`}
            icon="shield"
            accent="#ff5a5f"
            bodyClass="p-0"
            right={
              <div className="flex items-center gap-1.5">
                <Link href={`/fraud?level=ALL&status=${status}&county=${county}`} className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] uppercase ${county === "ALL" ? "border-signal/40 text-signal" : "border-line text-fog"}`}>all counties</Link>
                {COUNTIES.slice(0, 4).map((c) => (
                  <Link key={c.name} href={`/fraud?level=${level}&status=${status}&county=${encodeURIComponent(c.name)}`}
                    className={`rounded-[2px] border px-1.5 py-0.5 font-mono text-[9px] uppercase transition-colors ${county === c.name ? "border-cyan/40 text-cyan" : "border-line text-fog hover:text-chalk"}`}>
                    {c.name}
                  </Link>
                ))}
              </div>
            }
          >
            {queue.length === 0 ? (
              <Empty title="No cases match these filters" note="Widen the risk level or clear the county filter." />
            ) : (
              <Table head={["case", "transaction", "customer", "type", "county", "amount", "risk", "status", "opened"]}>
                {queue.map((c) => (
                  <Tr key={c.id} className="cursor-pointer">
                    <Td>
                      <Link href={`/fraud/${c.transaction_code}`} className="num text-[11px] text-cyan hover:underline">{c.case_code}</Link>
                    </Td>
                    <Td className="num whitespace-nowrap text-[11px] text-fog">{c.transaction_code}</Td>
                    <Td className="whitespace-nowrap">
                      <Link href={`/customers/${c.customer_code}`} className="text-chalk hover:text-signal">{c.customer_code}</Link>
                      <span className="block truncate text-[10px] text-fog/70">{c.customer_name}</span>
                    </Td>
                    <Td className="whitespace-nowrap text-fog">{c.type}</Td>
                    <Td className="whitespace-nowrap text-fog">{c.county}</Td>
                    <Td className="num whitespace-nowrap text-right text-chalk">{compactKsh(c.amount)}</Td>
                    <Td className="whitespace-nowrap">
                      <Link href={`/fraud/${c.transaction_code}`}><RiskTag level={c.risk_level} score={c.risk_score} /></Link>
                      <span className="mt-1 block w-20"><Meter value={c.risk_score} tone={c.risk_score >= 85 ? "#ff5a5f" : "#f5a524"} height={2} /></span>
                    </Td>
                    <Td>
                      <Badge tone={c.status === "OPEN" ? "amber" : c.status === "RESOLVED" ? "signal" : c.status === "FALSE_POSITIVE" ? "neutral" : "cyan"}>
                        {c.status.replace("_", " ")}
                      </Badge>
                    </Td>
                    <Td className="num whitespace-nowrap text-[10px] text-fog/70">{c.opened_at?.slice(5, 16).replace("T", " ")}</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel title="Model performance" subtitle={`${ensemble?.name ?? "ensemble"} ${ensemble?.version ?? ""}`} icon="cpu" accent="#9d8cff">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="roc auc" value={Number(em.auc ?? 0).toFixed(4)} tone="#9d8cff" />
                <Stat label="f1 score" value={Number(em.f1 ?? 0).toFixed(4)} tone="#2fd07a" />
                <Stat label="precision" value={Number(em.precision ?? 0).toFixed(4)} tone="#46c8dc" />
                <Stat label="recall" value={Number(em.recall ?? 0).toFixed(4)} tone="#f5a524" />
              </div>
              <div className="mt-4 space-y-1.5">
                {fraudModels.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 border-b border-line/50 pb-1.5 last:border-0">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] text-chalk">{m.name}</span>
                      <span className="label-xs block">{m.family}</span>
                    </span>
                    <span className="num text-[11px] text-cyan">{Number((m.metrics as Record<string, number>)?.auc ?? 0).toFixed(3)}</span>
                    <Badge tone={m.status === "PRODUCTION" ? "signal" : "neutral"}>{m.status}</Badge>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Feature attribution" subtitle="mean decrease in impurity · random forest" icon="target" accent="#46c8dc">
              <div className="space-y-0.5">
                {importance.map((f) => (
                  <HBar key={f.feature} label={f.label} value={f.importance * 100} max={maxImportance * 100}
                    right={`${(f.importance * 100).toFixed(1)}%`} tone="#46c8dc" />
                ))}
              </div>
            </Panel>

            <Panel title="Policy catalogue" subtitle="deterministic rules evaluated per event" icon="file" accent="#f5a524">
              <div className="space-y-2">
                {RULE_CATALOGUE.map((r) => {
                  const hits = Number(summary.byRule.find((x) => x.rule === r.id)?.count ?? 0);
                  return (
                    <div key={r.id} className="border-b border-line/50 pb-2 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <span className="num text-[10px] text-amber">{r.id}</span>
                        <span className="flex-1 text-[11.5px] text-chalk">{r.label}</span>
                        <span className="num text-[10px] text-fog">{hits}</span>
                      </div>
                      <p className="mt-0.5 text-[10.5px] leading-snug text-fog">{r.description}</p>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </div>
        </div>

        <LiveStream limit={10} title="Live verdict stream" showStats />
      </div>
    </Shell>
  );
}
