import type { ComponentType, SVGProps } from "react";
import type { AvailableUpdate, ConnectedExtension } from "../lib/api";
import {
  AppIcon,
  ArchiveIcon,
  CheckIcon,
  ClockIcon,
  DocIcon,
  DownloadIcon,
  ImageIcon,
  LayersIcon,
  MusicIcon,
  PlusIcon,
  PuzzleIcon,
  SettingsIcon,
  SparklesIcon,
  VideoIcon,
} from "./Icons";
import type { FileKind } from "../lib/format";

type IconT = ComponentType<SVGProps<SVGSVGElement>>;

export type StatusFilter = "all" | "active" | "unfinished" | "completed";
export type Filter = { kind: "status"; key: StatusFilter } | { kind: "type"; key: FileKind };

export const STATUS_FILTERS: { key: StatusFilter; label: string; icon: IconT }[] = [
  { key: "all", label: "Tất cả", icon: LayersIcon },
  { key: "active", label: "Đang tải", icon: DownloadIcon },
  { key: "unfinished", label: "Chưa xong", icon: ClockIcon },
  { key: "completed", label: "Hoàn tất", icon: CheckIcon },
];

export const TYPE_FILTERS: { key: FileKind; label: string; icon: IconT }[] = [
  { key: "video", label: "Video", icon: VideoIcon },
  { key: "audio", label: "Âm nhạc", icon: MusicIcon },
  { key: "archive", label: "Tệp nén", icon: ArchiveIcon },
  { key: "document", label: "Tài liệu", icon: DocIcon },
  { key: "program", label: "Chương trình", icon: AppIcon },
  { key: "image", label: "Hình ảnh", icon: ImageIcon },
];

interface Props {
  filter: Filter;
  onFilter: (f: Filter) => void;
  statusCounts: Record<StatusFilter, number>;
  typeCounts: Partial<Record<FileKind, number>>;
  extensions: ConnectedExtension[];
  bridgeRunning: boolean;
  onAdd: () => void;
  onSettings: () => void;
  onInstallExtension: () => void;
  version: string;
  update: AvailableUpdate | null;
  onChangelog: () => void;
}

function Item({ icon: Icon, label, count, active, onClick }: { icon: IconT; label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-[7px] text-left text-[13px] transition ${
        active ? "bg-card font-medium text-ink shadow-card" : "text-ink-2 hover:bg-ink/[0.045]"
      }`}
    >
      {active && <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand" />}
      <Icon className={`h-[17px] w-[17px] shrink-0 ${active ? "text-brand" : "text-mute group-hover:text-ink-2"}`} />
      <span className="flex-1 truncate">{label}</span>
      {count != null && count > 0 && (
        <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums ${active ? "bg-brand/10 text-brand" : "text-mute"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

export function Sidebar(p: Props) {
  const browsers = [...new Set(p.extensions.map((e) => e.browser))];
  const types = TYPE_FILTERS.filter((t) => (p.typeCounts[t.key] ?? 0) > 0);

  return (
    <aside className="flex w-[232px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-brand-2 text-white shadow-md shadow-brand/30">
          <DownloadIcon className="h-[18px] w-[18px]" strokeWidth={2.4} />
        </div>
        <div className="leading-tight">
          <div className="text-[14px] font-semibold tracking-tight">DownloadManager</div>
          <div className="text-[11px] text-mute">Tải đa luồng</div>
        </div>
      </div>

      <div className="px-3">
        <button className="btn-primary w-full py-2.5" onClick={p.onAdd}>
          <PlusIcon className="h-4 w-4" strokeWidth={2.4} /> Thêm liên kết
          <kbd className="ml-auto rounded bg-white/20 px-1.5 py-px font-sans text-[10px] font-medium">Ctrl N</kbd>
        </button>
      </div>

      <nav className="mt-4 flex-1 space-y-5 overflow-y-auto px-3 pb-3">
        <div className="space-y-0.5">
          {STATUS_FILTERS.map((f) => (
            <Item
              key={f.key}
              icon={f.icon}
              label={f.label}
              count={p.statusCounts[f.key]}
              active={p.filter.kind === "status" && p.filter.key === f.key}
              onClick={() => p.onFilter({ kind: "status", key: f.key })}
            />
          ))}
        </div>
        {types.length > 0 && (
          <div>
            <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider text-faint uppercase">Loại tệp</p>
            <div className="space-y-0.5">
              {types.map((f) => (
                <Item
                  key={f.key}
                  icon={f.icon}
                  label={f.label}
                  count={p.typeCounts[f.key]}
                  active={p.filter.kind === "type" && p.filter.key === f.key}
                  onClick={() => p.onFilter({ kind: "type", key: f.key })}
                />
              ))}
            </div>
          </div>
        )}
      </nav>

      <div className="space-y-2 border-t border-line p-3">
        {browsers.length === 0 ? (
          <button
            onClick={p.onInstallExtension}
            className="group w-full overflow-hidden rounded-xl bg-gradient-to-br from-brand to-brand-2 p-3.5 text-left text-white shadow-lg shadow-brand/25 transition hover:brightness-110"
          >
            <div className="flex items-center gap-2 text-[13px] font-semibold">
              <PuzzleIcon className="h-4 w-4" /> Kết nối trình duyệt
            </div>
            <p className="mt-1 text-[11.5px] leading-snug text-white/85">Tự bắt link tải từ Chrome, Edge, Cốc Cốc, Firefox…</p>
            <span className="mt-2.5 inline-flex items-center rounded-md bg-white/20 px-2 py-1 text-[11.5px] font-medium group-hover:bg-white/30">
              Cài extension →
            </span>
          </button>
        ) : (
          <button onClick={p.onInstallExtension} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-ink/[0.045]">
            <span className="relative flex h-2 w-2">
              {p.bridgeRunning && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${p.bridgeRunning ? "bg-emerald-500" : "bg-red-500"}`} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium text-ink-2">{p.bridgeRunning ? "Đã kết nối trình duyệt" : "Cầu nối đang tắt"}</span>
              <span className="block truncate text-[11px] text-mute">{browsers.join(", ")}</span>
            </span>
          </button>
        )}
        {p.update && (
          <button
            onClick={p.onChangelog}
            className="flex w-full items-center gap-2.5 rounded-lg border border-brand/30 bg-brand/8 px-3 py-2 text-left transition hover:bg-brand/12"
          >
            <SparklesIcon className="h-4 w-4 shrink-0 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-brand">Có bản mới v{p.update.version}</span>
              <span className="block text-[11px] text-mute">Bấm để cập nhật</span>
            </span>
          </button>
        )}
        <div className="flex items-center">
          <button onClick={p.onSettings} className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-[13px] text-ink-2 hover:bg-ink/[0.045]">
            <SettingsIcon className="h-[17px] w-[17px] text-mute" /> Cài đặt
          </button>
          <button
            onClick={p.onChangelog}
            title="Cập nhật & nhật ký thay đổi"
            className="relative rounded-md px-2 py-1 text-[11px] tabular-nums text-faint hover:bg-ink/[0.045] hover:text-ink-2"
          >
            {p.version ? `v${p.version}` : "…"}
            {p.update && <span className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-brand" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
