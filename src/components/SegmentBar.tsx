import type { SegmentInfo, Status } from "../lib/api";

interface Props {
  segments: SegmentInfo[];
  total: number | null;
  downloaded: number;
  status: Status;
}

const FILL: Record<Status, string> = {
  downloading: "bg-blue-500",
  queued: "bg-slate-400",
  paused: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  canceled: "bg-slate-400",
};

/**
 * Progress bar that shows each connection's segment separately, so the
 * parallel download is visible: every segment fills from its own start offset.
 */
export function SegmentBar({ segments, total, downloaded, status }: Props) {
  const fill = FILL[status];
  const showSegments = status !== "completed" && total && total > 0 && segments.length > 1;

  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      {showSegments ? (
        segments.map((s) => (
          <div
            key={s.start}
            className={`absolute top-0 h-full ${fill} border-r border-white/70 dark:border-slate-900/70`}
            style={{ left: `${(s.start / total) * 100}%`, width: `${(s.done / total) * 100}%` }}
          />
        ))
      ) : (
        <div
          className={`h-full ${fill} transition-[width] duration-200`}
          style={{
            width:
              status === "completed"
                ? "100%"
                : total
                  ? `${Math.min(100, (downloaded / total) * 100)}%`
                  : "0%",
          }}
        />
      )}
      {/* Unknown size while running: indeterminate shimmer. */}
      {!total && status === "downloading" && (
        <div className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-blue-500/60" />
      )}
    </div>
  );
}
