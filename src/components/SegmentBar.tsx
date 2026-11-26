import type { SegmentInfo, Status } from "../lib/api";
import { useT } from "../i18n";

interface Props {
  segments: SegmentInfo[];
  total: number | null;
  downloaded: number;
  status: Status;
  height?: string;
}

const FILL: Record<Status, string> = {
  downloading: "bg-gradient-to-r from-brand to-brand-2",
  queued: "bg-slate-400",
  paused: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  canceled: "bg-slate-400",
};

/**
 * Progress bar showing each connection's byte range separately, so the
 * parallel download is visible: every segment fills from its own offset.
 */
export function SegmentBar({ segments, total, downloaded, status, height = "h-1.5" }: Props) {
  const fill = FILL[status];
  const running = status === "downloading";
  const multi = status !== "completed" && total && total > 0 && segments.length > 1;

  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-track ${height}`}>
      {multi ? (
        segments.map((s) => (
          <div
            key={s.start}
            className={`absolute top-0 h-full ${fill} ${running ? "progress-stripes" : ""} transition-[width] duration-300`}
            style={{ left: `${(s.start / total) * 100}%`, width: `${(s.done / total) * 100}%` }}
          />
        ))
      ) : total || status === "completed" ? (
        <div
          className={`h-full rounded-full ${fill} ${running ? "progress-stripes" : ""} transition-[width] duration-300`}
          style={{
            width: status === "completed" ? "100%" : `${Math.min(100, (downloaded / (total || 1)) * 100)}%`,
          }}
        />
      ) : running ? (
        // Unknown size: indeterminate.
        <div className={`absolute inset-y-0 w-1/3 rounded-full ${fill}`} style={{ animation: "indeterminate 1.2s ease-in-out infinite" }} />
      ) : null}
      {/* Separators between planned segments. */}
      {multi &&
        segments.slice(1).map((s) => (
          <div key={`sep-${s.start}`} className="absolute top-0 h-full w-px bg-card/80" style={{ left: `${(s.start / total) * 100}%` }} />
        ))}
    </div>
  );
}

/** Grid of per-connection mini bars for the details panel. */
export function SegmentMap({ segments, status }: { segments: SegmentInfo[]; status: Status }) {
  const t = useT();
  const fill = FILL[status];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {sorted.map((s, i) => {
        const len = s.end - s.start;
        const pct = len > 0 ? Math.min(100, (s.done / len) * 100) : 100;
        return (
          <div key={s.start} className="rounded-md bg-track/70 p-1.5" title={t("shell.segment", { n: i + 1, pct: pct.toFixed(0) })}>
            <div className="mb-1 flex justify-between text-[10px] tabular-nums text-mute">
              <span>#{i + 1}</span>
              <span>{pct.toFixed(0)}%</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-track">
              <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
