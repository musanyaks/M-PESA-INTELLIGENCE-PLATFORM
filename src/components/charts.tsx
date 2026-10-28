"use client";

import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, RadialBarChart, RadialBar,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend,
} from "recharts";
import type { ReactNode } from "react";

const GRID = "#1e2b2f";
const AXIS = "#7d9298";

function Tip({ active, payload, label, unit }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[]; label?: string | number; unit?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[3px] border border-line-2 bg-ink-2/97 px-3 py-2 shadow-xl shadow-black/50 backdrop-blur">
      {label !== undefined && <div className="label-xs mb-1.5">{label}</div>}
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.color ?? "#2fd07a" }} />
            <span className="text-fog">{p.name}</span>
            <span className="num ml-auto pl-3 text-chalk">
              {typeof p.value === "number" ? p.value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : p.value}
              {unit ?? ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AreaSeries({
  data, xKey, series, height = 220, unit, band,
}: {
  data: Record<string, unknown>[]; xKey: string;
  series: { key: string; name: string; colour: string; type?: "area" | "line" | "bar"; axis?: "left" | "right" }[];
  height?: number; unit?: string; band?: { base: string; range: string };
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.colour} stopOpacity={0.42} />
                <stop offset="100%" stopColor={s.colour} stopOpacity={0.02} />
              </linearGradient>
            ))}
            {band && (
              <linearGradient id="grad-band" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#46c8dc" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#46c8dc" stopOpacity={0.04} />
              </linearGradient>
            )}
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={26} tick={{ fontSize: 10, fill: AXIS }} />
          <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS }} width={62}
            tickFormatter={(v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v}`)} />
          {series.some((s) => s.axis === "right") && (
            <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS }} width={44} />
          )}
          <Tooltip content={<Tip unit={unit} />} cursor={{ stroke: "#2a3b40" }} />
          {band && (
            <>
              <Area yAxisId="left" dataKey={band.base} stackId="band" stroke="none" fill="transparent" isAnimationActive={false} legendType="none" name="band-base" />
              <Area yAxisId="left" dataKey={band.range} stackId="band" stroke="none" fill="url(#grad-band)" isAnimationActive={false} legendType="none" name="band-range" />
            </>
          )}
          {series.map((s) =>
            s.type === "bar" ? (
              <Bar key={s.key} yAxisId={s.axis ?? "left"} dataKey={s.key} name={s.name} fill={s.colour} radius={[1, 1, 0, 0]} maxBarSize={22} />
            ) : s.type === "line" ? (
              <Line key={s.key} yAxisId={s.axis ?? "left"} type="monotone" dataKey={s.key} name={s.name} stroke={s.colour} strokeWidth={1.6} dot={false} />
            ) : (
              <Area key={s.key} yAxisId={s.axis ?? "left"} type="monotone" dataKey={s.key} name={s.name}
                stroke={s.colour} strokeWidth={1.6} fill={`url(#grad-${s.key})`} dot={false} />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LineSeries({ data, xKey, series, height = 200, unit }: {
  data: Record<string, unknown>[]; xKey: string; series: { key: string; name: string; colour: string; dashed?: boolean }[]; height?: number; unit?: string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={26} tick={{ fontSize: 10, fill: AXIS }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS }} width={58}
            tickFormatter={(v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v}`)} />
          <Tooltip content={<Tip unit={unit} />} cursor={{ stroke: "#2a3b40" }} />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.colour} strokeWidth={1.6}
              strokeDasharray={s.dashed ? "4 4" : undefined} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarSeries({ data, xKey, series, height = 200, horizontal = false, unit }: {
  data: Record<string, unknown>[]; xKey: string; series: { key: string; name: string; colour: string }[]; height?: number; horizontal?: boolean; unit?: string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 6, right: 12, bottom: 0, left: horizontal ? 8 : -16 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="2 4" vertical={!horizontal} horizontal={horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS }}
                tickFormatter={(v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v}`)} />
              <YAxis type="category" dataKey={xKey} tickLine={false} axisLine={{ stroke: GRID }} width={112} tick={{ fontSize: 10, fill: AXIS }} />
            </>
          ) : (
            <>
              <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 10, fill: AXIS }} minTickGap={16} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: AXIS }} width={58}
                tickFormatter={(v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${v}`)} />
            </>
          )}
          <Tooltip content={<Tip unit={unit} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.colour} radius={horizontal ? [0, 2, 2, 0] : [2, 2, 0, 0]} maxBarSize={horizontal ? 14 : 26} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({ data, height = 220, centreLabel, centreValue }: {
  data: { name: string; value: number; colour: string }[]; height?: number; centreLabel?: string; centreValue?: string;
}) {
  return (
    <div className="relative" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="#0b1113" strokeWidth={2}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.colour} />
            ))}
          </Pie>
          <Tooltip content={<Tip />} />
          <Legend verticalAlign="bottom" height={28} iconType="circle" iconSize={7}
            formatter={(v: string) => <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-fog">{v}</span>} />
        </PieChart>
      </ResponsiveContainer>
      {centreValue && (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] -translate-y-1/2 text-center">
          <div className="num font-display text-[20px] font-semibold text-chalk">{centreValue}</div>
          {centreLabel && <div className="label-xs mt-0.5">{centreLabel}</div>}
        </div>
      )}
    </div>
  );
}

export function RiskGauge({ score, size = 170, label = "RISK SCORE" }: { score: number; size?: number; label?: string }) {
  const colour = score >= 85 ? "#ff5a5f" : score >= 65 ? "#f5a524" : score >= 40 ? "#46c8dc" : "#2fd07a";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart innerRadius="72%" outerRadius="100%" data={[{ name: label, value: score, fill: colour }]} startAngle={220} endAngle={-40}>
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
          <RadialBar dataKey="value" cornerRadius={3} background={{ fill: "#16211f" }} isAnimationActive={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="num font-display text-[34px] font-semibold leading-none" style={{ color: colour }}>{score}</span>
        <span className="label-xs mt-1.5">/100</span>
      </div>
    </div>
  );
}

export function RadarProfile({ data, height = 260, colour = "#2fd07a", compare }: {
  data: { axis: string; value: number; peer?: number }[]; height?: number; colour?: string; compare?: string;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 9.5, fill: AXIS }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          {compare && <Radar name={compare} dataKey="peer" stroke="#46c8dc" fill="#46c8dc" fillOpacity={0.12} strokeWidth={1.4} isAnimationActive={false} />}
          <Radar name="customer" dataKey="value" stroke={colour} fill={colour} fillOpacity={0.2} strokeWidth={1.6} isAnimationActive={false} />
          <Tooltip content={<Tip />} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HeatStrip({ cells, height = 120 }: { cells: { label: string; value: number; max: number }[]; height?: number }) {
  return (
    <div className="flex gap-[3px] overflow-hidden" style={{ height }}>
      {cells.map((c, i) => {
        const intensity = Math.min(1, c.value / Math.max(1, c.max));
        return (
          <div key={i} className="group relative flex-1 rounded-[2px] transition-transform hover:scale-y-105"
            style={{ background: `rgba(47,208,122,${0.06 + intensity * 0.86})`, border: "1px solid rgba(47,208,122,0.08)" }}>
            <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-[3px] border border-line-2 bg-ink-2 px-2 py-1 font-mono text-[10px] text-chalk group-hover:block">
              {c.label}: {c.value.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ChartShell({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div>
      {children}
      {note && <div className="label-xs mt-2 border-t border-line/60 pt-2">{note}</div>}
    </div>
  );
}

export function MiniArea({ data, colour = "#2fd07a", height = 60, dataKey = "value" }: { data: Record<string, unknown>[]; colour?: string; height?: number; dataKey?: string }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`mini-${dataKey}-${colour.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colour} stopOpacity={0.4} />
              <stop offset="100%" stopColor={colour} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey={dataKey} stroke={colour} strokeWidth={1.4} fill={`url(#mini-${dataKey}-${colour.replace("#", "")})`} isAnimationActive={false} />
          <Tooltip content={<Tip />} cursor={{ stroke: "#2a3b40" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
