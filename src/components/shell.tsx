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

/** five destinations pinned to the mobile tab bar */
const TABS = [
  { href: "/", label: "Overview", icon: "pulse" },
  { href: "/fraud", label: "Fraud", icon: "shield" },
  { href: "/customers", label: "Customers", icon: "users" },
  { href: "/pipeline", label: "Pipeline", icon: "layers" },
];

type Health = {
  status: string;
  database_latency_ms: number;
  lakehouse_materialised: boolean;
  stream: { running: boolean; live_tps: number; produced: number; subscribers: number };
};

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

export function Shell({
  session, title, subtitle, actions, children, wide = false,
}: {
  session: SessionView; title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; wide?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    let alive = true;
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

  // close the drawer on navigation and lock body scroll while it is open
  useEffect(() => {
    setDrawer(false);
    setMenu(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const logout = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" });
    try {
      window.localStorage.removeItem("mpx_token");
    } catch {
      /* storage disabled */
    }
    document.cookie = "mpx_token=; Path=/; Max-Age=0; SameSite=None; Secure; Partitioned";
    document.cookie = "mpx_token=; Path=/; Max-Age=0; SameSite=Lax";
    router.push("/login");
    router.refresh();
  };

  const dbOk = health?.status === "ok";
  const streaming = health?.stream.running;

  const navList = (onSelect?: () => void) =>
    NAV.map((group) => (
      <div key={group.group} className="mb-4">
        <div className="label-xs px-2 pb-1.5">{group.group}</div>
        <ul className="space-y-px">
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onSelect}
                  className={`group flex items-center gap-2.5 rounded-[3px] border px-2.5 py-[9px] text-[13px] transition-all lg:py-[7px] lg:text-[12.5px] ${
                    active
                      ? "border-signal/30 bg-signal/[0.09] text-chalk"
                      : "border-transparent text-fog hover:border-line hover:bg-white/[0.03] hover:text-chalk"
                  }`}
                >
                  <span className={active ? "text-signal" : "text-fog/60 group-hover:text-signal/80"}>
                    <Icon name={item.icon} className="h-4 w-4 lg:h-3.5 lg:w-3.5" />
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
    ));

  return (
    <div className="flex min-h-screen">
      {/* ------------------------- desktop sidebar ------------------------ */}
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
        <nav className="flex-1 overflow-y-auto px-2.5 py-3">{navList()}</nav>
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

      {/* --------------------------- mobile drawer ------------------------- */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-[278px] max-w-[86vw] flex-col border-r border-line bg-ink-2 shadow-2xl shadow-black/70">
            <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
              <span className="grid h-8 w-8 place-items-center rounded-[3px] border border-signal/40 bg-signal/10 text-signal">
                <Icon name="bolt" className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-display text-[13px] font-semibold tracking-[0.16em] text-chalk">MPX·INTEL</div>
                <div className="label-xs">v2.4.1 · nairobi</div>
              </div>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close" className="text-fog hover:text-alert">
                <Icon name="x" className="h-4 w-4" />
              </button>
            </div>
            <nav className="touch-scroll flex-1 overflow-y-auto px-2.5 py-3">{navList(() => setDrawer(false))}</nav>
            <div className="safe-bottom border-t border-line px-4 py-3">
              <div className="space-y-1.5 font-mono text-[10px] text-fog">
                <div className="flex justify-between"><span>twin scale</span><span className="text-chalk">1:{TWIN_SCALE}</span></div>
                <div className="flex justify-between">
                  <span>lakehouse</span>
                  <span className={health?.lakehouse_materialised ? "text-signal" : "text-amber"}>
                    {health?.lakehouse_materialised ? "MATERIALISED" : "BUILDING"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>stream</span>
                  <span className={streaming ? "text-signal" : "text-fog"}>{streaming ? `${health?.stream.live_tps ?? 0} TPS` : "IDLE"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------- main ------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-line bg-ink/92 backdrop-blur-xl">
          <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[3px] border border-line bg-panel text-fog transition-colors hover:border-signal/40 hover:text-signal lg:hidden"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate font-display text-[15px] font-semibold tracking-[0.02em] text-chalk sm:text-[17px]">{title}</h1>
                <span className="hidden shrink-0 sm:inline-flex">
                  <Badge tone={streaming ? "signal" : "neutral"}>
                    <StatusDot tone={streaming ? "signal" : "fog"} pulse={streaming} />
                    {streaming ? `STREAM LIVE · ${health?.stream.live_tps ?? 0} TPS` : "STREAM IDLE"}
                  </Badge>
                </span>
              </div>
              {subtitle && (
                <div className="mt-0.5 text-[11.5px] leading-snug text-fog">
                  <span className="line-clamp-1 sm:hidden">{subtitle}</span>
                  <span className="hidden sm:inline">{subtitle}</span>
                </div>
              )}
            </div>

            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMenu((m) => !m)}
                aria-label="Session menu"
                className="flex items-center gap-2 rounded-[3px] border border-line bg-panel px-2 py-1.5 transition-colors hover:border-line-2 sm:px-2.5"
              >
                <span className="grid h-5 w-5 place-items-center rounded-full bg-signal/15 font-mono text-[10px] text-signal">
                  {session?.name?.[0] ?? "?"}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block max-w-[130px] truncate text-[11.5px] text-chalk">{session?.name ?? "Guest"}</span>
                  <span className="label-xs block">{session?.role ?? "ANONYMOUS"}</span>
                </span>
              </button>
              {menu && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[248px] rounded-[3px] border border-line-2 bg-ink-2 p-3 shadow-2xl shadow-black/60">
                  <div className="label-xs mb-1.5">session</div>
                  <div className="num truncate text-[11px] text-chalk">{session?.email}</div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {(session?.scopes ?? []).map((s) => (
                      <span key={s} className="rounded-[2px] border border-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9px] text-fog">{s}</span>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
                    <span className="flex items-center gap-1.5 font-mono text-[10px] text-fog">
                      <StatusDot tone={streaming ? "signal" : "fog"} pulse={streaming} />
                      {streaming ? `${health?.stream.live_tps ?? 0} tps` : "stream idle"}
                    </span>
                    <span className={`font-mono text-[10px] ${dbOk ? "text-signal" : "text-alert"}`}>{dbOk ? "db ok" : "db degraded"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={logout}
                    className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-[3px] border border-alert/30 bg-alert/10 px-2 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-alert transition-colors hover:bg-alert/20"
                  >
                    <Icon name="logout" className="h-3 w-3" /> sign out
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* page-level filters live in their own scrollable strip on small screens */}
          {actions && (
            <div className="touch-scroll no-scrollbar overflow-x-auto border-t border-line/60 bg-black/20 px-3 py-2 sm:px-4">
              <div className="flex w-max items-center gap-1.5">{actions}</div>
            </div>
          )}

          <div className="touch-scroll no-scrollbar flex items-center gap-4 overflow-x-auto border-t border-line/60 bg-black/25 px-3 py-1.5 font-mono text-[10px] text-fog sm:px-4">
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <span className={dbOk ? "text-signal" : "text-alert"}>●</span> POSTGRES {dbOk ? "ONLINE" : "DEGRADED"}
            </span>
            <span className="shrink-0 whitespace-nowrap">KAFKA 8P · 3 BROKERS</span>
            <span className="shrink-0 whitespace-nowrap">FLINK CEP 4 SLOTS</span>
            <span className="hidden shrink-0 whitespace-nowrap sm:inline">MLFLOW REGISTRY SYNCED</span>
            <span className="shrink-0 whitespace-nowrap text-fog/50">EVENTS {health?.stream.produced?.toLocaleString() ?? 0}</span>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-3 py-4 pb-24 sm:px-4 sm:py-5 lg:pb-5">
          <div className={`mx-auto w-full min-w-0 ${wide ? "max-w-[1680px]" : "max-w-[1680px]"}`}>{children}</div>
        </main>

        <footer className="hidden border-t border-line px-4 py-4 lg:block">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[10px] text-fog/60">
            <span>M-PESA INTELLIGENCE PLATFORM · PROJECT 03</span>
            <span>NEXT.JS 16 · POSTGRESQL · DRIZZLE · IN-PROCESS ML RUNTIME</span>
            <span className="ml-auto">SYNTHETIC DATA — NOT AFFILIATED WITH SAFARICOM</span>
          </div>
        </footer>
      </div>

      {/* -------------------------- mobile tab bar ------------------------- */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-ink-2/97 backdrop-blur-xl lg:hidden" aria-label="Primary">
        {TABS.map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex flex-1 flex-col items-center gap-1 py-2 transition-colors ${active ? "text-signal" : "text-fog hover:text-chalk"}`}
            >
              <span className={active ? "text-signal" : ""}>
                <Icon name={t.icon} className="h-[18px] w-[18px]" />
              </span>
              <span className="font-mono text-[9px] uppercase tracking-[0.08em]">{t.label}</span>
              {active && <span className="h-[2px] w-6 rounded-full bg-signal" />}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawer(true)}
          className={`flex flex-1 flex-col items-center gap-1 py-2 transition-colors ${drawer ? "text-signal" : "text-fog hover:text-chalk"}`}
          aria-label="All sections"
        >
          <Icon name="grid" className="h-[18px] w-[18px]" />
          <span className="font-mono text-[9px] uppercase tracking-[0.08em]">More</span>
        </button>
      </nav>
    </div>
  );
}

export function PageActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2">{children}</div>;
}
