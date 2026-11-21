import { useId } from "react";

/** Area sparkline of recent values (e.g. total speed per second). */
export function Sparkline({ values, className = "" }: { values: number[]; className?: string }) {
  const id = useId();
  const w = 200;
  const h = 48;
  const max = Math.max(1, ...values);
  const n = Math.max(values.length, 2);
  const pts = values.map((v, i) => [(i / (n - 1)) * w, h - 3 - (v / max) * (h - 8)] as const);
  if (pts.length < 2) pts.unshift([0, h - 3], [w, h - 3]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${h} L${pts[0][0].toFixed(1)},${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2563eb" stopOpacity="0.28" />
          <stop offset="1" stopColor="#2563eb" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke="#2563eb" strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
