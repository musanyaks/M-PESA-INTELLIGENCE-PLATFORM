import Link from "next/link";
import { Shell } from "@/components/shell";
import { Panel, Label, Badge, Table, Td, Tr, Stat, Meter, Empty, HBar } from "@/components/ui";
import { StreamControl, BenchmarkRunner } from "@/components/live";
import { requirePage } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";
import { getPipeline, getModelRegistry } from "@/lib/dashboard-data";
import { streamStatus } from "@/lib/stream";
import { compactNum } from "@/lib/core";

export const dynamic = "force-dynamic";

const LAYER_TONE: Record<string, string> = { bronze: "#cd8b52", silver: "#9fb3b8", gold: "#f5a524" };

export default async function PipelinePage() {
  const session = await requirePage();
  await ensureReady();
  const [p, models] = await Promise.all([getPipeline(), getModelRegistry()]);
  const stream = streamStatus();
  const twin = (p.twin ?? {}) as Record<string, number | string>;
  const bootstrap = (p.bootstrap ?? {}) as { stage?: string; progress?: number; startedAt?: string; finishedAt?: string; stages?: { name: string; label: string; durationMs: number; records: number }[] };

  const totalRows = p.tableSizes.reduce((a, t) => a + Number(t.rows || 0), 0);
  const maxRun = Math.max(...p.runs.map((r) => r.durationMs), 1);

  return (
    <Shell
      session={{ email: session.email, name: session.name, role: session.role, scopes: session.scopes }}
      title="Data Engineering & Lakehouse"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3">
          <span>Bronze → Silver → Gold · Kafka · Flink · Spark · Airflow</span>
          <span className="text-fog/40">|</span>
          <span className="num">{compactNum(totalRows)} warehouse rows</span>
          <span className="text-fog/40">|</span>
          <span className="num text-signal/80">twin 1:{String(twin.scale ?? 50)}</span>
        </span>
      }
      actions={<StreamControl />}
      wide
    >
      <div className="space-y-4">
        {/* ---------------------------- architecture ---------------------------- */}
        <Panel title="Reference architecture" subtitle="ingestion → streaming → lakehouse → warehouse → intelligence" icon="layers" accent="#46c8dc">
          <div className="touch-scroll no-scrollbar overflow-x-auto">
            <svg viewBox="0 0 1120 330" className="h-[330px] w-full min-w-[1000px]">
              <defs>
                <marker id="parr" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 z" fill="#46c8dc" fillOpacity="0.8" />
                </marker>
              </defs>
              {[
                { x: 10, y: 24, w: 140, h: 44, label: "BATCH FILES", sub: "parquet · s3 drop", tone: "#cd8b52" },
                { x: 10, y: 84, w: 140, h: 44, label: "API EVENTS", sub: "POST /v1/transactions", tone: "#46c8dc" },
                { x: 10, y: 144, w: 140, h: 44, label: "TWIN PRODUCER", sub: "synthetic generator", tone: "#2fd07a" },
                { x: 200, y: 74, w: 140, h: 74, label: "KAFKA", sub: "8 partitions · 3 brokers\nmpesa.bronze.raw", tone: "#9d8cff" },
                { x: 390, y: 14, w: 140, h: 52, label: "FLINK CEP", sub: "fraud · velocity", tone: "#ff5a5f" },
                { x: 390, y: 82, w: 140, h: 52, label: "SPARK STREAMING", sub: "analytics rollups", tone: "#f5a524" },
                { x: 390, y: 150, w: 140, h: 52, label: "KAFKA CONNECT", sub: "jdbc · s3 sink", tone: "#46c8dc" },
                { x: 580, y: 14, w: 130, h: 52, label: "BRONZE", sub: "raw · append only", tone: "#cd8b52" },
                { x: 580, y: 82, w: 130, h: 52, label: "SILVER", sub: "conformed · scored", tone: "#9fb3b8" },
                { x: 580, y: 150, w: 130, h: 52, label: "GOLD", sub: "marts · features", tone: "#f5a524" },
                { x: 760, y: 48, w: 150, h: 116, label: "POSTGRESQL", sub: "warehouse\n13 tables · drizzle orm\nrow level security", tone: "#2fd07a" },
                { x: 960, y: 14, w: 150, h: 44, label: "ML INFERENCE", sub: "7 detectors", tone: "#9d8cff" },
                { x: 960, y: 70, w: 150, h: 44, label: "BI / API", sub: "REST v1 · SSE", tone: "#46c8dc" },
                { x: 960, y: 126, w: 150, h: 44, label: "ALERTS", sub: "sms · email · webhook", tone: "#ff5a5f" },
              ].map((n) => (
                <g key={n.label}>
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={3} fill="#0e1517" stroke={n.tone} strokeOpacity="0.42" />
                  <rect x={n.x} y={n.y} width={3} height={n.h} fill={n.tone} fillOpacity="0.85" />
                  <text x={n.x + n.w / 2 + 2} y={n.y + (n.h > 60 ? 26 : 20)} textAnchor="middle" fontSize="10" fill="#e8f0f1" fontFamily="monospace" letterSpacing="0.8">{n.label}</text>
                  {n.sub.split("\n").map((line, i) => (
                    <text key={i} x={n.x + n.w / 2 + 2} y={n.y + (n.h > 60 ? 42 : 34) + i * 11} textAnchor="middle" fontSize="8.5" fill="#8fa3a8" fontFamily="monospace">{line}</text>
                  ))}
                </g>
              ))}
              {[
                "M150,46 C176,46 176,100 198,100", "M150,106 C176,106 176,110 198,110", "M150,166 C176,166 176,124 198,124",
                "M340,96 C364,96 366,40 388,40", "M340,110 C364,110 366,108 388,108", "M340,124 C364,124 366,176 388,176",
                "M530,40 C554,40 556,40 578,40", "M530,108 C554,108 556,108 578,108", "M530,176 C554,176 556,176 578,176",
                "M710,40 C734,40 736,80 758,80", "M710,108 C734,108 736,106 758,106", "M710,176 C734,176 736,132 758,132",
                "M910,80 C934,80 936,36 958,36", "M910,106 C934,106 936,92 958,92", "M910,132 C934,132 936,148 958,148",
              ].map((d, i) => (
                <path key={i} d={d} fill="none" stroke="#46c8dc" strokeOpacity="0.45" strokeWidth="1.3" markerEnd="url(#parr)" className="flow-dash" />
              ))}
              {[
                { x: 10, y: 232, label: "AIRFLOW", sub: "orchestration · 6 DAGs" },
                { x: 200, y: 232, label: "MLFLOW", sub: "model registry · 10 runs" },
                { x: 390, y: 232, label: "MINIO / S3", sub: "bronze · silver · gold parquet" },
                { x: 580, y: 232, label: "REDIS", sub: "feature cache · rate limits" },
                { x: 760, y: 232, label: "PROMETHEUS", sub: "tps · lag · latency percentiles" },
                { x: 960, y: 232, label: "GRAFANA", sub: "pipeline SLA dashboards" },
              ].map((n) => (
                <g key={n.label}>
                  <rect x={n.x} y={n.y} width={170} height={40} rx={3} fill="#0b1113" stroke="#1e2b2f" />
                  <text x={n.x + 12} y={n.y + 17} fontSize="9.5" fill="#8fa3a8" fontFamily="monospace" letterSpacing="1">{n.label}</text>
                  <text x={n.x + 12} y={n.y + 30} fontSize="8.5" fill="#5f757a" fontFamily="monospace">{n.sub}</text>
                </g>
              ))}
              <text x={10} y={300} fontSize="9" fill="#5f757a" fontFamily="monospace">
                deployment target: docker-compose (local) → ECS/Fargate + MSK + EMR + RDS + S3 + SageMaker (aws)
              </text>
              <text x={10} y={318} fontSize="9" fill="#5f757a" fontFamily="monospace">
                this deployment runs the topology in-process on a single node; partitioning and consumer-group semantics are preserved.
              </text>
            </svg>
          </div>
        </Panel>

        {/* --------------------------- twin + bootstrap -------------------------- */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Panel bodyClass="p-3"><Label>twin customers</Label><div className="num mt-1 font-display text-[20px] font-semibold text-chalk">{compactNum(Number(twin.customers ?? 0))}</div><div className="label-xs mt-1">≈ {compactNum(Number(twin.modelledNationalCustomers ?? 0))} national</div></Panel>
          <Panel bodyClass="p-3"><Label>twin merchants</Label><div className="num mt-1 font-display text-[20px] font-semibold text-chalk">{compactNum(Number(twin.merchants ?? 0))}</div><div className="label-xs mt-1">17 verticals</div></Panel>
          <Panel bodyClass="p-3"><Label>conformed facts</Label><div className="num mt-1 font-display text-[20px] font-semibold text-signal">{compactNum(Number(twin.transactions ?? 0))}</div><div className="label-xs mt-1">≈ {compactNum(Number(twin.modelledNationalTransactions ?? 0))} national</div></Panel>
          <Panel bodyClass="p-3"><Label>observation window</Label><div className="num mt-1 font-display text-[20px] font-semibold text-cyan">{String(twin.days ?? 0)}d</div><div className="label-xs mt-1">hourly seasonality</div></Panel>
          <Panel bodyClass="p-3"><Label>bootstrap</Label><div className="num mt-1 font-display text-[16px] font-semibold text-chalk">{String(bootstrap.stage ?? "—").toUpperCase()}</div><div className="mt-1.5"><Meter value={bootstrap.progress ?? 0} tone="#2fd07a" height={3} /></div></Panel>
          <Panel bodyClass="p-3"><Label>bootstrap duration</Label><div className="num mt-1 font-display text-[20px] font-semibold text-amber">{((bootstrap.stages ?? []).reduce((a, s) => a + s.durationMs, 0) / 1000).toFixed(1)}s</div><div className="label-xs mt-1">{(bootstrap.stages ?? []).length} stages</div></Panel>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Panel title="Lakehouse materialisation log" subtitle="airflow dag runs · per layer · per engine" icon="database" accent="#f5a524" bodyClass="p-0">
            {p.runs.length === 0 ? (
              <Empty title="No pipeline runs recorded" />
            ) : (
              <Table head={["dag", "task", "layer", "engine", "records in", "out", "rejected", "duration", "target"]}>
                {p.runs.map((r) => (
                  <Tr key={r.id}>
                    <Td className="num whitespace-nowrap text-[11px] text-chalk">{r.dag}</Td>
                    <Td className="num whitespace-nowrap text-[11px] text-fog">{r.task}</Td>
                    <Td><Badge tone={r.layer === "gold" ? "amber" : r.layer === "silver" ? "cyan" : "neutral"}>{r.layer}</Badge></Td>
                    <Td className="whitespace-nowrap text-fog">{r.engine}</Td>
                    <Td className="num text-right text-chalk">{r.recordsIn.toLocaleString()}</Td>
                    <Td className="num text-right text-signal">{r.recordsOut.toLocaleString()}</Td>
                    <Td className="num text-right text-alert">{r.rejected.toLocaleString()}</Td>
                    <Td className="w-32">
                      <span className="num text-[11px] text-fog">{(r.durationMs / 1000).toFixed(2)}s</span>
                      <span className="mt-0.5 block"><Meter value={r.durationMs} max={maxRun} tone={LAYER_TONE[r.layer] ?? "#2fd07a"} height={2} /></span>
                    </Td>
                    <Td className="num max-w-[220px] truncate text-[10px] text-fog/70">{r.uri}</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel title="Streaming backbone" subtitle="topics, partitions and consumer-group lag" icon="bolt" accent="#9d8cff">
              <div className="space-y-2.5">
                {stream.topics.map((t) => (
                  <div key={t.name} className="rounded-[3px] border border-line/70 bg-black/25 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="num min-w-0 flex-1 truncate text-[11px] text-chalk">{t.name}</span>
                      <span className="num text-[10px] text-fog">{t.partitions}p</span>
                      <span className="num text-[10px] text-signal">{t.total.toLocaleString()} msgs</span>
                    </div>
                    <div className="mt-1.5 flex gap-[2px]">
                      {t.offsets.map((o, i) => {
                        const max = Math.max(...t.offsets, 1);
                        return (
                          <span key={i} className="h-3 flex-1 rounded-[1px]" title={`partition ${i}: offset ${o}`}
                            style={{ background: `rgba(157,140,255,${0.12 + (o / max) * 0.75})` }} />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-0.5">
                {stream.consumerGroups.map((cg) => (
                  <HBar key={cg.name} label={cg.name} sub={`lag ${cg.lag} · committed ${cg.committed.toLocaleString()}`}
                    value={cg.committed} max={Math.max(...stream.consumerGroups.map((x) => x.committed), 1)}
                    right={`${cg.tps}/s`} tone="#9d8cff" />
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Stat label="producer tps" value={stream.liveTps} tone="#2fd07a" />
                <Stat label="events produced" value={stream.produced.toLocaleString()} />
                <Stat label="inference p99" value={`${stream.inference.p99.toFixed(2)}ms`} tone="#46c8dc" />
                <Stat label="e2e p99" value={`${stream.latency.p99.toFixed(2)}ms`} tone="#f5a524" />
              </div>
            </Panel>

            <Panel title="Warehouse footprint" subtitle="postgres relation sizes" icon="database" accent="#2fd07a" bodyClass="p-0">
              <Table head={["relation", "rows", "size"]}>
                {p.tableSizes.map((t) => (
                  <Tr key={t.table_name}>
                    <Td className="num text-[11px] text-chalk">{t.table_name}</Td>
                    <Td className="num text-right text-fog">{Number(t.rows || 0).toLocaleString()}</Td>
                    <Td className="num text-right text-signal">{t.bytes}</Td>
                  </Tr>
                ))}
              </Table>
            </Panel>
          </div>
        </div>

        {/* ------------------------------ benchmark ----------------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.3fr]">
          <Panel title="Throughput benchmark" subtitle="run a real load profile against the in-process pipeline" icon="gauge" accent="#2fd07a">
            <BenchmarkRunner />
            <p className="mt-3 text-[10.5px] leading-relaxed text-fog/70">
              The harness drives the full path — synthetic producer → bronze topic → feature extraction → seven-detector
              ensemble → verdict — and reports achieved throughput with latency percentiles. Horizontal scale-out in the
              reference deployment is achieved by adding Kafka partitions and Flink task slots, not by changing this code path.
            </p>
          </Panel>

          <Panel title="Benchmark history" subtitle="recorded runs · newest first" icon="chart" accent="#46c8dc" bodyClass="p-0">
            {p.benchmarks.length === 0 ? (
              <Empty title="No benchmark runs yet" note="Launch a load profile to record the first measurement." />
            ) : (
              <Table head={["scenario", "events", "achieved tps", "p50", "p95", "p99", "ml p99", "fraud hits", "errors", "ran"]}>
                {p.benchmarks.map((b) => (
                  <Tr key={b.id}>
                    <Td className="num whitespace-nowrap text-[11px] text-chalk">{b.scenario}</Td>
                    <Td className="num text-right text-fog">{b.events.toLocaleString()}</Td>
                    <Td className="num text-right text-signal">{b.achievedTps.toLocaleString()}</Td>
                    <Td className="num text-right text-fog">{b.p50Ms.toFixed(3)}ms</Td>
                    <Td className="num text-right text-fog">{b.p95Ms.toFixed(3)}ms</Td>
                    <Td className="num text-right text-amber">{b.p99Ms.toFixed(3)}ms</Td>
                    <Td className="num text-right text-cyan">{b.inferenceP99Ms.toFixed(3)}ms</Td>
                    <Td className="num text-right text-alert">{b.fraudHits.toLocaleString()}</Td>
                    <Td className="num text-right text-fog">{b.errorRate.toFixed(3)}%</Td>
                    <Td className="num whitespace-nowrap text-right text-[10px] text-fog/70">{new Date(b.ranAt).toISOString().slice(5, 16).replace("T", " ")}</Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>

        {/* ------------------------- bootstrap + audit -------------------------- */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel title="Bootstrap stages" subtitle="cold-start materialisation of the entire lakehouse" icon="layers" accent="#f5a524">
            {(bootstrap.stages ?? []).length === 0 ? (
              <Empty title="No stage telemetry" />
            ) : (
              <div className="space-y-1.5">
                {(bootstrap.stages ?? []).map((s, i) => (
                  <div key={s.name} className="flex items-center gap-2 sm:gap-3">
                    <span className="num w-4 shrink-0 text-[10px] text-fog/60 sm:w-5">{String(i + 1).padStart(2, "0")}</span>
                    <span className="w-[124px] shrink-0 truncate text-[11px] text-chalk sm:w-[220px] sm:text-[11.5px]">{s.label}</span>
                    <span className="relative h-[6px] min-w-[24px] flex-1 overflow-hidden rounded-[2px] bg-white/[0.04]">
                      <span className="absolute inset-y-0 left-0 rounded-[2px] bg-gradient-to-r from-signal/40 to-signal" style={{ width: `${(s.durationMs / Math.max(...(bootstrap.stages ?? []).map((x) => x.durationMs), 1)) * 100}%` }} />
                    </span>
                    <span className="num w-11 shrink-0 text-right text-[10px] text-fog sm:w-16 sm:text-[10.5px]">{(s.durationMs / 1000).toFixed(1)}s</span>
                    <span className="num hidden w-16 shrink-0 text-right text-[10.5px] text-signal/80 sm:block">{compactNum(s.records)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Audit trail" subtitle="every privileged API call is persisted" icon="file" accent="#9d8cff" bodyClass="p-0">
            {p.audit.length === 0 ? (
              <Empty title="No audit entries" />
            ) : (
              <Table head={["timestamp", "actor", "role", "action", "resource", "result"]}>
                {p.audit.map((a) => (
                  <Tr key={a.id}>
                    <Td className="num whitespace-nowrap text-[10px] text-fog">{new Date(a.at).toISOString().slice(5, 19).replace("T", " ")}</Td>
                    <Td className="whitespace-nowrap text-chalk">{a.actor}</Td>
                    <Td><Badge tone={a.role === "ADMIN" ? "iris" : a.role === "FRAUD_ANALYST" ? "alert" : "cyan"}>{a.role}</Badge></Td>
                    <Td className="num whitespace-nowrap text-[11px] text-cyan">{a.action}</Td>
                    <Td className="num max-w-[180px] truncate text-[10.5px] text-fog">{a.resource}</Td>
                    <Td><Badge tone={a.result === "ALLOW" ? "signal" : "alert"}>{a.result}</Badge></Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-[3px] border border-line bg-panel px-3 py-2 font-mono text-[10px] text-fog/70">
          <Link href="/api-docs" className="text-cyan hover:underline">GET /api/v1/system/pipeline</Link>
          <span>·</span>
          <Link href="/predictions" className="text-cyan hover:underline">model registry ({models.length})</Link>
          <span>·</span>
          <span>bootstrap started {bootstrap.startedAt?.slice(0, 19).replace("T", " ") ?? "—"} · finished {bootstrap.finishedAt?.slice(0, 19).replace("T", " ") ?? "—"}</span>
        </div>
      </div>
    </Shell>
  );
}
