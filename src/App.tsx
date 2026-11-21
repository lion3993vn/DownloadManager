import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { api, onCapture, onPairRequest, type BridgeStatus, type Capture, type PairRequest, type Settings, type Status } from "./lib/api";
import { fileKind, formatSpeed, type FileKind } from "./lib/format";
import { useDownloads, type Row } from "./lib/useDownloads";
import { AddDialog } from "./components/AddDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { DownloadTable } from "./components/DownloadTable";
import { Modal } from "./components/Modal";
import {
  AlertIcon,
  AppIcon,
  ArchiveIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DocIcon,
  DownloadIcon,
  FolderIcon,
  ListIcon,
  MusicIcon,
  OpenIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PuzzleIcon,
  SearchIcon,
  SettingsIcon,
  StopIcon,
  TrashIcon,
  VideoIcon,
} from "./components/Icons";

type IconT = ComponentType<SVGProps<SVGSVGElement>>;
type Filter =
  | { kind: "status"; key: "all" | "active" | "unfinished" | "completed" }
  | { kind: "type"; key: FileKind };

const STATUS_FILTERS: { key: "all" | "active" | "unfinished" | "completed"; label: string; icon: IconT; match: (s: Status) => boolean }[] = [
  { key: "all", label: "Tất cả", icon: ListIcon, match: () => true },
  { key: "active", label: "Đang tải", icon: DownloadIcon, match: (s) => s === "downloading" || s === "queued" },
  { key: "unfinished", label: "Chưa xong", icon: ClockIcon, match: (s) => s === "paused" || s === "failed" || s === "canceled" },
  { key: "completed", label: "Hoàn tất", icon: CheckIcon, match: (s) => s === "completed" },
];

const TYPE_FILTERS: { key: FileKind; label: string; icon: IconT }[] = [
  { key: "video", label: "Video", icon: VideoIcon },
  { key: "audio", label: "Âm nhạc", icon: MusicIcon },
  { key: "archive", label: "Tệp nén", icon: ArchiveIcon },
  { key: "document", label: "Tài liệu", icon: DocIcon },
  { key: "program", label: "Chương trình", icon: AppIcon },
];

function ToolButton({ icon: Icon, label, onClick, disabled, primary }: { icon: IconT; label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex flex-col items-center gap-0.5 rounded-md px-2.5 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        primary ? "text-accent hover:bg-blue-50 dark:hover:bg-blue-950" : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

function SideItem({ icon: Icon, label, count, active, onClick }: { icon: IconT; label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left ${
        active ? "bg-blue-100 font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200" : "text-slate-700 hover:bg-slate-200/60 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 opacity-80" />
      <span className="flex-1 truncate">{label}</span>
      {count != null && count > 0 && <span className="text-xs tabular-nums text-slate-500">{count}</span>}
    </button>
  );
}

export default function App() {
  const { rows, loaded } = useDownloads();
  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: "status", key: "all" });
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [pairs, setPairs] = useState<PairRequest[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<Row | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showError = useCallback((msg: string) => setToast(msg), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Settings, bridge status, and anything the browser sent before the UI was ready.
  useEffect(() => {
    api.getSettings().then(setSettings);
    const refreshBridge = () => api.bridgeStatus().then(setBridge);
    refreshBridge();
    const t = setInterval(refreshBridge, 5000);

    const pullCaptures = () => api.takeCaptures().then((c) => c.length && setCaptures((old) => [...old, ...c]));
    pullCaptures();
    api.pendingPairRequests().then(setPairs);
    const u1 = onCapture(pullCaptures);
    const u2 = onPairRequest((r) => setPairs((old) => (old.some((p) => p.id === r.id) ? old : [...old, r])));
    return () => {
      clearInterval(t);
      u1.then((f) => f());
      u2.then((f) => f());
    };
  }, []);

  const all = useMemo(() => [...rows.values()].sort((a, b) => b.id - a.id), [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (filter.kind === "status" && !STATUS_FILTERS.find((f) => f.key === filter.key)!.match(r.status)) return false;
      if (filter.kind === "type" && fileKind(r.fileName) !== filter.key) return false;
      return !q || r.fileName.toLowerCase().includes(q) || r.url.toLowerCase().includes(q);
    });
  }, [all, filter, query]);

  const sel = selected != null ? (rows.get(selected) ?? null) : null;
  const totalSpeed = all.reduce((sum, r) => sum + (r.status === "downloading" ? r.speed : 0), 0);
  const activeCount = all.filter((r) => r.status === "downloading").length;

  const run = (p: Promise<unknown>) => p.catch((e) => showError(String(e)));

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || showAdd || showSettings) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setShowAdd(true);
      } else if (e.key === "Delete" && sel) {
        setConfirmRemove(sel);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, showAdd, showSettings]);

  const canResume = sel && ["paused", "failed", "canceled"].includes(sel.status);
  const canPause = sel && ["downloading", "queued"].includes(sel.status);
  const canStop = sel && !["completed", "canceled"].includes(sel.status);

  const capture = captures[0];
  const pair = pairs[0];

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <header className="flex items-center gap-1 border-b border-slate-200 bg-white px-2 py-1 dark:border-slate-800 dark:bg-slate-900">
        <ToolButton icon={PlusIcon} label="Thêm URL" onClick={() => setShowAdd(true)} primary />
        <div className="mx-1 h-8 w-px bg-slate-200 dark:bg-slate-700" />
        <ToolButton icon={PlayIcon} label="Tiếp tục" disabled={!canResume} onClick={() => sel && run(api.resume(sel.id))} />
        <ToolButton icon={PauseIcon} label="Tạm dừng" disabled={!canPause} onClick={() => sel && run(api.pause(sel.id))} />
        <ToolButton icon={StopIcon} label="Hủy tải" disabled={!canStop} onClick={() => sel && run(api.cancel(sel.id))} />
        <ToolButton icon={TrashIcon} label="Xóa" disabled={!sel} onClick={() => sel && setConfirmRemove(sel)} />
        <div className="mx-1 h-8 w-px bg-slate-200 dark:bg-slate-700" />
        <ToolButton icon={OpenIcon} label="Mở tệp" disabled={sel?.status !== "completed"} onClick={() => sel && run(api.openFile(sel.id))} />
        <ToolButton icon={FolderIcon} label="Thư mục" disabled={!sel} onClick={() => sel && run(api.showInFolder(sel.id))} />
        <div className="mx-1 h-8 w-px bg-slate-200 dark:bg-slate-700" />
        <ToolButton icon={PlayIcon} label="Chạy hết" onClick={() => run(api.resumeAll())} />
        <ToolButton icon={PauseIcon} label="Dừng hết" onClick={() => run(api.pauseAll())} />
        <div className="flex-1" />
        <div className="relative mr-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="field w-52 pl-8" placeholder="Tìm kiếm…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <ToolButton icon={SettingsIcon} label="Cài đặt" onClick={() => setShowSettings(true)} />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="w-48 shrink-0 space-y-4 overflow-y-auto border-r border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="space-y-0.5">
            {STATUS_FILTERS.map((f) => (
              <SideItem
                key={f.key}
                icon={f.icon}
                label={f.label}
                count={all.filter((r) => f.match(r.status)).length}
                active={filter.kind === "status" && filter.key === f.key}
                onClick={() => setFilter({ kind: "status", key: f.key })}
              />
            ))}
          </div>
          <div>
            <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Loại tệp</p>
            <div className="space-y-0.5">
              {TYPE_FILTERS.map((f) => (
                <SideItem
                  key={f.key}
                  icon={f.icon}
                  label={f.label}
                  count={all.filter((r) => fileKind(r.fileName) === f.key).length}
                  active={filter.kind === "type" && filter.key === f.key}
                  onClick={() => setFilter({ kind: "type", key: f.key })}
                />
              ))}
            </div>
          </div>
        </nav>

        {/* List */}
        <main className="min-w-0 flex-1 overflow-auto" onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}>
          {loaded && (
            <DownloadTable
              rows={visible}
              selected={selected}
              onSelect={setSelected}
              onActivate={(r) =>
                r.status === "completed" ? run(api.openFile(r.id)) : ["paused", "failed", "canceled"].includes(r.status) ? run(api.resume(r.id)) : undefined
              }
              emptyHint={all.length === 0 ? "Chưa có tệp nào. Bấm “Thêm URL” (Ctrl+N) hoặc tải từ trình duyệt." : "Không có tệp nào khớp bộ lọc."}
            />
          )}
        </main>
      </div>

      {/* Status bar */}
      <footer className="flex items-center gap-4 border-t border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
        <span className="flex items-center gap-1.5" title={bridge?.error ?? undefined}>
          <PuzzleIcon />
          {bridge?.running ? (
            <span>Extension: sẵn sàng (cổng {bridge.port})</span>
          ) : (
            <span className="text-red-500">Extension: không hoạt động</span>
          )}
        </span>
        <div className="flex-1" />
        <span>{activeCount > 0 ? `Đang tải ${activeCount} tệp` : "Không có tệp đang tải"}</span>
        <span className="w-24 text-right font-medium tabular-nums text-slate-700 dark:text-slate-300">{formatSpeed(totalSpeed)}</span>
      </footer>

      {/* Dialogs */}
      {settings && showAdd && (
        <AddDialog
          defaultDir={settings.engine.downloadDir}
          defaultConnections={settings.engine.connections}
          onClose={() => setShowAdd(false)}
          onError={showError}
        />
      )}
      {settings && capture && !showAdd && (
        <AddDialog
          key={capture.id}
          capture={capture}
          defaultDir={settings.engine.downloadDir}
          defaultConnections={settings.engine.connections}
          onClose={() => setCaptures((c) => c.slice(1))}
          onError={showError}
        />
      )}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} onSaved={setSettings} onError={showError} />}
      {pair && (
        <Modal
          title="Kết nối extension trình duyệt?"
          onClose={() => {
            api.answerPairRequest(pair.id, false);
            setPairs((p) => p.slice(1));
          }}
          footer={
            <>
              <button
                className="btn-secondary"
                onClick={() => {
                  api.answerPairRequest(pair.id, false);
                  setPairs((p) => p.slice(1));
                }}
              >
                Từ chối
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  api.answerPairRequest(pair.id, true);
                  setPairs((p) => p.slice(1));
                }}
              >
                Cho phép
              </button>
            </>
          }
        >
          <p>
            Extension trên <b>{pair.browser || "trình duyệt"}</b> muốn chuyển các lượt tải sang DownloadManager.
          </p>
          <p className="mt-2 break-all font-mono text-xs text-slate-500">{pair.origin}</p>
          <p className="mt-3 text-xs text-slate-500">Chỉ cho phép nếu bạn vừa bấm “Kết nối” trong extension.</p>
        </Modal>
      )}
      {confirmRemove && (
        <RemoveDialog
          row={confirmRemove}
          onClose={() => setConfirmRemove(null)}
          onConfirm={(deleteFile) => {
            run(api.remove(confirmRemove.id, deleteFile));
            if (selected === confirmRemove.id) setSelected(null);
            setConfirmRemove(null);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-10 left-1/2 z-[60] flex max-w-lg -translate-x-1/2 items-start gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-white shadow-xl dark:bg-slate-700">
          <AlertIcon className="mt-0.5 shrink-0 text-amber-400" />
          <span className="break-words">{toast}</span>
          <button className="ml-2 opacity-60 hover:opacity-100" onClick={() => setToast(null)} aria-label="Đóng">
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}

function RemoveDialog({ row, onClose, onConfirm }: { row: Row; onClose: () => void; onConfirm: (deleteFile: boolean) => void }) {
  const [deleteFile, setDeleteFile] = useState(false);
  const done = row.status === "completed";
  let note: ReactNode = null;
  if (!done) note = <p className="mt-2 text-xs text-slate-500">Phần đã tải dở sẽ bị xóa.</p>;
  return (
    <Modal
      title="Xóa khỏi danh sách"
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>
            Hủy
          </button>
          <button className="btn-danger" onClick={() => onConfirm(deleteFile)}>
            Xóa
          </button>
        </>
      }
    >
      <p className="break-all">
        Xóa <b>{row.fileName}</b> khỏi danh sách?
      </p>
      {note}
      {done && (
        <label className="mt-3 flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4" checked={deleteFile} onChange={(e) => setDeleteFile(e.target.checked)} />
          Xóa cả tệp trên ổ đĩa
        </label>
      )}
    </Modal>
  );
}
