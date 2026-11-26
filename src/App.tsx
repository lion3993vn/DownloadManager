import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  onCapture,
  onExtensionConnected,
  onExtracted,
  onExtensionUpdated,
  onPairRequest,
  outdatedExtensions,
  type BridgeStatus,
  type Capture,
  type ConnectedExtension,
  type PairRequest,
  type Settings,
  type Status,
} from "./lib/api";
import { fileKind, type FileKind } from "./lib/format";
import { useTheme } from "./lib/theme";
import { useDownloads, type Row } from "./lib/useDownloads";
import { useUpdater } from "./lib/useUpdater";
import { normalizePref, setLanguagePref, t as tr, useT } from "./i18n";
import { ChangelogDialog } from "./components/ChangelogDialog";
import { AddDialog } from "./components/AddDialog";
import { ContextMenu, type MenuItem } from "./components/ContextMenu";
import { DetailsPanel } from "./components/DetailsPanel";
import { DownloadList, type RowActions } from "./components/DownloadList";
import { ExtensionWizard } from "./components/ExtensionWizard";
import { Modal } from "./components/Modal";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar, STATUS_FILTERS, TYPE_FILTERS, type Filter, type StatusFilter, type View } from "./components/Sidebar";
import { StatsPage } from "./components/StatsPage";
import { CUSTOM_TITLEBAR, Titlebar } from "./components/Titlebar";
import { StatsBar } from "./components/StatsBar";
import { Toasts, useToasts } from "./components/Toasts";
import { WhenDoneCountdown, WhenDoneMenu } from "./components/WhenDone";
import {
  CopyIcon,
  DownloadIcon,
  FolderIcon,
  LinkIcon,
  OpenIcon,
  PauseIcon,
  PlayIcon,
  PuzzleIcon,
  RetryIcon,
  SearchIcon,
  StopIcon,
  TrashIcon,
} from "./components/Icons";

const MATCH: Record<StatusFilter, (s: Status) => boolean> = {
  all: () => true,
  active: (s) => s === "downloading" || s === "queued",
  unfinished: (s) => s === "paused" || s === "failed" || s === "canceled",
  completed: (s) => s === "completed",
};

const ONBOARDED_KEY = "dm.onboarded";
const SIDEBAR_KEY = "dm.sidebarCollapsed";

export default function App() {
  const { rows, loaded } = useDownloads();
  const [theme, setTheme] = useTheme();
  const { toasts, push, dismiss } = useToasts();
  const t = useT();

  const [selected, setSelected] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: "status", key: "all" });
  const [view, setView] = useState<View>("downloads");
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });
  }, []);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [extensions, setExtensions] = useState<ConnectedExtension[]>([]);
  // Version of the extension bundled with the app; older connected ones get flagged.
  const [bundledExt, setBundledExt] = useState<string | null>(null);
  const bundledExtRef = useRef<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [pairs, setPairs] = useState<PairRequest[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<Row | null>(null);
  const [menu, setMenu] = useState<{ row: Row; x: number; y: number } | null>(null);
  const [history, setHistory] = useState<number[]>(() => Array(60).fill(0));

  const [showChangelog, setShowChangelog] = useState(false);
  const updater = useUpdater((u) =>
    push({
      kind: "info",
      title: tr("app.updateAvailable", { version: u.version }),
      body: tr("app.updateAvailableBody"),
      action: { label: tr("app.viewAndUpdate"), run: () => setShowChangelog(true) },
    }),
  );
  const availableUpdate = updater.state.kind === "available" ? updater.state.update : null;

  const showError = useCallback((msg: string) => push({ kind: "error", title: tr("app.errorTitle"), body: msg }), [push]);
  const run = useCallback((p: Promise<unknown>) => p.catch((e) => showError(String(e))), [showError]);

  // Initial data + backend events.
  useEffect(() => {
    api.getSettings().then((s) => {
      setLanguagePref(normalizePref(s.app.language));
      setSettings(s);
    });
    const refreshBridge = () => api.bridgeStatus().then(setBridge);
    refreshBridge();
    const t = setInterval(refreshBridge, 5000);

    const pullCaptures = () => api.takeCaptures().then((c) => c.length && setCaptures((old) => [...old, ...c]));
    pullCaptures();
    api.pendingPairRequests().then(setPairs);
    Promise.all([api.connectedExtensions(), api.extensionVersion().catch(() => null)]).then(([list, bundled]) => {
      setExtensions(list);
      bundledExtRef.current = bundled;
      setBundledExt(bundled);
      const old = outdatedExtensions(list, bundled);
      if (old.length) {
        push({
          kind: "info",
          title: tr("app.extUpdating", { browsers: old.map((e) => e.browser).join(", ") }),
          body: tr("app.extUpdatingBody", { version: bundled ?? "" }),
          action: { label: tr("app.details"), run: () => setShowWizard(true) },
        });
      }
      let onboarded = false;
      try {
        onboarded = localStorage.getItem(ONBOARDED_KEY) === "1";
        localStorage.setItem(ONBOARDED_KEY, "1");
      } catch {
        /* ignore */
      }
      if (!onboarded && list.length === 0) setShowWizard(true);
    });

    const subs = [
      onCapture(pullCaptures),
      onPairRequest((r) => setPairs((old) => (old.some((p) => p.id === r.id) ? old : [...old, r]))),
      onExtensionConnected((e) => {
        setExtensions((old) => [...old.filter((x) => x.origin !== e.origin), e]);
        if (outdatedExtensions([e], bundledExtRef.current).length) {
          push({
            kind: "info",
            title: tr("app.extConnectedUpdating", { browser: e.browser }),
            body: tr("app.extConnectedUpdatingBody", { from: e.version ? `v${e.version}` : tr("app.oldVersion"), to: bundledExtRef.current ?? "" }),
            action: { label: tr("app.details"), run: () => setShowWizard(true) },
          });
        } else {
          push({ kind: "success", title: tr("app.extConnected", { browser: e.browser }), body: tr("app.extConnectedBody") });
        }
      }),
      onExtensionUpdated((e) => {
        setExtensions((old) => [...old.filter((x) => x.origin !== e.origin), e]);
        if (!outdatedExtensions([e], bundledExtRef.current).length) {
          push({ kind: "success", title: tr("app.extUpdated", { browser: e.browser }), body: tr("app.extUpdatedBody", { version: e.version ?? "" }) });
        }
      }),
      // A finished .zip was unpacked (setting "Unpack .zip files").
      onExtracted((x) => {
        const dir = x.dir;
        if (dir) {
          push({
            kind: "success",
            title: tr("finish.extracted"),
            body: x.fileName,
            action: { label: tr("finish.openFolder"), run: () => api.openFolder(dir).catch((e) => showError(String(e))) },
          });
        } else {
          push({ kind: "error", title: tr("finish.extractFailed", { name: x.fileName }), body: x.error ?? undefined });
        }
      }),
    ];
    return () => {
      clearInterval(t);
      subs.forEach((u) => u.then((f) => f()));
    };
  }, [push, showError]);

  const all = useMemo(() => [...rows.values()].sort((a, b) => b.id - a.id), [rows]);
  const totalSpeed = all.reduce((sum, r) => sum + (r.status === "downloading" ? r.speed : 0), 0);

  // Speed history for the sparkline (1 sample / second).
  const speedRef = useRef(0);
  speedRef.current = totalSpeed;
  useEffect(() => {
    const t = setInterval(() => setHistory((h) => [...h.slice(1), speedRef.current]), 1000);
    return () => clearInterval(t);
  }, []);

  // Notify when downloads finish or fail.
  const prevStatus = useRef(new Map<number, Status>());
  useEffect(() => {
    const prev = prevStatus.current;
    for (const r of all) {
      const before = prev.get(r.id);
      if (before && before !== r.status) {
        if (r.status === "completed") {
          push({ kind: "success", title: tr("app.downloadDone"), body: r.fileName, action: { label: tr("app.openFile"), run: () => run(api.openFile(r.id)) } });
        } else if (r.status === "failed") {
          push({ kind: "error", title: tr("app.failed", { name: r.fileName }), body: r.error ?? undefined });
        }
      }
      prev.set(r.id, r.status);
    }
  }, [all, push, run]);

  const statusCounts = useMemo(() => {
    const c = { all: 0, active: 0, unfinished: 0, completed: 0 } as Record<StatusFilter, number>;
    for (const r of all) for (const f of STATUS_FILTERS) if (MATCH[f.key](r.status)) c[f.key]++;
    return c;
  }, [all]);

  const typeCounts = useMemo(() => {
    const c: Partial<Record<FileKind, number>> = {};
    for (const r of all) {
      const k = fileKind(r.fileName);
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [all]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((r) => {
      if (filter.kind === "status" && !MATCH[filter.key](r.status)) return false;
      if (filter.kind === "type" && fileKind(r.fileName) !== filter.key) return false;
      return !q || r.fileName.toLowerCase().includes(q) || r.url.toLowerCase().includes(q);
    });
  }, [all, filter, query]);

  const sel = selected != null ? (rows.get(selected) ?? null) : null;

  const actions: RowActions = {
    pause: (r) => run(api.pause(r.id)),
    resume: (r) => run(api.resume(r.id)),
    open: (r) => run(api.openFile(r.id)),
    folder: (r) => run(api.showInFolder(r.id)),
    menu: (r, x, y) => setMenu({ row: r, x, y }),
  };

  function menuItems(r: Row): MenuItem[] {
    const items: MenuItem[] = [];
    if (r.status === "completed") items.push({ label: t("app.openFile"), icon: <OpenIcon />, onClick: () => actions.open(r) });
    if (r.status === "downloading" || r.status === "queued") items.push({ label: t("app.pause"), icon: <PauseIcon />, onClick: () => actions.pause(r) });
    if (r.status === "paused") items.push({ label: t("app.resume"), icon: <PlayIcon />, onClick: () => actions.resume(r) });
    if (r.status === "failed" || r.status === "canceled") items.push({ label: t("app.redownload"), icon: <RetryIcon />, onClick: () => actions.resume(r) });
    items.push({ label: t("app.openFolder"), icon: <FolderIcon />, onClick: () => actions.folder(r) });
    items.push({ label: t("app.copyLink"), icon: <CopyIcon />, onClick: () => navigator.clipboard.writeText(r.url) });
    if (r.status !== "completed" && r.status !== "canceled")
      items.push({ label: t("app.cancelDownload"), icon: <StopIcon />, onClick: () => run(api.cancel(r.id)), separatorBefore: true });
    items.push({ label: t("app.remove"), icon: <TrashIcon />, danger: true, onClick: () => setConfirmRemove(r), separatorBefore: r.status === "completed" || r.status === "canceled" });
    return items;
  }

  // Keyboard shortcuts.
  const modalOpen = showAdd || showSettings || showWizard || showChangelog || captures.length > 0 || pairs.length > 0 || confirmRemove != null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modalOpen) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setShowAdd(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setView("downloads");
        setTimeout(() => document.getElementById("search")?.focus());
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (!typing && e.key === "Delete" && sel) {
        setConfirmRemove(sel);
      } else if (!typing && e.key === " " && sel) {
        e.preventDefault();
        if (sel.status === "downloading" || sel.status === "queued") actions.pause(sel);
        else if (sel.status !== "completed") actions.resume(sel);
      } else if (e.key === "Escape" && !typing) {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const title = t(filter.kind === "status" ? STATUS_FILTERS.find((f) => f.key === filter.key)!.label : TYPE_FILTERS.find((f) => f.key === filter.key)!.label);
  const hasActive = all.some((r) => r.status === "downloading" || r.status === "queued");
  const hasPaused = all.some((r) => r.status === "paused");
  const outdated = useMemo(() => outdatedExtensions(extensions, bundledExt), [extensions, bundledExt]);
  const capture = captures[0];
  const pair = pairs[0];

  return (
    <div className="flex h-full flex-col">
      {CUSTOM_TITLEBAR && <Titlebar sidebarCollapsed={collapsed} onToggleSidebar={toggleSidebar} />}
      <div className="flex min-h-0 flex-1">
        <Sidebar
          view={view}
          onStats={() => {
            setView("stats");
            setSelected(null);
          }}
          collapsed={collapsed}
          onToggleCollapsed={toggleSidebar}
          showBrand={!CUSTOM_TITLEBAR}
          filter={filter}
          onFilter={(f) => {
            setFilter(f);
            setView("downloads");
            setSelected(null);
          }}
          statusCounts={statusCounts}
          typeCounts={typeCounts}
          extensions={extensions}
          outdatedExtensions={outdated}
          bundledExtension={bundledExt}
          bridgeRunning={bridge?.running ?? false}
          onAdd={() => setShowAdd(true)}
          onSettings={() => setShowSettings(true)}
          onInstallExtension={() => setShowWizard(true)}
          version={updater.version}
          update={availableUpdate}
          onChangelog={() => setShowChangelog(true)}
        />

        <main className="@container flex min-w-0 flex-1 flex-col">
          {view === "stats" ? (
            <StatsPage rows={all} speedHistory={history} />
          ) : (
            <>
              <header className="flex items-center gap-3 px-5 pt-5 pb-4">
                <div className="min-w-0 flex-1">
                  <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
                  <p className="text-[12px] text-mute">{t("app.fileCount", { n: visible.length })}</p>
                </div>
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
                  <input id="search" className="field w-44 rounded-full py-1.5 pl-9 @[820px]:w-64" placeholder={t("app.searchPlaceholder")} value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <button className="btn-outline" disabled={!hasPaused} onClick={() => run(api.resumeAll())} title={t("app.resumeAll")}>
                  <PlayIcon /> <span className="hidden @[700px]:inline">{t("app.resumeAllShort")}</span>
                </button>
                <button className="btn-outline" disabled={!hasActive} onClick={() => run(api.pauseAll())} title={t("app.pauseAll")}>
                  <PauseIcon /> <span className="hidden @[700px]:inline">{t("app.pauseAllShort")}</span>
                </button>
                <WhenDoneMenu onError={showError} />
              </header>

              <StatsBar
                speed={totalSpeed}
                history={history}
                active={all.filter((r) => r.status === "downloading").length}
                queued={all.filter((r) => r.status === "queued").length}
                completed={statusCounts.completed}
                totalBytes={all.reduce((s, r) => s + (r.status === "completed" ? (r.totalSize ?? r.downloaded) : 0), 0)}
              />

              <div className="min-h-0 flex-1 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && setSelected(null)}>
                {loaded && visible.length > 0 && <DownloadList rows={visible} selected={selected} onSelect={setSelected} actions={actions} />}
                {loaded && visible.length === 0 && (
                  <EmptyState
                    filtered={all.length > 0}
                    hasExtension={extensions.length > 0}
                    onAdd={() => setShowAdd(true)}
                    onExtension={() => setShowWizard(true)}
                  />
                )}
              </div>
            </>
          )}
        </main>

        {view === "downloads" && sel && (
          <DetailsPanel
            key={sel.id}
            row={sel}
            onClose={() => setSelected(null)}
            onPause={() => actions.pause(sel)}
            onResume={() => actions.resume(sel)}
            onCancel={() => run(api.cancel(sel.id))}
            onRemove={() => setConfirmRemove(sel)}
            onOpen={() => actions.open(sel)}
            onFolder={() => actions.folder(sel)}
          />
        )}
      </div>

      {/* Overlays */}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.row)} onClose={() => setMenu(null)} />}

      {settings && showAdd && (
        <AddDialog
          defaultDir={settings.engine.downloadDir}
          defaultConnections={settings.engine.connections}
          onClose={() => setShowAdd(false)}
          onAdded={(name, started) => push({ kind: "info", title: t(started ? "app.started" : "app.addedToList"), body: name })}
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
          onAdded={(name, started) => push({ kind: "info", title: t(started ? "app.started" : "app.addedToList"), body: name })}
          onError={showError}
        />
      )}
      {showSettings && (
        <SettingsDialog
          theme={theme}
          onTheme={setTheme}
          onClose={() => setShowSettings(false)}
          onSaved={(s) => {
            setSettings(s);
            push({ kind: "success", title: t("app.settingsSaved") });
          }}
          onError={showError}
          onInstallExtension={() => setShowWizard(true)}
          onTokenRegenerated={() => setExtensions([])}
          version={updater.version}
          onChangelog={() => setShowChangelog(true)}
        />
      )}
      {showChangelog && <ChangelogDialog updater={updater} onClose={() => setShowChangelog(false)} onError={showError} />}
      {showWizard && <ExtensionWizard connected={extensions} bundledVersion={bundledExt} onClose={() => setShowWizard(false)} onError={showError} />}
      {pair && (
        <PairDialog
          pair={pair}
          onAnswer={(approve) => {
            api.answerPairRequest(pair.id, approve);
            setPairs((p) => p.slice(1));
          }}
        />
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
      <WhenDoneCountdown onError={showError} />
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

function EmptyState({ filtered, hasExtension, onAdd, onExtension }: { filtered: boolean; hasExtension: boolean; onAdd: () => void; onExtension: () => void }) {
  const t = useT();
  if (filtered) {
    return (
      <div className="flex h-full flex-col items-center justify-center pb-16 text-center text-mute">
        <SearchIcon className="h-8 w-8 text-faint" />
        <p className="mt-3 text-[13px]">{t("app.noMatch")}</p>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 pb-16 text-center">
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-brand/20 blur-2xl" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-brand to-brand-2 text-white shadow-xl shadow-brand/30">
          <DownloadIcon className="h-10 w-10" strokeWidth={2.2} />
        </div>
      </div>
      <h2 className="mt-6 text-[18px] font-semibold tracking-tight">{t("app.emptyTitle")}</h2>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-mute">
        {t("app.emptyBody")}
      </p>
      <div className="mt-6 flex gap-2.5">
        <button className="btn-primary px-4 py-2.5" onClick={onAdd}>
          <LinkIcon /> {t("app.addLink")}
        </button>
        {!hasExtension && (
          <button className="btn-outline px-4 py-2.5" onClick={onExtension}>
            <PuzzleIcon /> {t("app.connectBrowser")}
          </button>
        )}
      </div>
    </div>
  );
}

function PairDialog({ pair, onAnswer }: { pair: PairRequest; onAnswer: (approve: boolean) => void }) {
  const t = useT();
  return (
    <Modal
      title={t("app.pairTitle")}
      subtitle={t("app.pairFrom", { browser: pair.browser || t("app.pairBrowserFallback") })}
      icon={<PuzzleIcon />}
      width="max-w-md"
      onClose={() => onAnswer(false)}
      footer={
        <>
          <button className="btn-ghost" onClick={() => onAnswer(false)}>
            {t("app.deny")}
          </button>
          <button className="btn-primary" onClick={() => onAnswer(true)}>
            {t("app.allow")}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-ink-2">{t("app.pairBody")}</p>
      <p className="mt-3 rounded-lg bg-panel px-3 py-2 font-mono text-[11px] break-all text-mute">{pair.origin}</p>
      <p className="mt-3 text-[12px] text-mute">{t("app.pairHint")}</p>
    </Modal>
  );
}

function RemoveDialog({ row, onClose, onConfirm }: { row: Row; onClose: () => void; onConfirm: (deleteFile: boolean) => void }) {
  const t = useT();
  const [deleteFile, setDeleteFile] = useState(false);
  const done = row.status === "completed";
  return (
    <Modal
      title={t("app.removeTitle")}
      icon={<TrashIcon />}
      danger
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn-danger" onClick={() => onConfirm(deleteFile)}>
            {t("app.removeConfirm")}
          </button>
        </>
      }
    >
      <p className="text-[13px] break-all text-ink-2">
        <b className="text-ink">{row.fileName}</b>
      </p>
      {!done && <p className="mt-2 text-[12.5px] text-mute">{t("app.removePartial")}</p>}
      {done && (
        <label className="mt-4 flex cursor-pointer items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 text-[13px]">
          <input type="checkbox" className="h-4 w-4 accent-red-600" checked={deleteFile} onChange={(e) => setDeleteFile(e.target.checked)} />
          {t("app.removeFileToo")}
        </label>
      )}
    </Modal>
  );
}
