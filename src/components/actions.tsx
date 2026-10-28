"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./ui";

export function CaseActions({ caseId, status }: { caseId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [current, setCurrent] = useState(status);
  const [note, setNote] = useState("");

  const transition = async (next: string) => {
    setBusy(next);
    const res = await fetch(`/api/v1/fraud/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next, note }),
    });
    setBusy(null);
    if (res.ok) {
      setCurrent(next);
      router.refresh();
    }
  };

  const options = [
    { key: "INVESTIGATING", label: "start investigation", tone: "border-cyan/40 bg-cyan/10 text-cyan hover:bg-cyan/20" },
    { key: "ESCALATED", label: "escalate to SOC", tone: "border-amber/40 bg-amber/10 text-amber hover:bg-amber/20" },
    { key: "RESOLVED", label: "mark confirmed fraud", tone: "border-alert/40 bg-alert/10 text-alert hover:bg-alert/20" },
    { key: "FALSE_POSITIVE", label: "dismiss · false positive", tone: "border-line-2 bg-panel text-fog hover:text-chalk" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="label-xs">workflow state</span>
        <span className="num rounded-[3px] border border-line-2 bg-black/30 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-chalk">{current}</span>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Investigator note (persisted to the audit log)…"
        className="w-full resize-none rounded-[3px] border border-line bg-black/40 px-3 py-2 text-[12px] text-chalk outline-none transition-colors placeholder:text-fog/50 focus:border-signal/50"
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={busy !== null || current === o.key}
            onClick={() => transition(o.key)}
            className={`flex items-center justify-center gap-2 rounded-[3px] border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${o.tone}`}
          >
            {busy === o.key ? <Icon name="refresh" className="h-3 w-3 animate-spin" /> : <Icon name="check" className="h-3 w-3" />}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AlertAck({ alertId, status }: { alertId: string; status: string }) {
  const router = useRouter();
  const [state, setState] = useState(status);
  const [busy, setBusy] = useState(false);

  const ack = async (next: string) => {
    setBusy(true);
    const res = await fetch("/api/v1/alerts", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert_id: alertId, status: next }),
    });
    setBusy(false);
    if (res.ok) {
      setState(next);
      router.refresh();
    }
  };

  if (state === "RESOLVED") {
    return <span className="num font-mono text-[10px] uppercase tracking-[0.12em] text-signal">resolved</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      {state === "FIRED" && (
        <button type="button" disabled={busy} onClick={() => ack("ACKNOWLEDGED")}
          className="rounded-[3px] border border-line bg-panel px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog transition-colors hover:border-cyan/40 hover:text-cyan disabled:opacity-40">
          ack
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => ack("RESOLVED")}
        className="rounded-[3px] border border-line bg-panel px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog transition-colors hover:border-signal/40 hover:text-signal disabled:opacity-40">
        resolve
      </button>
      <span className="num font-mono text-[9.5px] uppercase tracking-[0.1em] text-fog/60">{state.toLowerCase()}</span>
    </span>
  );
}

export function CopyJson({ value, label = "copy json" }: { value: unknown; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked */
        }
      }}
      className="flex items-center gap-1.5 rounded-[3px] border border-line bg-panel px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog transition-colors hover:border-signal/40 hover:text-signal"
    >
      <Icon name={done ? "check" : "code"} className="h-3 w-3" />
      {done ? "copied" : label}
    </button>
  );
}
