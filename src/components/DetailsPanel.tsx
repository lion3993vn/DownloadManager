import { useState, type ReactNode } from "react";
import { errorText, formatBytes, formatDate, formatEta, formatSpeed, hostOf, statusLabel, STATUS_PILL } from "../lib/format";
import type { Row } from "../lib/useDownloads";
import { useT } from "../i18n";
import { FileTile } from "./FileTile";
import { SegmentBar, SegmentMap } from "./SegmentBar";
import { CloseIcon, CopyIcon, FolderIcon, OpenIcon, PauseIcon, PlayIcon, RetryIcon, StopIcon, TrashIcon } from "./Icons";

interface Props {
  row: Row;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRemove: () => void;
  onOpen: () => void;
  onFolder: () => void;
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <dt className="shrink-0 text-mute">{label}</dt>
      <dd className="min-w-0 text-right text-ink-2">{children}</dd>
    </div>
  );
}

export function DetailsPanel({ row: r, ...a }: Props) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const pct = r.status === "completed" ? 100 : r.totalSize ? Math.min(100, (r.downloaded / r.totalSize) * 100) : null;
  const sep = r.saveDir.includes("\\") ? "\\" : "/";
  // Video (yt-dlp): one segment per fragment on disk, after the part already
  // joined; only the fragments still downloading are connections.
  const mapSegments =
    r.kind === "media" ? r.liveSegments.filter((s) => s.done < s.end - s.start) : r.liveSegments;

  async function copyUrl() {
    await navigator.clipboard.writeText(r.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <aside className="animate-fade-in flex w-[320px] shrink-0 flex-col border-l border-line bg-card">
      <div className="flex items-center justify-between px-5 pt-4">
        <span className="text-[12px] font-semibold tracking-wider text-faint uppercase">{t("details.title")}</span>
        <button className="icon-btn" onClick={a.onClose} aria-label={t("details.close")}>
          <CloseIcon />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <div className="mt-3 flex flex-col items-center text-center">
          <FileTile name={r.fileName} size="lg" />
          <h3 className="mt-3 text-[14px] font-semibold break-all text-ink">{r.fileName}</h3>
          <span className={`mt-2 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_PILL[r.status]}`}>{statusLabel(r.status)}</span>
        </div>

        <div className="mt-5">
          <div className="mb-1.5 flex items-end justify-between">
            <span className="text-[22px] font-semibold tracking-tight tabular-nums text-ink">{pct != null ? `${pct.toFixed(1)}%` : "—"}</span>
            {r.status === "downloading" && <span className="text-[12px] font-medium tabular-nums text-brand">{formatSpeed(r.speed)}</span>}
          </div>
          <SegmentBar segments={r.liveSegments} total={r.totalSize} downloaded={r.downloaded} status={r.status} height="h-2" />
        </div>

        {r.error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] break-words text-red-600">{errorText(r.error)}</p>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          {(r.status === "downloading" || r.status === "queued") && (
            <button className="btn-outline" onClick={a.onPause}>
              <PauseIcon /> {t("details.pause")}
            </button>
          )}
          {r.status === "paused" && (
            <button className="btn-primary" onClick={a.onResume}>
              <PlayIcon /> {t("details.resume")}
            </button>
          )}
          {(r.status === "failed" || r.status === "canceled") && (
            <button className="btn-primary" onClick={a.onResume}>
              <RetryIcon /> {t("details.retry")}
            </button>
          )}
          {r.status === "completed" && (
            <button className="btn-primary" onClick={a.onOpen}>
              <OpenIcon /> {t("details.openFile")}
            </button>
          )}
          <button className="btn-outline" onClick={a.onFolder}>
            <FolderIcon /> {t("details.folder")}
          </button>
          {r.status !== "completed" && r.status !== "canceled" && (
            <button className="btn-outline" onClick={a.onCancel}>
              <StopIcon /> {t("details.cancel")}
            </button>
          )}
          <button className="btn-outline text-red-600 hover:text-red-600" onClick={a.onRemove}>
            <TrashIcon /> {t("details.remove")}
          </button>
        </div>

        {r.status !== "completed" && mapSegments.length > 1 && (
          <section className="mt-5">
            <h4 className="mb-2 text-[12px] font-semibold text-ink-2">
              {t("details.connectionsHeading")}{" "}
              <span className="font-normal text-mute">
                ({t(r.kind === "media" ? "details.activeSegments" : "details.segments", { n: mapSegments.length })})
              </span>
            </h4>
            <SegmentMap segments={mapSegments} status={r.status} />
          </section>
        )}

        <dl className="mt-5 divide-y divide-line text-[12.5px]">
          <InfoRow label={t("details.size")}>
            {/* HLS sizes are estimates until every segment is in. */}
            {r.kind === "hls" && r.status !== "completed" && r.totalSize != null ? "≈ " : ""}
            {formatBytes(r.totalSize)}
          </InfoRow>
          <InfoRow label={t("details.downloaded")}>{formatBytes(r.status === "completed" ? (r.totalSize ?? r.downloaded) : r.downloaded)}</InfoRow>
          {r.status === "downloading" && <InfoRow label={t("details.remaining")}>{formatEta(r.etaSecs)}</InfoRow>}
          {r.kind === "hls" && <InfoRow label={t("details.type")}>{t("details.typeHls")}</InfoRow>}
          {r.kind === "media" && (
            <InfoRow label={t("details.type")}>
              {t("details.typeMedia", { host: hostOf(r.url) })}
              {r.mediaQuality
                ? ` · ${r.mediaQuality === "audio" ? t("details.qualityAudio") : r.mediaQuality === "best" ? t("details.qualityBest") : `${r.mediaQuality}p`}`
                : ""}
            </InfoRow>
          )}
          <InfoRow label={t("details.connections")}>
            {r.kind === "media"
              ? // yt-dlp only splits some formats (YouTube's); the live count says.
                r.status === "downloading" && r.activeConnections > 0
                ? t("details.connResumable", { n: r.activeConnections })
                : t("details.resumable")
              : r.kind === "hls"
              ? t("details.connResumable", { n: r.connections })
              : r.totalSize == null && r.downloaded === 0 && r.status !== "completed"
              ? t("details.connUnchecked", { n: r.connections })
              : r.resumable
                ? t("details.connResumable", { n: r.connections })
                : t("details.singleConn")}
          </InfoRow>
          <InfoRow label={t("details.savedAt")}>
            <span className="break-all" title={r.saveDir + sep + r.fileName}>
              {r.saveDir}
              {sep}
              <b className="font-medium text-ink">{r.fileName}</b>
            </span>
          </InfoRow>
          <InfoRow label={t("details.addedAt")}>{formatDate(r.createdAt)}</InfoRow>
          {r.completedAt && <InfoRow label={t("details.completedAt")}>{formatDate(r.completedAt)}</InfoRow>}
        </dl>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] text-mute">{t("details.link")}</span>
            <button className="flex items-center gap-1 text-[12px] text-brand hover:underline" onClick={copyUrl}>
              <CopyIcon className="h-3.5 w-3.5" /> {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
          <p className="rounded-lg bg-panel px-3 py-2 font-mono text-[11px] break-all text-ink-2 select-text">{r.url}</p>
        </div>
      </div>
    </aside>
  );
}
