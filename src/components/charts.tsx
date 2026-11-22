// Small, dependency-free charts for the statistics page.
// Specs follow the dataviz guidance: thin marks (bars <= 24px, 4px rounded
// data end, square at the baseline), 2px lines with a ~10% area wash, hairline
// solid gridlines, text in text tokens (never the mark color), a hover tooltip
// on every mark, selective direct labels.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Width of an element, kept in sync with resizes. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  // Measure before paint (no empty first frame), then follow resizes.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.floor(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Clean axis ticks for byte values: 0 / 250 MB / 500 MB… */
export function byteTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const units = [1, 1024, 1024 ** 2, 1024 ** 3, 1024 ** 4];
  const unit = [...units].reverse().find((u) => max >= u) ?? 1;
  const raw = max / unit / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag * unit;
  const ticks = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(v);
  return ticks;
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // Keep the box inside the chart.
  const left = Math.min(Math.max(x, 70), Math.max(70, width - 70));
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border border-line bg-card px-2.5 py-1.5 text-[11.5px] whitespace-nowrap shadow-card"
      style={{ left }}
    >
      {children}
    </div>
  );
}

const AXIS_W = 58;
const X_LABEL_H = 20;

// ---------------------------------------------------------------------------
// Column chart (one value per day)
// ---------------------------------------------------------------------------

export interface Column {
  key: string;
  /** Axis label (may be empty to skip). */
  label: string;
  /** Tooltip heading. */
  title: string;
  value: number;
  /** Extra tooltip line. */
  detail?: string;
}

export function ColumnChart({ data, format, height = 200 }: { data: Column[]; format: (v: number) => string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = byteTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = Math.max(0, width - AXIS_W);
  const plotH = height - X_LABEL_H - 8;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2)); // 2px surface gap between neighbors
  const y = (v: number) => 8 + plotH - (v / top) * plotH;
  const maxIdx = max > 0 ? data.findIndex((d) => d.value === max) : -1;
  // Thin out x labels so they never collide (~56px each).
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 56))));

  return (
    <div ref={ref} className="relative" style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={AXIS_W - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-mute text-[10.5px] tabular-nums">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = AXIS_W + band * i + band / 2;
            const x = cx - barW / 2;
            const y0 = y(0);
            const h = y0 - y(d.value);
            const r = Math.min(4, barW / 2, h);
            const path = `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + barW - r} Q${x + barW},${y0 - h} ${x + barW},${y0 - h + r} V${y0} Z`;
            return (
              <g key={d.key}>
                {h > 0 && <path d={path} fill={hover === i ? "var(--chart-hover)" : "var(--chart)"} />}
                {i === maxIdx && hover == null && (
                  <text x={cx} y={y0 - h - 6} textAnchor="middle" className="fill-ink-2 text-[10.5px] font-medium tabular-nums">
                    {format(d.value)}
                  </text>
                )}
                {i % every === 0 && d.label && (
                  <text x={cx} y={height - 4} textAnchor="middle" className="fill-mute text-[10.5px]">
                    {d.label}
                  </text>
                )}
                {/* Hit target: the whole band, taller than the mark. */}
                <rect
                  x={AXIS_W + band * i}
                  y={0}
                  width={band}
                  height={height - X_LABEL_H}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.title}: ${format(d.value)}`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
          <line x1={AXIS_W} x2={width} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
        </svg>
      )}
      {hover != null && data[hover] && (
        <Tooltip x={AXIS_W + band * hover + band / 2} width={width}>
          <div className="font-semibold text-ink tabular-nums">{format(data[hover].value)}</div>
          <div className="text-mute">
            {data[hover].title}
            {data[hover].detail ? ` · ${data[hover].detail}` : ""}
          </div>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Area chart with a crosshair (live speed)
// ---------------------------------------------------------------------------

export function AreaChart({
  values,
  format,
  pointLabel,
  idle,
  height = 160,
}: {
  values: number[];
  format: (v: number) => string;
  pointLabel: (i: number) => string;
  /** Shown over a flat line (every value 0). */
  idle?: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(0, ...values);
  const ticks = byteTicks(max, 3);
  const top = ticks[ticks.length - 1] || 1;
  const plotW = Math.max(1, width - AXIS_W - 6);
  const plotH = height - 16;
  const n = Math.max(2, values.length);
  const x = (i: number) => AXIS_W + (i / (n - 1)) * plotW;
  const y = (v: number) => 8 + plotH - (v / top) * plotH;
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = values.length ? `${line} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : "";
  const last = values.length - 1;

  function onMove(e: React.PointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const i = Math.round(((e.clientX - rect.left - AXIS_W) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(last, i)));
  }

  return (
    <div ref={ref} className="relative" style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={AXIS_W - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-mute text-[10.5px] tabular-nums">
                {format(t)}
                {t > 0 ? "/s" : ""}
              </text>
            </g>
          ))}
          <path d={area} fill="var(--chart)" fillOpacity={0.1} />
          <path d={line} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover != null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={8} y2={y(0)} stroke="var(--line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
              <circle cx={x(hover)} cy={y(values[hover])} r={4} fill="var(--chart)" stroke="var(--card)" strokeWidth={2} />
            </>
          )}
          {hover == null && last >= 0 && (
            <>
              <circle cx={x(last)} cy={y(values[last])} r={4} fill="var(--chart)" stroke="var(--card)" strokeWidth={2} />
              <text x={x(last) - 8} y={y(values[last]) - 10} textAnchor="end" className="fill-ink-2 text-[10.5px] font-medium tabular-nums">
                {format(values[last])}/s
              </text>
            </>
          )}
        </svg>
      )}
      {max === 0 && idle && hover == null && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 pl-[58px] text-center text-[12.5px] text-mute">{idle}</p>
      )}
      {hover != null && (
        <Tooltip x={x(hover)} width={width}>
          <div className="font-semibold text-ink tabular-nums">{format(values[hover])}/s</div>
          <div className="text-mute">{pointLabel(hover)}</div>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bars (ranked categories)
// ---------------------------------------------------------------------------

export interface BarItem {
  key: string;
  label: string;
  icon?: ReactNode;
  value: number;
  /** Tooltip line under the value. */
  detail: string;
}

export function BarList({ items, format, empty }: { items: BarItem[]; format: (v: number) => string; empty: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-8 text-center text-[12.5px] text-mute">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li
          key={it.key}
          tabIndex={0}
          title={`${it.label}: ${format(it.value)} · ${it.detail}`}
          onPointerEnter={() => setHover(it.key)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(it.key)}
          onBlur={() => setHover(null)}
          className={`grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-1.5 outline-none ${hover === it.key ? "bg-ink/[0.04]" : ""}`}
        >
          <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-ink-2">
            {it.icon}
            <span className="truncate">{it.label}</span>
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="h-2.5 shrink-0 rounded-r-[4px]"
              style={{ width: `calc((100% - 5.5rem) * ${it.value / max})`, minWidth: 2, background: hover === it.key ? "var(--chart-hover)" : "var(--chart)" }}
            />
            <span className="shrink-0 text-[12px] font-medium whitespace-nowrap text-ink-2 tabular-nums">{format(it.value)}</span>
            {hover === it.key && <span className="truncate text-[11.5px] text-mute">{it.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
