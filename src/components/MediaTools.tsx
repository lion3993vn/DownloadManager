import { useEffect, useState } from "react";
import { api, onToolsProgress, type ToolsProgress, type ToolsStatus } from "../lib/api";
import { formatBytes } from "../lib/format";
import { DownloadIcon, RefreshIcon, TrashIcon, VideoIcon } from "./Icons";

const STEP_LABEL: Record<ToolsProgress["step"], string> = {
  "yt-dlp": "Đang tải yt-dlp",
  ffmpeg: "Đang tải ffmpeg",
  extract: "Đang giải nén ffmpeg",
  update: "Đang cập nhật yt-dlp",
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
  const pct = progress?.total ? Math.min(100, (progress.downloaded / progress.total) * 100) : null;
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[11.5px] text-mute">
        <span>{progress ? STEP_LABEL[progress.step] : "Đang chuẩn bị…"}</span>
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
  const tools = useMediaTools(onError);
  return (
    <div className="animate-fade-in rounded-xl border border-brand/25 bg-brand/6 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/12 text-brand">
          <VideoIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink">Cần cài công cụ tải video</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-mute">
            Để tải từ YouTube, TikTok, Facebook… app dùng <b className="font-medium text-ink-2">yt-dlp</b>
            {tools.status?.canInstallFfmpeg !== false && (
              <>
                {" "}
                và <b className="font-medium text-ink-2">ffmpeg</b>
              </>
            )}{" "}
            (mã nguồn mở). Chỉ cần cài một lần
            {tools.status ? `, khoảng ${formatBytes(tools.status.installSize)}` : ""}. App tự cập nhật chúng về sau.
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
              <DownloadIcon /> Cài đặt
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Settings → Video. */
export function MediaToolsPanel({ onError }: { onError: (msg: string) => void }) {
  const tools = useMediaTools(onError);
  const s = tools.status;
  if (!s) return <p className="py-6 text-[12.5px] text-mute">Đang kiểm tra…</p>;
  const installed = s.ytdlpVersion != null;
  return (
    <div>
      <p className="text-[12.5px] leading-relaxed text-mute">
        Tải video từ YouTube, TikTok, Facebook, Instagram, X, Vimeo… bằng <b className="font-medium text-ink-2">yt-dlp</b>. ffmpeg ghép hình
        và tiếng (cần cho chất lượng trên 720p) và chuyển sang MP3.
      </p>
      <dl className="mt-4 divide-y divide-line rounded-xl border border-line text-[12.5px]">
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="font-medium text-ink">yt-dlp</dt>
          <dd className={installed ? "text-emerald-600 dark:text-emerald-400" : "text-mute"}>
            {installed ? `Đã cài · ${s.ytdlpVersion}` : "Chưa cài"}
          </dd>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <dt className="font-medium text-ink">ffmpeg</dt>
          <dd className={s.ffmpeg ? "text-emerald-600 dark:text-emerald-400" : "text-mute"}>
            {s.ffmpeg ? (s.ffmpegFromSystem ? "Có sẵn trên máy" : "Đã cài") : s.canInstallFfmpeg ? "Chưa cài" : "Chưa có (cài bằng Homebrew / trình quản lý gói)"}
          </dd>
        </div>
      </dl>
      {tools.busy ? (
        <ProgressLine progress={tools.progress} />
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {!installed || (s.canInstallFfmpeg && !s.ffmpeg) ? (
            <button className="btn-primary" onClick={tools.install}>
              <DownloadIcon /> Cài đặt ({formatBytes(s.installSize)})
            </button>
          ) : (
            <button className="btn-outline" onClick={tools.update}>
              <RefreshIcon /> Cập nhật yt-dlp
            </button>
          )}
          {installed && (
            <button className="btn-ghost text-red-600 dark:text-red-400" onClick={tools.remove}>
              <TrashIcon /> Gỡ công cụ
            </button>
          )}
        </div>
      )}
      <p className="mt-4 text-[11.5px] text-mute">yt-dlp được tự cập nhật mỗi ngày, vì các trang video hay thay đổi cách phát.</p>
    </div>
  );
}
