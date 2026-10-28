"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KENYA_COUNTY_GEOMETRY, KENYA_GEOMETRY_BOUNDS } from "@/lib/kenya-geometry";
import { COUNTIES, compactKsh, compactNum } from "@/lib/core";

export type MetricKey = "value" | "count" | "risk" | "merchants" | "customers";

export type CountyDatum = {
  county: string;
  count: number;
  value: number;
  risk: number;
  customers: number;
  merchants: number;
  flagged: number;
  fraudRate: number;
};

const H = 600;
const { minLon, maxLon, minLat, maxLat } = KENYA_GEOMETRY_BOUNDS;
const MID_COS = Math.cos((((maxLat + minLat) / 2) * Math.PI) / 180);
const W = Math.round(((maxLon - minLon) * MID_COS / (maxLat - minLat)) * H);

function px(lon: number) {
  return ((lon - minLon) * MID_COS) / ((maxLon - minLon) * MID_COS) * W;
}
function py(lat: number) {
  return ((maxLat - lat) / (maxLat - minLat)) * H;
}

/** sequential ramp for volume-style metrics */
function rampVolume(t: number): string {
  const stops: [number, number[]][] = [
    [0.0, [12, 26, 28]],
    [0.35, [18, 78, 62]],
    [0.7, [34, 154, 101]],
    [1.0, [93, 226, 154]],
  ];
  return ramp(t, stops);
}

/** diverging ramp for risk-style metrics */
function rampRisk(t: number): string {
  const stops: [number, number[]][] = [
    [0.0, [18, 78, 62]],
    [0.45, [214, 168, 62]],
    [0.75, [232, 122, 62]],
    [1.0, [255, 90, 95]],
  ];
  return ramp(t, stops);
}

function ramp(t: number, stops: [number, number[]][]): string {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const f = (x - p0) / Math.max(1e-9, p1 - p0);
      const rgb = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
      return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    }
  }
  const last = stops[stops.length - 1][1];
  return `rgb(${last[0]},${last[1]},${last[2]})`;
}

const METRIC_LABEL: Record<MetricKey, string> = {
  value: "transaction value",
  count: "transaction volume",
  risk: "mean risk score",
  merchants: "merchant density",
  customers: "customer density",
};

export function KenyaMap({
  data, metric, selected,
}: {
  data: CountyDatum[];
  metric: MetricKey;
  selected: string | null;
}) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const pointer = useRef<"mouse" | "touch" | "pen">("mouse");
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const [labels, setLabels] = useState(true);

  const byName = useMemo(() => new Map(data.map((d) => [d.county, d])), [data]);

  const paths = useMemo(
    () =>
      KENYA_COUNTY_GEOMETRY.map((g) => ({
        name: g.n,
        centroid: [px(g.c[0]), py(g.c[1])] as [number, number],
        d: g.p
          .map((ring) => {
            let out = "";
            for (let i = 0; i < ring.length; i += 2) {
              out += `${i === 0 ? "M" : "L"}${px(ring[i]).toFixed(2)},${py(ring[i + 1]).toFixed(2)}`;
            }
            return out + "Z";
          })
          .join(" "),
        area: g.p[0] ? g.p[0].length / 2 : 0,
      })),
    [],
  );

  const values = useMemo(
    () => KENYA_COUNTY_GEOMETRY.map((g) => Number(byName.get(g.n)?.[metric] ?? 0)),
    [byName, metric],
  );
  const maxV = Math.max(...values, 1);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const isRisk = metric === "risk";
  const colourFor = (v: number) => (isRisk ? rampRisk(v / maxV) : rampVolume(Math.pow(v / maxV, 0.55)));

  const fmt = (v: number) => (metric === "value" ? compactKsh(v) : metric === "risk" ? `${Math.round(v)}/100` : compactNum(v));

  const centroidPos = (name: string, c: [number, number]) => {
    const box = wrap.current?.getBoundingClientRect();
    const rect = svg.current?.getBoundingClientRect();
    if (!box || !rect) return { name, x: c[0], y: c[1] };
    const scale = rect.width / W;
    return { name, x: rect.left - box.left + c[0] * scale, y: rect.top - box.top + c[1] * scale };
  };

  const move = (e: React.MouseEvent, name: string) => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ name, x: e.clientX - box.left, y: e.clientY - box.top });
  };

  const hoverDatum = hover ? byName.get(hover.name) : null;
  const hoverMeta = hover ? COUNTIES.find((c) => c.name === hover.name) : null;
  const hoverValue = hover ? Number(byName.get(hover.name)?.[metric] ?? 0) : 0;

  return (
    <div className="relative" ref={wrap}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="label-xs">
          choropleth · {METRIC_LABEL[metric]} · real ADM1 boundaries
        </span>
        <button
          type="button"
          onClick={() => setLabels((l) => !l)}
          className="rounded-[3px] border border-line bg-panel px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-fog transition-colors hover:border-signal/40 hover:text-signal"
        >
          {labels ? "hide labels" : "show labels"}
        </button>
      </div>

      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="mx-auto block h-auto w-full max-w-[560px] touch-manipulation select-none"
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Kenya county choropleth of ${METRIC_LABEL[metric]}`}
      >
        <defs>
          <filter id="kenyaGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <pattern id="kenyaHatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <line x1="0" y1="0" x2="0" y2="5" stroke="#0b1113" strokeWidth="1.6" strokeOpacity="0.5" />
          </pattern>
        </defs>

        {/* ocean / neighbouring territory backdrop */}
        <rect x={0} y={0} width={W} height={H} fill="#080d0f" />

        {paths.map((p, i) => {
          const v = values[i];
          const datum = byName.get(p.name);
          const isSel = selected === p.name;
          const isHover = hover?.name === p.name;
          const hasData = Boolean(datum && datum.count > 0);
          return (
            <g key={p.name}>
              <path
                d={p.d}
                fill={hasData ? colourFor(v) : "#101a1c"}
                stroke={isSel ? "#e8f0f1" : isHover ? "#5de29a" : "#0a1214"}
                strokeWidth={isSel ? 1.6 : isHover ? 1.3 : 0.6}
                strokeOpacity={isSel || isHover ? 1 : 0.85}
                className="cursor-pointer transition-[fill,stroke,stroke-width] duration-150"
                style={{ filter: isHover || isSel ? "brightness(1.22)" : undefined }}
                tabIndex={0}
                role="button"
                aria-label={`${p.name}: ${METRIC_LABEL[metric]} ${fmt(v)}`}
                onPointerDown={(e) => {
                  pointer.current = e.pointerType as "mouse" | "touch" | "pen";
                }}
                onMouseMove={(e) => move(e, p.name)}
                onMouseEnter={(e) => move(e, p.name)}
                onFocus={() => setHover(centroidPos(p.name, p.centroid))}
                onBlur={() => setHover(null)}
                onClick={() => {
                  const url = `/geo?metric=${metric}&county=${encodeURIComponent(p.name)}`;
                  // touch has no hover: first tap pins the dossier, second tap drills down
                  if (pointer.current !== "mouse") {
                    if (hover?.name === p.name) router.push(url);
                    else setHover(centroidPos(p.name, p.centroid));
                    return;
                  }
                  router.push(url);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(`/geo?metric=${metric}&county=${encodeURIComponent(p.name)}`);
                  }
                }}
              />
              {!hasData && <path d={p.d} fill="url(#kenyaHatch)" pointerEvents="none" />}
            </g>
          );
        })}

        {labels &&
          paths.map((p, i) => {
            const share = values[i] / total;
            if (share < 0.012) return null;
            const isHover = hover?.name === p.name;
            return (
              <text
                key={`lbl-${p.name}`}
                x={p.centroid[0]}
                y={p.centroid[1]}
                textAnchor="middle"
                pointerEvents="none"
                fontSize={share > 0.05 ? 8.6 : 7.2}
                fontFamily="var(--font-mono-plex), monospace"
                fontWeight={isHover ? 700 : 500}
                fill={values[i] / maxV > 0.55 ? "#04120c" : "#dff3e8"}
                stroke={values[i] / maxV > 0.55 ? "none" : "#04120c"}
                strokeWidth={values[i] / maxV > 0.55 ? 0 : 2.2}
                paintOrder="stroke"
                opacity={isHover ? 1 : 0.9}
              >
                {p.name.length > 12 ? p.name.slice(0, 11) + "…" : p.name}
              </text>
            );
          })}
      </svg>

      {/* legend */}
      <div className="mx-auto mt-3 flex max-w-[560px] items-center gap-3">
        <span className="label-xs shrink-0">low</span>
        <div
          className="h-2.5 flex-1 rounded-[2px] border border-line"
          style={{
            background: `linear-gradient(90deg, ${[0, 0.2, 0.4, 0.6, 0.8, 1]
              .map((t) => `${isRisk ? rampRisk(t) : rampVolume(Math.pow(t, 0.55))} ${t * 100}%`)
              .join(", ")})`,
          }}
        />
        <span className="label-xs shrink-0">{fmt(maxV)}</span>
      </div>

      {/* hover tooltip */}
      {hover && (
        <div
          className="pointer-events-none absolute z-20 w-[228px] rounded-[3px] border border-line-2 bg-ink-2/97 p-2.5 shadow-2xl shadow-black/70 backdrop-blur"
          style={{
            left: Math.min(Math.max(8, hover.x + 14), (wrap.current?.clientWidth ?? 400) - 236),
            top: Math.max(8, hover.y - 12),
          }}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[13px] font-semibold tracking-[0.02em] text-chalk">{hover.name}</span>
            <span className="num text-[9.5px] text-fog/70">#{String(hoverMeta?.code ?? "").padStart(2, "0")}</span>
          </div>
          <div className="label-xs mt-0.5">{hoverMeta?.region ?? ""}</div>
          <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2">
            <span className="label-xs">{METRIC_LABEL[metric]}</span>
            <span className="num text-[13px] font-medium" style={{ color: isRisk ? rampRisk(hoverValue / maxV) : "#5de29a" }}>
              {fmt(hoverValue)}
            </span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
            <span className="text-fog">share</span>
            <span className="num text-right text-chalk">{((hoverValue / total) * 100).toFixed(2)}%</span>
            <span className="text-fog">volume</span>
            <span className="num text-right text-chalk">{compactNum(hoverDatum?.count ?? 0)}</span>
            <span className="text-fog">value</span>
            <span className="num text-right text-chalk">{compactKsh(hoverDatum?.value ?? 0)}</span>
            <span className="text-fog">flag rate</span>
            <span className="num text-right" style={{ color: (hoverDatum?.fraudRate ?? 0) > 2 ? "#ff5a5f" : "#8fa3a8" }}>
              {(hoverDatum?.fraudRate ?? 0).toFixed(2)}%
            </span>
          </div>
          <div className="mt-2 border-t border-line pt-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-cyan/80">
            tap again to drill down
          </div>
        </div>
      )}

      <p className="mx-auto mt-3 max-w-[560px] text-center font-mono text-[9.5px] leading-relaxed text-fog/55">
        hatched counties carry no settled traffic in the current window · boundaries: geoBoundaries gbOpen KEN ADM1 (CC-BY 4.0)
      </p>
    </div>
  );
}
