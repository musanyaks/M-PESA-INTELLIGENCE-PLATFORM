import type { ReactNode } from "react";
import { RISK_COLOUR } from "@/lib/core";

/* ------------------------------- icons ---------------------------- */

const PATHS: Record<string, ReactNode> = {
  pulse: <path d="M2 12h4l3 8 4-16 3 8h6" />,
  shield: <path d="M12 3l8 3v6c0 4.4-3.2 8.2-8 9.4C7.2 20.2 4 16.4 4 12V6l8-3zM9.2 12.2l2 2 3.6-3.8" />,
  users: <path d="M16 20v-1.6a3.4 3.4 0 00-3.4-3.4H6.4A3.4 3.4 0 003 18.4V20M9.5 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1.6a3.4 3.4 0 00-2.6-3.3M15.5 4.7a3.5 3.5 0 010 6.6" />,
  store: <path d="M3.5 9.5L5 4h14l1.5 5.5M3.5 9.5h17M3.5 9.5a2.6 2.6 0 004.6 1.7 2.6 2.6 0 004.4 0 2.6 2.6 0 004.4 0 2.6 2.6 0 002.1-1.2M5.5 13v7h13v-7M9.8 20v-5h4.4v5" />,
  map: <path d="M9 4L3 6.4v13.2L9 17l6 2.6 6-2.4V4L15 6.6 9 4zM9 4v13M15 6.6v13" />,
  chart: <path d="M4 20V9M10 20V4M16 20v-7M22 20H2" />,
  layers: <path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5" />,
  bell: <path d="M18 9a6 6 0 10-12 0c0 5-2 6-2 6h16s-2-1-2-6M10.5 20a2 2 0 003 0" />,
  code: <path d="M9 18l-6-6 6-6M15 6l6 6-6 6" />,
  gauge: <path d="M12 14l4-4M4.5 18a9 9 0 1115 0M12 21a2 2 0 100-4 2 2 0 000 4z" />,
  wallet: <path d="M3 7.5A2.5 2.5 0 015.5 5H18v3M3 7.5V18a2 2 0 002 2h15v-5M3 7.5h17.5A1.5 1.5 0 0122 9v3.5h-5a2 2 0 000 4h5" />,
  cpu: <path d="M7 7h10v10H7zM9.5 3v4M14.5 3v4M9.5 17v4M14.5 17v4M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4" />,
  database: <path d="M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  search: <path d="M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  warning: <path d="M12 3l9.5 17H2.5L12 3zM12 9.5v4.5M12 17.2v.1" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  up: <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />,
  down: <path d="M12 5v14M5.5 12.5L12 19l6.5-6.5" />,
  right: <path d="M5 12h14M13 6l6 6-6 6" />,
  play: <path d="M7 4.5l12 7.5-12 7.5v-15z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  refresh: <path d="M20 11a8 8 0 10-2.3 6.3M20 5v6h-6" />,
  logout: <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 17l-5-5 5-5M5 12h11" />,
  bolt: <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z" />,
  grid: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  file: <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M9 13h6M9 17h4" />,
  target: <path d="M12 21a9 9 0 100-18 9 9 0 000 18zM12 17a5 5 0 100-10 5 5 0 000 10zM12 13.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />,
  phone: <path d="M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM11 18h2" />,
};

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof PATHS | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[name] ?? PATHS.pulse}
    </svg>
  );
}

/* ------------------------------ panels ---------------------------- */

export function Panel({
  title, subtitle, right, children, className = "", bodyClass = "p-3 sm:p-4", icon, accent = "#2fd07a",
}: {
  title?: ReactNode; subtitle?: ReactNode; right?: ReactNode; children: ReactNode;
  className?: string; bodyClass?: string; icon?: string; accent?: string;
}) {
  return (
    <section className={`panel flex min-w-0 flex-col ${className}`}>
      {(title || right) && (
        <header className="panel-head">
          <div className="flex min-w-0 flex-[1_1_180px] items-start gap-2.5">
            {icon && (
              <span className="mt-0.5 shrink-0" style={{ color: accent }}>
                <Icon name={icon} className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="font-display text-[13px] font-semibold tracking-[0.06em] uppercase text-chalk truncate">{title}</h2>
              {subtitle && <p className="label-xs mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          {right && (
            <div className="touch-scroll no-scrollbar flex max-w-full shrink-0 items-center gap-2 overflow-x-auto">
              {right}
            </div>
          )}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Label({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`label-xs ${className}`}>{children}</span>;
}

export function Badge({
  children, tone = "neutral", className = "",
}: {
  children: ReactNode; tone?: "neutral" | "signal" | "amber" | "alert" | "cyan" | "iris"; className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "border-line-2 text-fog bg-white/[0.02]",
    signal: "border-signal/40 text-signal bg-signal/10",
    amber: "border-amber/40 text-amber bg-amber/10",
    alert: "border-alert/40 text-alert bg-alert/10",
    cyan: "border-cyan/40 text-cyan bg-cyan/10",
    iris: "border-iris/40 text-iris bg-iris/10",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${tones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function RiskTag({ level, score }: { level?: string | null; score?: number | null }) {
  const key = (level ?? (score == null ? "NORMAL" : score >= 85 ? "CRITICAL" : score >= 65 ? "HIGH" : score >= 40 ? "ELEVATED" : "NORMAL")).toUpperCase();
  const colour = RISK_COLOUR[key] ?? "#8fa3a8";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]" style={{ color: colour }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: colour }} />
      {key}
      {score != null && <span className="text-fog">· {score}</span>}
    </span>
  );
}

export function StatusDot({ tone = "signal", pulse = true }: { tone?: string; pulse?: boolean }) {
  const colour = tone === "alert" ? "#ff5a5f" : tone === "amber" ? "#f5a524" : tone === "fog" ? "#8fa3a8" : "#2fd07a";
  return <span className={`inline-block h-2 w-2 rounded-full ${pulse ? "pulse-dot" : ""}`} style={{ background: colour }} />;
}

export function Delta({ value, invert = false, suffix = "%" }: { value: number; invert?: boolean; suffix?: string }) {
  const positive = invert ? value < 0 : value > 0;
  const colour = value === 0 ? "#8fa3a8" : positive ? "#2fd07a" : "#ff5a5f";
  return (
    <span className="num inline-flex items-center gap-0.5 text-[11px] font-medium" style={{ color: colour }}>
      <Icon name={value > 0 ? "up" : value < 0 ? "down" : "right"} className="h-3 w-3" />
      {Math.abs(value).toFixed(1)}
      {suffix}
    </span>
  );
}

export function KPI({
  label, value, delta, sub, icon, tone = "#2fd07a", projected,
}: {
  label: string; value: string; delta?: number; sub?: ReactNode; icon?: string; tone?: string; projected?: string;
}) {
  return (
    <div className="panel p-4 group hover:border-line-2 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="label-xs">{label}</span>
        <span style={{ color: tone }} className="opacity-70 group-hover:opacity-100 transition-opacity">
          {icon && <Icon name={icon} className="h-3.5 w-3.5" />}
        </span>
      </div>
      <div className="mt-2.5 flex items-end gap-2">
        <span className="num font-display text-[23px] leading-none font-semibold text-chalk sm:text-[28px]">{value}</span>
        {delta !== undefined && <span className="mb-0.5"><Delta value={delta} invert={label.toLowerCase().includes("fraud")} /></span>}
      </div>
      {projected && (
        <div className="mt-1.5 font-mono text-[10px] text-fog/70">≈ {projected} <span className="text-signal/60">nationalised</span></div>
      )}
      {sub && <div className="mt-2 text-[11px] text-fog leading-snug">{sub}</div>}
    </div>
  );
}

export function Meter({ value, max = 100, tone = "#2fd07a", height = 4 }: { value: number; max?: number; tone?: string; height?: number }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="w-full rounded-full bg-white/[0.05] overflow-hidden" style={{ height }}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

export function HBar({ label, value, max, right, tone = "#2fd07a", sub }: { label: ReactNode; value: number; max: number; right?: ReactNode; tone?: string; sub?: ReactNode }) {
  const pct = Math.max(1.5, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="grid grid-cols-[minmax(96px,1.1fr)_2.4fr_auto] items-center gap-3 py-[5px]">
      <div className="min-w-0">
        <div className="truncate text-[12px] text-chalk/90">{label}</div>
        {sub && <div className="label-xs mt-0.5 truncate">{sub}</div>}
      </div>
      <div className="relative h-[7px] rounded-[2px] bg-white/[0.04]">
        <div className="absolute inset-y-0 left-0 rounded-[2px]" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${tone}44, ${tone})` }} />
      </div>
      <div className="num text-right text-[11px] text-chalk/85 min-w-[74px]">{right ?? value.toLocaleString()}</div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="border-l border-line pl-3">
      <div className="label-xs">{label}</div>
      <div className="num mt-1 text-[15px] font-medium" style={{ color: tone ?? "#e8f0f1" }}>{value}</div>
    </div>
  );
}

export function Sparkline({ data, tone = "#2fd07a", width = 120, height = 30, fill = true }: { data: number[]; tone?: string; width?: number; height?: number; fill?: boolean }) {
  if (data.length < 2) return <div className="h-[30px]" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - ((v - min) / span) * (height - 4) - 2]);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      {fill && <path d={`${d} L${width},${height} L0,${height} Z`} fill={`${tone}1f`} />}
      <path d={d} fill="none" stroke={tone} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2" fill={tone} />
    </svg>
  );
}

export function Table({
  head, children, className = "",
}: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={`touch-scroll no-scrollbar overflow-x-auto ${className}`}>
      <table className="w-full min-w-max border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line">
            {head.map((h, i) => (
              <th key={i} className="label-xs whitespace-nowrap px-3 py-2 text-left font-medium first:pl-0 last:pr-0">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children, className = "", href }: { children: ReactNode; className?: string; href?: string }) {
  const base = `border-b border-line/60 transition-colors hover:bg-white/[0.03] ${className}`;
  if (href) {
    return (
      <tr className={base}>
        <td colSpan={100} className="p-0">
          <a href={href} className="flex">{children}</a>
        </td>
      </tr>
    );
  }
  return <tr className={base}>{children}</tr>;
}

export function Td({ children, className = "", align = "left", style }: { children: ReactNode; className?: string; align?: "left" | "right" | "center"; style?: React.CSSProperties }) {
  return (
    <td style={style} className={`px-3 py-2 first:pl-0 last:pr-0 ${align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left"} ${className}`}>
      {children}
    </td>
  );
}

export function Empty({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <span className="text-fog/50"><Icon name="database" className="h-6 w-6" /></span>
      <p className="font-display text-[13px] text-chalk/80">{title}</p>
      {note && <p className="label-xs max-w-sm">{note}</p>}
    </div>
  );
}

export function SegmentedControl({
  options, value, onChange,
}: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-[3px] border border-line bg-black/30 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors ${
            value === o.value ? "bg-signal/15 text-signal" : "text-fog hover:text-chalk"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
