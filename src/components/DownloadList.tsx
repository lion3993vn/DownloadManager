import { errorText, formatBytes, formatEta, formatRelative, formatSpeed, hostOf, STATUS_LABEL, STATUS_PILL } from "../lib/format";
import type { Row } from "../lib/useDownloads";
import { FileTile } from "./FileTile";
import { SegmentBar } from "./SegmentBar";
import { FolderIcon, MoreIcon, OpenIcon, PauseIcon, PlayIcon, RetryIcon } from "./Icons";

export interface RowActions {
  pause: (r: Row) => void;
  resume: (r: Row) => void;
  open: (r: Row) => void;
  folder: (r: Row) => void;
  menu: (r: Row, x: number, y: number) => void;
}

interface Props {
  rows: Row[];
  selected: number | null;
  onSelect: (id: number) => void;
  actions: RowActions;
}

function PrimaryAction({ r, a }: { r: Row; a: RowActions }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  switch (r.status) {
    case "downloading":
    case "queued":
      return (
        <button className="icon-btn" title="Tạm dừng" onClick={(e) => (stop(e), a.pause(r))}>
          <PauseIcon />
        </button>
      );
    case "paused":
      return (
        <button className="icon-btn" title="Tiếp tục" onClick={(e) => (stop(e), a.resume(r))}>
          <PlayIcon />
        </button>
      );
    case "failed":
    case "canceled":
      return (
        <button className="icon-btn" title="Tải lại" onClick={(e) => (stop(e), a.resume(r))}>
          <RetryIcon />
        </button>
      );
    case "completed":
      return (
        <button className="icon-btn" title="Mở tệp" onClick={(e) => (stop(e), a.open(r))}>
          <OpenIcon />
        </button>
      );
  }
}

function Meta({ r }: { r: Row }) {
  const pct = r.totalSize ? Math.min(100, (r.downloaded / r.totalSize) * 100) : null;
  if (r.status === "completed") {
    return (
      <>
        <span className="shrink-0 whitespace-nowrap">{formatBytes(r.totalSize ?? r.downloaded)}</span>
        <Dot />
        <span className="truncate">{hostOf(r.url)}</span>
        <Dot />
        <span className="shrink-0 whitespace-nowrap">{formatRelative(r.completedAt)}</span>
      </>
    );
  }
  if (r.status === "failed" && r.error) {
    return <span className="truncate text-red-500">{errorText(r.error)}</span>;
  }
  if (r.downloaded === 0 && r.totalSize == null && (r.status === "paused" || r.status === "queued")) {
    return (
      <>
        <span className="shrink-0">Chưa bắt đầu</span>
        <Dot />
        <span className="truncate">{hostOf(r.url)}</span>
      </>
    );
  }
  return (
    <>
      <span className="shrink-0 whitespace-nowrap tabular-nums">
        {formatBytes(r.downloaded)} / {formatBytes(r.totalSize)}
        {pct != null && <span className="ml-1 font-medium text-ink-2">{pct.toFixed(pct < 10 ? 1 : 0)}%</span>}
      </span>
      <Dot />
      <span className="truncate">{hostOf(r.url)}</span>
      {r.status === "downloading" && (
        <>
          <Dot />
          <span className="shrink-0 whitespace-nowrap tabular-nums">{r.activeConnections} luồng</span>
        </>
      )}
    </>
  );
}

const Dot = () => <span className="shrink-0 text-faint">·</span>;

export function DownloadList({ rows, selected, onSelect, actions }: Props) {
  return (
    <ul className="space-y-1.5 px-5 pb-6">
      {rows.map((r) => {
        const isSel = r.id === selected;
        const running = r.status === "downloading";
        return (
          <li
            key={r.id}
            onMouseDown={(e) => e.button === 0 && onSelect(r.id)}
            onDoubleClick={() => (r.status === "completed" ? actions.open(r) : undefined)}
            onContextMenu={(e) => {
              e.preventDefault();
              onSelect(r.id);
              actions.menu(r, e.clientX, e.clientY);
            }}
            className={`group grid cursor-default grid-cols-[auto_1fr_auto] items-center gap-4 rounded-xl border px-4 py-3 transition ${
              isSel
                ? "border-brand/40 bg-card shadow-card ring-4 ring-brand/8"
                : "border-transparent bg-card/60 hover:border-line hover:bg-card hover:shadow-card"
            }`}
          >
            <FileTile name={r.fileName} />

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13.5px] font-medium text-ink" title={r.fileName}>
                  {r.fileName}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-px text-[10.5px] font-medium ${STATUS_PILL[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              {r.status !== "completed" && (
                <div className="mt-2">
                  <SegmentBar segments={r.liveSegments} total={r.totalSize} downloaded={r.downloaded} status={r.status} />
                </div>
              )}
              <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-mute">
                <Meta r={r} />
              </div>
            </div>

            <div className="flex items-center gap-3">
              {running && (
                <div className="w-[84px] text-right leading-tight whitespace-nowrap">
                  <div className="text-[13px] font-semibold tabular-nums text-ink">{formatSpeed(r.speed)}</div>
                  <div className="text-[11px] tabular-nums text-mute">{formatEta(r.etaSecs)}</div>
                </div>
              )}
              <div className={`flex items-center gap-0.5 transition ${isSel || running ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                <PrimaryAction r={r} a={actions} />
                <button
                  className="icon-btn"
                  title="Mở thư mục"
                  onClick={(e) => {
                    e.stopPropagation();
                    actions.folder(r);
                  }}
                >
                  <FolderIcon />
                </button>
                <button
                  className="icon-btn"
                  title="Thêm"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    actions.menu(r, rect.right, rect.bottom + 4);
                  }}
                >
                  <MoreIcon />
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
