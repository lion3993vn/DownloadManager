import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { DownloadIcon, PanelLeftIcon } from "./Icons";
import { useT } from "../i18n";

/**
 * On Windows the window has no native frame (`tauri.windows.conf.json`), so the
 * app draws its own title bar. macOS and Linux keep the system one.
 */
export const CUSTOM_TITLEBAR = navigator.userAgent.includes("Windows");

/** Windows 11 caption glyphs: 10 px, 1 px strokes. */
const Glyph = ({ d }: { d: string }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
    <path d={d} shapeRendering="crispEdges" />
  </svg>
);
const MINIMIZE = "M0 5.5h10";
const MAXIMIZE = "M.5.5h9v9h-9z";
const RESTORE = "M2.5 2.5h7v7h-7zM2.5 2.5V.5h7v7h-2"; // two overlapping squares
const CLOSE = "M.5.5l9 9M9.5.5l-9 9";

interface Props {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function Titlebar({ sidebarCollapsed, onToggleSidebar }: Props) {
  const t = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const w = getCurrentWindow();
    const sync = () => w.isMaximized().then(setMaximized).catch(() => {});
    sync();
    const unlisten = w.onResized(sync);
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const win = getCurrentWindow();
  const caption = "flex h-full w-[46px] items-center justify-center text-ink-2 transition-colors";

  return (
    // Above modal backdrops (z-50) so the window can always be moved and closed.
    <div data-tauri-drag-region className="relative z-[60] flex h-9 shrink-0 items-center border-b border-line bg-panel select-none">
      <button
        onClick={onToggleSidebar}
        className="ml-1.5 flex h-7 w-8 items-center justify-center rounded-md text-mute transition hover:bg-ink/[0.07] hover:text-ink"
        title={`${t(sidebarCollapsed ? "shell.expandSidebar" : "shell.collapseSidebar")} (Ctrl B)`}
        aria-label={t(sidebarCollapsed ? "shell.expandSidebar" : "shell.collapseSidebar")}
      >
        <PanelLeftIcon className="h-[15px] w-[15px]" />
      </button>
      {/* Clicks fall through to the drag region. */}
      <div className="pointer-events-none flex items-center gap-2 pl-2">
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-gradient-to-br from-brand to-brand-2 text-white">
          <DownloadIcon className="h-[11px] w-[11px]" strokeWidth={2.8} />
        </span>
        <span className="text-[12px] font-medium text-ink-2">DownloadManager</span>
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex h-full">
        <button className={`${caption} hover:bg-ink/[0.07]`} onClick={() => win.minimize()} title={t("shell.minimize")} aria-label={t("shell.minimize")}>
          <Glyph d={MINIMIZE} />
        </button>
        <button
          className={`${caption} hover:bg-ink/[0.07]`}
          onClick={() => win.toggleMaximize()}
          title={t(maximized ? "shell.restore" : "shell.maximize")}
          aria-label={t(maximized ? "shell.restore" : "shell.maximize")}
        >
          <Glyph d={maximized ? RESTORE : MAXIMIZE} />
        </button>
        <button className={`${caption} hover:bg-[#c42b1c] hover:text-white`} onClick={() => win.close()} title={t("common.close")} aria-label={t("common.close")}>
          <Glyph d={CLOSE} />
        </button>
      </div>
    </div>
  );
}
