"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon, RiskTag, Badge, Panel } from "./ui";
import { TXN_LABEL } from "@/lib/core";

export type LiveTxn = {
  transaction_id: string;
  customer_id: string;
  merchant: string | null;
  transaction_type: string;
  amount: number;
  location: string;
  channel: string;
  status: string;
  risk_score: number;
  risk_level: string;
  recommendation: string;
  reasons: string[];
  timestamp: string;
  partition: number;
  offset: number;
  inference_ms: number;
  end_to_end_ms: number;
};

type Status = { running: boolean; live_tps: number; produced: number; fraud_hits: number; latency: { p50: number; p95: number; p99: number }; inference: { p50: number; p99: number }; topics: { name: string; partitions: number; total: number; headOffset: number }[]; consumerGroups: { name: string; lag: number; committed: number }[]; subscribers: number };

export function LiveStream({ limit = 14, title = "Live transaction stream", showStats = true }: { limit?: number; title?: string; showStats?: boolean }) {
  const [rows, setRows] = useState<LiveTxn[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);

  useEffect(() => {
    let es: EventSource | null = null;
    const bearer = (): HeadersInit => {
      try {
        const t = window.localStorage.getItem("mpx_token");
        return t ? { Authorization: `Bearer ${t}` } : {};
      } catch {
        return {};
      }
    };
    const connect = async () => {
      try {
        await fetch("/api/v1/stream", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...bearer() },
          body: JSON.stringify({ action: "start", rate: 4 }),
        });
      } catch {
        /* producer start is best-effort */
      }
      es = new EventSource("/api/v1/stream", { withCredentials: true });
      source.current = es;
      es.onopen = () => {
        setConnected(true);
        setError(null);
      };
      es.addEventListener("transaction", (ev) => {
        const data = JSON.parse((ev as MessageEvent).data) as LiveTxn;
        setRows((prev) => [data, ...prev].slice(0, limit));
      });
      es.addEventListener("status", (ev) => setStatus(JSON.parse((ev as MessageEvent).data) as Status));
      es.addEventListener("heartbeat", (ev) => {
        const hb = JSON.parse((ev as MessageEvent).data) as { live_tps: number; produced: number; fraud_hits: number; p99: number };
        setStatus((s) => (s ? { ...s, live_tps: hb.live_tps, produced: hb.produced, fraud_hits: hb.fraud_hits } : s));
      });
      es.onerror = () => {
        setConnected(false);
        setError("stream reconnecting");
      };
    };
    connect();
    return () => {
      es?.close();
      source.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  return (
    <Panel
      title={title}
      icon="pulse"
      subtitle={connected ? `SSE · partition fan-out · ${status?.live_tps ?? 0} events/s` : "connecting to broker"}
      right={
        <div className="flex items-center gap-2">
          {error && <span className="font-mono text-[10px] text-amber">{error}</span>}
          <Badge tone={connected ? "signal" : "amber"}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-signal pulse-dot" : "bg-amber blink"}`} />
            {connected ? "CONSUMING" : "RECONNECT"}
          </Badge>
        </div>
      }
      bodyClass="p-0"
    >
      {showStats && (
        <div className="grid grid-cols-2 gap-px border-b border-line bg-line/60 sm:grid-cols-4">
          {[
            { label: "produced", value: (status?.produced ?? 0).toLocaleString() },
            { label: "fraud hits", value: (status?.fraud_hits ?? 0).toLocaleString(), tone: "#ff5a5f" },
            { label: "inference p99", value: `${(status?.inference.p99 ?? 0).toFixed(2)}ms` },
            { label: "e2e p99", value: `${(status?.latency.p99 ?? 0).toFixed(2)}ms` },
          ].map((s) => (
            <div key={s.label} className="bg-panel px-3 py-2">
              <div className="label-xs">{s.label}</div>
              <div className="num mt-0.5 text-[13px] font-medium" style={{ color: s.tone ?? "#e8f0f1" }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="divide-y divide-line/60">
        {rows.length === 0 && (
          <div className="flex items-center gap-3 px-4 py-8 text-fog">
            <span className="sweep relative h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em]">awaiting events</span>
          </div>
        )}
        {rows.map((r) => {
          const flagged = r.risk_level === "HIGH" || r.risk_level === "CRITICAL";
          return (
            <div
              key={`${r.transaction_id}-${r.offset}`}
              className="row-enter flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-line/40 px-3 py-2 last:border-0 hover:bg-white/[0.025] sm:px-4 sm:py-[7px]"
            >
              <span className="num shrink-0 text-[10px] text-fog/60">{r.transaction_id.slice(-6)}</span>
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.08em] text-cyan/90">
                {TXN_LABEL[r.transaction_type] ?? r.transaction_type}
              </span>
              <span className="num shrink-0 text-[12px] text-chalk">KSh {r.amount.toLocaleString()}</span>
              <span className="shrink-0 text-[11px] text-fog">{r.location}</span>
              <span className="hidden min-w-0 flex-1 truncate text-[10.5px] text-fog/70 md:block">
                {r.merchant ?? r.customer_id}
              </span>
              {flagged && (
                <span className="flex w-full items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-amber lg:w-auto lg:flex-none">
                  <Icon name="warning" className="h-3 w-3 shrink-0" />
                  <span className="truncate">{r.reasons.slice(0, 2).join(" · ") || "ensemble signal"}</span>
                </span>
              )}
              <span className="ml-auto flex shrink-0 items-center gap-2.5">
                <span className="num hidden text-[9.5px] text-fog/50 sm:block">p{r.partition}·o{r.offset}</span>
                <span className="num hidden text-[9.5px] text-fog/50 md:block">{r.inference_ms.toFixed(1)}ms</span>
                {flagged ? (
                  <Link href={`/fraud/${r.transaction_id}`} className="shrink-0">
                    <RiskTag level={r.risk_level} score={r.risk_score} />
                  </Link>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-signal">
                    <Icon name="check" className="h-3 w-3" /> OK
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export function StreamControl() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/v1/system/status", { cache: "no-store", credentials: "include" });
    const json = (await res.json()) as { data?: { stream: Status } };
    if (json.data?.stream) setStatus(json.data.stream);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const act = async (action: string, rate?: number) => {
    setBusy(true);
    await fetch("/api/v1/stream", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, rate }),
    }).catch(() => undefined);
    await load();
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => act(status?.running ? "stop" : "start", 6)}
        disabled={busy}
        className={`flex items-center gap-1.5 rounded-[3px] border px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors disabled:opacity-50 ${
          status?.running ? "border-amber/40 bg-amber/10 text-amber hover:bg-amber/20" : "border-signal/40 bg-signal/10 text-signal hover:bg-signal/20"
        }`}
      >
        <Icon name={status?.running ? "pause" : "play"} className="h-3 w-3" />
        {status?.running ? "pause producer" : "start producer"}
      </button>
      {[2, 4, 10, 25].map((r) => (
        <button
          key={r}
          type="button"
          disabled={busy}
          onClick={() => act("start", r)}
          className={`rounded-[3px] border px-2 py-1.5 font-mono text-[10px] transition-colors disabled:opacity-50 ${
            status?.running && status.live_tps > r - 2 && status.live_tps < r + 3
              ? "border-cyan/40 bg-cyan/10 text-cyan"
              : "border-line bg-panel text-fog hover:border-line-2 hover:text-chalk"
          }`}
        >
          {r}/s
        </button>
      ))}
    </div>
  );
}

export function BenchmarkRunner() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ events: number; achievedTps: number; p50Ms: number; p95Ms: number; p99Ms: number; inferenceP99Ms: number; durationMs: number; fraudHits: number; errorRate: number } | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const run = async (events: number) => {
    setRunning(true);
    setLog((l) => [`> launching load profile: ${events.toLocaleString()} events`, ...l]);
    const res = await fetch("/api/v1/system/benchmark", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events, scenario: `burst-${events}` }),
    });
    const json = (await res.json()) as { data?: typeof result };
    if (json.data) {
      setResult(json.data);
      setLog((l) => [
        `> complete in ${json.data!.durationMs}ms · ${json.data!.achievedTps.toLocaleString()} ev/s · p99 ${json.data!.p99Ms.toFixed(3)}ms · inference p99 ${json.data!.inferenceP99Ms.toFixed(3)}ms · fraud hits ${json.data!.fraudHits}`,
        ...l,
      ]);
    }
    setRunning(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {[1000, 5000, 20000, 60000].map((n) => (
          <button
            key={n}
            type="button"
            disabled={running}
            onClick={() => run(n)}
            className="rounded-[3px] border border-line bg-panel px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-fog transition-colors hover:border-signal/40 hover:text-signal disabled:opacity-40"
          >
            {n.toLocaleString()} events
          </button>
        ))}
      </div>
      {result && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[3px] border border-line bg-line/60 sm:grid-cols-4">
          {[
            { label: "throughput", value: `${result.achievedTps.toLocaleString()}/s`, tone: "#2fd07a" },
            { label: "p50 latency", value: `${result.p50Ms.toFixed(3)}ms` },
            { label: "p99 latency", value: `${result.p99Ms.toFixed(3)}ms`, tone: "#f5a524" },
            { label: "ml inference p99", value: `${result.inferenceP99Ms.toFixed(3)}ms`, tone: "#46c8dc" },
            { label: "events", value: result.events.toLocaleString() },
            { label: "fraud hits", value: result.fraudHits.toLocaleString(), tone: "#ff5a5f" },
            { label: "error rate", value: `${result.errorRate.toFixed(3)}%` },
            { label: "duration", value: `${(result.durationMs / 1000).toFixed(2)}s` },
          ].map((s) => (
            <div key={s.label} className="bg-panel px-3 py-2">
              <div className="label-xs">{s.label}</div>
              <div className="num mt-0.5 text-[13px] font-medium" style={{ color: s.tone ?? "#e8f0f1" }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="max-h-[132px] overflow-y-auto rounded-[3px] border border-line bg-black/40 p-3 font-mono text-[10.5px] leading-relaxed text-signal/80">
        {log.length === 0 ? <span className="text-fog/50">$ benchmark idle — select a load profile</span> : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
