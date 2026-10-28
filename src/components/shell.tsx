"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, StatusDot, Badge } from "./ui";
import { TWIN_SCALE } from "@/lib/core";

export type SessionView = { email: string; name: string; role: string; scopes: string[] } | null;

const NAV: { group: string; items: { href: string; label: string; icon: string; code: string }[] }[] = [
  {
    group: "Command",
    items: [
      { href: "/", label: "Overview", icon: "pulse", code: "01" },
      { href: "/geo", label: "Geographic", icon: "map", code: "02" },
    ],
  },
  {
    group: "Risk operations",
    items: [
      { href: "/fraud", label: "Fraud queue", icon: "shield", code: "03" },
      { href: "/alerts", label: "Alerting", icon: "bell", code: "04" },
    ],
  },
  {
    group: "Intelligence",
    items: [
      { href: "/customers", label: "Customers", icon: "users", code: "05" },
      { href: "/merchants", label: "Merchants", icon: "store", code: "06" },
      { href: "/cashflow", label: "Cash flow", icon: "wallet", code: "07" },
      { href: "/predictions", label: "Predictions", icon: "target", code: "08" },
    ],
  },
  {
    group: "Platform",
    items: [
      { href: "/pipeline", label: "Data pipeline", icon: "layers", code: "09" },
      { href: "/api-docs", label: "API & security", icon: "code", code: "10" },
    ],
  },
];

type Health = {
  status: string;
  database_latency_ms: number;
  lakehouse_materialised: boolean;
  stream: { running: boolean; live_tps: number; produced: number; subscribers: number };
};

export function Shell({
  session, title, subtitle, actions, children, wide = false,
}: {
  session: SessionView; title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    let alive = true;
    // If the httpOnly cookie could not be stored (cross-origin iframe / blocked
    // third-party cookies) fall back to the bearer token mirrored at login.
    const authHeaders = (): HeadersInit => {
      try {
        const t = window.localStorage.getItem("mpx_token");
        return t ? { Authorization: `Bearer ${t}` } : {};
      } catch {
        return {};
      }
    };
    const load = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store", credentials: "include", headers: authHeaders() });
        const json = (await res.json()) as { data?: Health };
        if (alive && json.data) setHealth(json.data);
      } catch {
        /* offline */
      }
    };
    load();
    const t = setInterval(load, 6000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const logout = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const dbOk = health?.status === "ok";
  const streaming = health?.stream.running;

  return (
    <div className="flex min-h-screen">
      {/* ---------------------------- sidebar --------------------------- */}
      <aside className="sticky top-0 hidden h-screen w-[236px] shrink-0 flex-col border-r border-line bg-ink-2/70 backdrop-blur lg:flex">
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
          <span className="relative grid h-8 w-8 place-items-center rounded-[3px] border border-signal/40 bg-signal/10 text-signal">
            <Icon name="bolt" className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-signal pulse-dot" />
          </span>
          <div className="leading-tight">
            <div className="font-display text-[13px] font-semibold tracking-[0.16em] text-chalk">MPX·INTEL</div>
            <div className="label-xs">v2.4.1 · nairobi</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2.5 py-3">
          {NAV.map((group) => (
            <div key={group.group} className="mb-4">
              <div className="label-xs px-2 pb-1.5">{group.group}</div>
              <ul className="space-y-px">
                {group.items.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`group flex items-center gap-2.5 rounded-[3px] border px-2.5 py-[7px] text-[12.5px] transition-all ${
                          active
                            ? "border-signal/30 bg-signal/[0.09] text-chalk"
                            : "border-transparent text-fog hover:border-line hover:bg-white/[0.03] hover:text-chalk"
                        }`}
                      >
                        <span className={active ? "text-signal" : "text-fog/60 group-hover:text-signal/80"}>
                          <Icon name={item.icon} className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1">{item.label}</span>
                        <span className="num text-[9px] text-fog/40">{item.code}</span>
                        {active && <span className="h-3 w-[2px] rounded-full bg-signal" />}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-4 py-3">
          <div className="label-xs mb-2">Digital twin</div>
          <div className="space-y-1.5 font-mono text-[10px] text-fog">
            <div className="flex justify-between"><span>scale factor</span><span className="text-chalk">1:{TWIN_SCALE}</span></div>
            <div className="flex justify-between"><span>lakehouse</span><span className={health?.lakehouse_materialised ? "text-signal" : "text-amber"}>{health?.lakehouse_materialised ? "MATERIALISED" : "BUILDING"}</span></div>
            <div className="flex justify-between"><span>postgres</span><span className="text-chalk">{health?.database_latency_ms ?? "—"}ms</span></div>
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-fog/60">
            Synthetic ecosystem. No live telco connection and no real subscriber data.
          </p>
        </div>
      </aside>

      {/* ----------------------------- main ----------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-ink/88 backdrop-blur-xl">
          <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${wide ? "" : ""}`}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-[17px] font-semibold tracking-[0.02em] text-chalk truncate">{title}</h1>
                <span className="hidden sm:inline-flex">
                  <Badge tone={streaming ? "signal" : "neutral"}>
                    <StatusDot tone={streaming ? "signal" : "fog"} pulse={streaming} />
                    {streaming ? `STREAM LIVE · ${health?.stream.live_tps ?? 0} TPS` : "STREAM IDLE"}
                  </Badge>
                </span>
              </div>
              {subtitle && <div className="mt-1 text-[11.5px] text-fog leading-snug">{subtitle}</div>}
            </div>

            <div className="flex items-center gap-2">
              {actions}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenu((m) => !m)}
                  className="flex items-center gap-2 rounded-[3px] border border-line bg-panel px-2.5 py-1.5 transition-colors hover:border-line-2"
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-signal/15 font-mono text-[10px] text-signal">
                    {session?.name?.[0] ?? "?"}
                  </span>
                  <span className="hidden text-left leading-tight sm:block">
                    <span className="block text-[11.5px] text-chalk">{session?.name ?? "Guest"}</span>
                    <span className="label-xs block">{session?.role ?? "ANONYMOUS"}</span>
                  </span>
                  <Icon name="down" className="h-3 w-3 text-fog" />
                </button>
                {menu && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-64 rounded-[3px] border border-line-2 bg-ink-2 p-3 shadow-2xl shadow-black/60">
                    <div className="label-xs mb-1.5">session</div>
                    <div className="num text-[11px] text-chalk">{session?.email}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(session?.scopes ?? []).map((s) => (
                        <span key={s} className="rounded-[2px] border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] text-fog">{s}</span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={logout}
                      className="mt-3 flex w-full items-center justify-center gap-2 rounded-[3px] border border-alert/30 bg-alert/10 px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-alert transition-colors hover:bg-alert/20"
                    >
                      <Icon name="logout" className="h-3 w-3" /> sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 overflow-x-auto border-t border-line/60 bg-black/25 px-4 py-1.5 font-mono text-[10px] text-fog">
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className={dbOk ? "text-signal" : "text-alert"}>●</span> POSTGRES {dbOk ? "ONLINE" : "DEGRADED"}
            </span>
            <span className="whitespace-nowrap">KAFKA 8 PARTITIONS · 3 BROKERS</span>
            <span className="whitespace-nowrap">FLINK CEP 4 SLOTS</span>
            <span className="whitespace-nowrap">MLFLOW REGISTRY SYNCED</span>
            <span className="whitespace-nowrap text-fog/50">EVENTS PRODUCED {health?.stream.produced?.toLocaleString() ?? 0}</span>
            <span className="ml-auto whitespace-nowrap text-fog/50">UTC {new Date().toISOString().slice(11, 19)}</span>
          </div>
        </header>

        <main className={`min-w-0 flex-1 px-4 py-5 ${wide ? "" : ""}`}>
          <div className="mx-auto w-full max-w-[1680px]">{children}</div>
        </main>

        <footer className="border-t border-line px-4 py-4">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[10px] text-fog/60">
            <span>M-PESA INTELLIGENCE PLATFORM · PROJECT 03</span>
            <span>NEXT.JS 16 · POSTGRESQL · DRIZZLE · IN-PROCESS ML RUNTIME</span>
            <span className="ml-auto">SYNTHETIC DATA — NOT AFFILIATED WITH SAFARICOM</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}
