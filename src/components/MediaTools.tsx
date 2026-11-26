import { useEffect, useState } from "react";
import { api, onToolsProgress, type ToolsProgress, type ToolsStatus } from "../lib/api";
import { formatBytes } from "../lib/format";
import { useT, type MessageKey } from "../i18n";
import { DownloadIcon, RefreshIcon, TrashIcon, VideoIcon } from "./Icons";

const STEP_LABEL: Record<ToolsProgress["step"], MessageKey> = {
  "yt-dlp": "media.step.ytdlp",
  ffmpeg: "media.step.ffmpeg",
  extract: "media.step.extract",
  update: "media.step.update",
};

/** Install / update yt-dlp + ffmpeg with live progress. */
export function useMediaTools(onError: (msg: string) => void) {
  const [status, setStatus] = useState<ToolsStatus | null>(null);
  const [progress, setProgress] = useState<ToolsProgress | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.mediaToolsStatus().then((s) => {
      setStatus(s);
      setBusy(s.busy);
    });
    const un = onToolsProgress(setProgress);
    return () => {
      un.then((f) => f());
    };
  }, []);

  async function run(action: () => Promise<ToolsStatus>) {
    setBusy(true);
    setProgress(null);
    try {
      const s = await action();
      setStatus(s);
      return true;
    } catch (e) {
      onError(String(e));
      return false;
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return {
    status,
    busy,
    progress,
    install: () => run(api.installMediaTools),
    update: () => run(api.updateMediaTools),
    remove: async () => {
      try {
        await api.removeMediaTools();
        setStatus(await api.mediaToolsStatus());
      } catch (e) {
        onError(String(e));
      }
    },
  };
}

function ProgressLine({ progress }: { progress: ToolsProgress | null }) {
  const t = useT();
  const pct = progress?.total ? Math.min(100, (progress.downloaded / progress.total) * 100) : null;
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[11.5px] text-mute">
        <span>{progress ? t(STEP_LABEL[progress.step]) : t("media.preparing")}</span>
        {progress?.total ? (
          <span className="tabular-nums">
            {formatBytes(progress.downloaded)} / {formatBytes(progress.total)}
          </span>
        ) : null}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-track">
        {pct == null ? (
          <div className="h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-brand" />
        ) : (
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}

/** Shown in the add dialog when a video page needs the tools first. */
export function ToolsInstallCard({ onInstalled, onError }: { onInstalled: () => void; onError: (msg: string) => void }) {
  const t = useT();
  const tools = useMediaTools(onError);
  return (
    <div className="animate-fade-in rounded-xl border border-brand/25 bg-brand/6 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand">
          <VideoIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">{t("media.card.title")}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-mute">
            {t("media.card.before")} <b className="font-medium text-ink-2">yt-dlp</b>
            {tools.status?.canInstallFfmpeg !== false && (
              <>
                {" "}
                {t("media.card.and")} <b className="font-medium text-ink-2">ffmpeg</b>
              </>
            )}{" "}
            {t("media.card.after")}
            {tools.status ? t("media.card.size", { size: formatBytes(tools.status.installSize) }) : ""}
            {t("media.card.end")}
          </p>
          {tools.busy ? (
            <ProgressLine progress={tools.progress} />
          ) : (
            <button
              type="button"
              className="btn-primary mt-3"
              onClick={async () => {
                if (await tools.install()) onInstalled();
              }}
            >
              <DownloadIcon /> {t("media.install")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Settings → Video. */
export function MediaToolsPanel({ onError }: { onError: (msg: string) => void }) {
  const t = useT();
  const tools = useMediaTools(onError);
  const s = tools.status;
  if (!s) return <p className="py-6 text-[12.5px] text-mute">{t("media.checking")}</p>;
  const installed = s.ytdlpVersion != null;
  return (
    <div>
      <p className="text-[12.5px] leading-relaxed text-mute">
        {t("media.panel.introBefore")} <b className="font-medium text-ink-2">yt-dlp</b>
        {t("media.panel.introAfter")}
      </p>
      <dl className="mt-4 divide-y divide-line rounded-xl border border-line text-[12.5px]">
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="font-medium text-ink">yt-dlp</dt>
          <dd className={installed ? "text-emerald-600 dark:text-emerald-400" : "text-mute"}>
            {installed ? t("media.installedVersion", { version: s.ytdlpVersion ?? "" }) : t("media.notInstalled")}
          </dd>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="font-medium text-ink">ffmpeg</dt>
          <dd className={s.ffmpeg ? "text-emerald-600 dark:text-emerald-400" : "text-mute"}>
            {s.ffmpeg
              ? s.ffmpegFromSystem
                ? t("media.fromSystem")
                : t("media.installed")
              : s.canInstallFfmpeg
                ? t("media.notInstalled")
                : t("media.ffmpegManual")}
          </dd>
        </div>
      </dl>
      {tools.busy ? (
        <ProgressLine progress={tools.progress} />
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {!installed || (s.canInstallFfmpeg && !s.ffmpeg) ? (
            <button className="btn-primary" onClick={tools.install}>
              <DownloadIcon /> {t("media.installWithSize", { size: formatBytes(s.installSize) })}
            </button>
          ) : (
            <button className="btn-outline" onClick={tools.update}>
              <RefreshIcon /> {t("media.updateYtdlp")}
            </button>
          )}
          {installed && (
            <button className="btn-ghost text-red-600 dark:text-red-400" onClick={tools.remove}>
              <TrashIcon /> {t("media.remove")}
            </button>
          )}
        </div>
      )}
      <p className="mt-4 text-[11.5px] text-mute">{t("media.autoUpdate")}</p>
    </div>
  );
}
