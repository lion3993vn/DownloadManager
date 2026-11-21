import type { ComponentType, SVGProps } from "react";
import type { Status } from "../lib/api";
import { fileKind, formatBytes, formatDate, formatEta, formatSpeed, type FileKind } from "../lib/format";
import type { Row } from "../lib/useDownloads";
import { SegmentBar } from "./SegmentBar";
import { AppIcon, ArchiveIcon, DocIcon, DownloadIcon, FileIcon, ImageIcon, MusicIcon, VideoIcon } from "./Icons";

const KIND_ICON: Record<FileKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  video: VideoIcon,
  audio: MusicIcon,
  archive: ArchiveIcon,
  document: DocIcon,
  program: AppIcon,
  image: ImageIcon,
  other: FileIcon,
};

export const STATUS_LABEL: Record<Status, string> = {
  queued: "Đang chờ",
  downloading: "Đang tải",
  paused: "Tạm dừng",
  completed: "Hoàn tất",
  failed: "Lỗi",
  canceled: "Đã hủy",
};

const STATUS_COLOR: Record<Status, string> = {
  queued: "text-slate-500",
  downloading: "text-blue-600 dark:text-blue-400",
  paused: "text-amber-600",
  completed: "text-emerald-600",
  failed: "text-red-600",
  canceled: "text-slate-500",
};

interface Props {
  rows: Row[];
  selected: number | null;
  onSelect: (id: number) => void;
  onActivate: (row: Row) => void;
  emptyHint: string;
}

export function DownloadTable({ rows, selected, onSelect, onActivate, emptyHint }: Props) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
        <DownloadIcon className="h-10 w-10" />
        <p>{emptyHint}</p>
      </div>
    );
  }

  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-500 dark:bg-slate-800/95">
        <tr className="border-b border-slate-200 dark:border-slate-700">
          <th className="px-3 py-2 font-medium">Tên tệp</th>
          <th className="w-24 px-2 py-2 text-right font-medium">Kích thước</th>
          <th className="w-56 px-2 py-2 font-medium">Tiến độ</th>
          <th className="w-24 px-2 py-2 text-right font-medium">Tốc độ</th>
          <th className="w-20 px-2 py-2 text-right font-medium">Còn lại</th>
          <th className="w-24 px-3 py-2 font-medium">Trạng thái</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const Icon = KIND_ICON[fileKind(r.fileName)];
          const pct = r.totalSize ? Math.min(100, (r.downloaded / r.totalSize) * 100) : null;
          const isSel = r.id === selected;
          return (
            <tr
              key={r.id}
              onMouseDown={() => onSelect(r.id)}
              onDoubleClick={() => onActivate(r)}
              className={`cursor-default border-b border-slate-100 dark:border-slate-800 ${
                isSel ? "bg-blue-50 dark:bg-blue-950/50" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
              }`}
            >
              <td className="px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <Icon className="h-5 w-5 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <div className="truncate font-medium" title={r.fileName}>
                      {r.fileName}
                    </div>
                    <div className="truncate text-[11px] text-slate-400" title={r.url}>
                      {r.error ? <span className="text-red-500">{r.error}</span> : r.url}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">
                {formatBytes(r.totalSize)}
              </td>
              <td className="px-2 py-2">
                <SegmentBar segments={r.liveSegments} total={r.totalSize} downloaded={r.downloaded} status={r.status} />
                <div className="mt-1 flex justify-between text-[11px] tabular-nums text-slate-500">
                  <span>
                    {r.status === "completed"
                      ? formatDate(r.completedAt)
                      : `${formatBytes(r.downloaded)}${pct != null ? ` · ${pct.toFixed(1)}%` : ""}`}
                  </span>
                  {r.status === "downloading" && (
                    <span title="Kết nối đang hoạt động">
                      {r.activeConnections}/{r.resumable ? r.connections : 1} luồng
                    </span>
                  )}
                </div>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{r.status === "downloading" ? formatSpeed(r.speed) : "—"}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-600 dark:text-slate-400">
                {r.status === "downloading" ? formatEta(r.etaSecs) : "—"}
              </td>
              <td className={`px-3 py-2 text-xs font-medium ${STATUS_COLOR[r.status]}`}>{STATUS_LABEL[r.status]}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
