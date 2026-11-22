import type { ComponentType, ReactNode, SVGProps } from "react";
import type { AvailableUpdate, ConnectedExtension } from "../lib/api";
import {
  AppIcon,
  ArchiveIcon,
  ChartIcon,
  CheckIcon,
  ClockIcon,
  DocIcon,
  DownloadIcon,
  ImageIcon,
  LayersIcon,
  MusicIcon,
  PanelLeftIcon,
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
export type View = "downloads" | "stats";

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
  view: View;
  onStats: () => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  statusCounts: Record<StatusFilter, number>;
  typeCounts: Partial<Record<FileKind, number>>;
  extensions: ConnectedExtension[];
  /** Connected extensions older than the one bundled with the app. */
  outdatedExtensions: ConnectedExtension[];
  bundledExtension: string | null;
  bridgeRunning: boolean;
  onAdd: () => void;
  onSettings: () => void;
  onInstallExtension: () => void;
  version: string;
  update: AvailableUpdate | null;
  onChangelog: () => void;
  /** Icon-only rail. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Show the logo + collapse button (when the title bar does not). */
  showBrand: boolean;
}

function Item({
  icon: Icon,
  label,
  count,
  active,
  collapsed,
  onClick,
}: {
  icon: IconT;
  label: string;
  count?: number;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const hasCount = count != null && count > 0;
  return (
    <button
      onClick={onClick}
      title={collapsed ? (hasCount ? `${label} (${count})` : label) : undefined}
      aria-label={collapsed ? label : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-lg py-[7px] text-left text-[13px] transition ${
        collapsed ? "justify-center px-0" : "px-3"
      } ${active ? "bg-card font-medium text-ink shadow-card" : "text-ink-2 hover:bg-ink/[0.045]"}`}
    >
      {active && <span className="absolute top-1/2 left-0 h-4 w-[3px] -translate-y-1/2 rounded-full bg-brand" />}
      <Icon className={`h-[17px] w-[17px] shrink-0 ${active ? "text-brand" : "text-mute group-hover:text-ink-2"}`} />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && hasCount && (
        <span className={`min-w-5 rounded-full px-1.5 text-center text-[11px] tabular-nums ${active ? "bg-brand/10 text-brand" : "text-mute"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

/** Bottom-area button: full row when expanded, a 40px icon when collapsed. */
function RailButton({ collapsed, title, icon, onClick, className = "", children }: { collapsed: boolean; title: string; icon: ReactNode; onClick: () => void; className?: string; children: ReactNode }) {
  if (collapsed) {
    return (
      <button onClick={onClick} title={title} aria-label={title} className={`relative mx-auto flex h-10 w-10 items-center justify-center rounded-lg transition ${className}`}>
        {icon}
      </button>
    );
  }
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition ${className}`}>
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

export function Sidebar(p: Props) {
  const browsers = [...new Set(p.extensions.map((e) => e.browser))];
  const types = TYPE_FILTERS.filter((t) => (p.typeCounts[t.key] ?? 0) > 0);
  const c = p.collapsed;
  const inList = p.view === "downloads";

  const bridgeDot = (
    <span className="relative flex h-2 w-2 shrink-0">
      {p.bridgeRunning && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${p.bridgeRunning ? "bg-emerald-500" : "bg-red-500"}`} />
    </span>
  );

  return (
    <aside
      className={`flex shrink-0 flex-col overflow-hidden border-r border-line bg-panel transition-[width] duration-200 ease-out ${c ? "w-[60px]" : "w-[232px]"}`}
    >
      {p.showBrand && (
        <div className={`flex items-center gap-2.5 pt-5 pb-4 ${c ? "justify-center px-0" : "px-5"}`}>
          {!c && (
            <>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-brand-2 text-white shadow-md shadow-brand/30">
                <DownloadIcon className="h-[18px] w-[18px]" strokeWidth={2.4} />
              </div>
              <div className="min-w-0 flex-1 leading-tight whitespace-nowrap">
                <div className="text-[14px] font-semibold tracking-tight">DownloadManager</div>
                <div className="text-[11px] text-mute">Tải đa luồng</div>
              </div>
            </>
          )}
          <button
            onClick={p.onToggleCollapsed}
            className="icon-btn h-7 w-7"
            title={c ? "Mở rộng thanh bên (Ctrl B)" : "Thu gọn thanh bên (Ctrl B)"}
            aria-label={c ? "Mở rộng thanh bên" : "Thu gọn thanh bên"}
          >
            <PanelLeftIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className={`${c ? "px-2.5" : "px-3"} ${p.showBrand ? "" : "pt-4"}`}>
        {c ? (
          <button className="btn-primary h-10 w-10 p-0" onClick={p.onAdd} title="Thêm liên kết (Ctrl N)" aria-label="Thêm liên kết">
            <PlusIcon className="h-[18px] w-[18px]" strokeWidth={2.4} />
          </button>
        ) : (
          <button className="btn-primary w-full py-2.5 whitespace-nowrap" onClick={p.onAdd}>
            <PlusIcon className="h-4 w-4" strokeWidth={2.4} /> Thêm liên kết
            <kbd className="ml-auto rounded bg-white/20 px-1.5 py-px font-sans text-[10px] font-medium">Ctrl N</kbd>
          </button>
        )}
      </div>

      <nav className={`mt-4 flex-1 space-y-5 overflow-x-hidden overflow-y-auto pb-3 ${c ? "px-2.5" : "px-3"}`}>
        <div className="space-y-0.5">
          {STATUS_FILTERS.map((f) => (
            <Item
              key={f.key}
              icon={f.icon}
              label={f.label}
              count={p.statusCounts[f.key]}
              collapsed={c}
              active={inList && p.filter.kind === "status" && p.filter.key === f.key}
              onClick={() => p.onFilter({ kind: "status", key: f.key })}
            />
          ))}
        </div>
        {types.length > 0 && (
          <div>
            {c ? (
              <div className="mx-2 mb-2 h-px bg-line" />
            ) : (
              <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider whitespace-nowrap text-faint uppercase">Loại tệp</p>
            )}
            <div className="space-y-0.5">
              {types.map((f) => (
                <Item
                  key={f.key}
                  icon={f.icon}
                  label={f.label}
                  count={p.typeCounts[f.key]}
                  collapsed={c}
                  active={inList && p.filter.kind === "type" && p.filter.key === f.key}
                  onClick={() => p.onFilter({ kind: "type", key: f.key })}
                />
              ))}
            </div>
          </div>
        )}
        <div>
          {c ? (
            <div className="mx-2 mb-2 h-px bg-line" />
          ) : (
            <p className="px-3 pb-1.5 text-[11px] font-semibold tracking-wider whitespace-nowrap text-faint uppercase">Tổng quan</p>
          )}
          <Item icon={ChartIcon} label="Thống kê" collapsed={c} active={p.view === "stats"} onClick={p.onStats} />
        </div>
      </nav>

      <div className={`space-y-2 border-t border-line ${c ? "px-2.5 py-3" : "p-3"}`}>
        {browsers.length === 0 ? (
          c ? (
            <RailButton collapsed title="Kết nối trình duyệt" icon={<PuzzleIcon className="h-[18px] w-[18px]" />} onClick={p.onInstallExtension} className="bg-gradient-to-br from-brand to-brand-2 text-white shadow-md shadow-brand/25 hover:brightness-110">
              {null}
            </RailButton>
          ) : (
            <button
              onClick={p.onInstallExtension}
              className="group w-full overflow-hidden rounded-xl bg-gradient-to-br from-brand to-brand-2 p-3.5 text-left text-white shadow-lg shadow-brand/25 transition hover:brightness-110"
            >
              <div className="flex items-center gap-2 text-[13px] font-semibold whitespace-nowrap">
                <PuzzleIcon className="h-4 w-4" /> Kết nối trình duyệt
              </div>
              <p className="mt-1 text-[11.5px] leading-snug text-white/85">Tự bắt link tải từ Chrome, Edge, Cốc Cốc, Firefox…</p>
              <span className="mt-2.5 inline-flex items-center rounded-md bg-white/20 px-2 py-1 text-[11.5px] font-medium group-hover:bg-white/30">
                Cài extension →
              </span>
            </button>
          )
        ) : (
          <RailButton
            collapsed={c}
            title={`${p.bridgeRunning ? "Đã kết nối trình duyệt" : "Cầu nối đang tắt"}: ${browsers.join(", ")}`}
            icon={bridgeDot}
            onClick={p.onInstallExtension}
            className="hover:bg-ink/[0.045]"
          >
            <span className="block truncate text-[12px] font-medium text-ink-2">{p.bridgeRunning ? "Đã kết nối trình duyệt" : "Cầu nối đang tắt"}</span>
            <span className="block truncate text-[11px] text-mute">{browsers.join(", ")}</span>
          </RailButton>
        )}
        {p.outdatedExtensions.length > 0 && (
          <RailButton
            collapsed={c}
            title={`Cập nhật extension: ${p.outdatedExtensions.map((e) => e.browser).join(", ")}`}
            icon={<PuzzleIcon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />}
            onClick={p.onInstallExtension}
            className="border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/15"
          >
            <span className="block truncate text-[12px] font-semibold text-amber-700 dark:text-amber-300">Cập nhật extension</span>
            <span className="block truncate text-[11px] text-mute">
              {p.outdatedExtensions.map((e) => e.browser).join(", ")} · bản mới v{p.bundledExtension}
            </span>
          </RailButton>
        )}
        {p.update && (
          <RailButton
            collapsed={c}
            title={`Có bản mới v${p.update.version}`}
            icon={<SparklesIcon className="h-4 w-4 shrink-0 text-brand" />}
            onClick={p.onChangelog}
            className="border border-brand/30 bg-brand/8 hover:bg-brand/12"
          >
            <span className="block truncate text-[12px] font-semibold text-brand">Có bản mới v{p.update.version}</span>
            <span className="block truncate text-[11px] text-mute">Bấm để cập nhật</span>
          </RailButton>
        )}
        {c ? (
          <RailButton collapsed title="Cài đặt" icon={<SettingsIcon className="h-[17px] w-[17px] text-mute" />} onClick={p.onSettings} className="hover:bg-ink/[0.045]">
            {null}
          </RailButton>
        ) : (
          <div className="flex items-center">
            <button onClick={p.onSettings} className="flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-[13px] whitespace-nowrap text-ink-2 hover:bg-ink/[0.045]">
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
        )}
      </div>
    </aside>
  );
}
