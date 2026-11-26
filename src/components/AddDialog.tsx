import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, isMediaToolsMissing, type Capture, type PlaylistInfo, type ProbeResult, type RequestHeaders } from "../lib/api";
import { errorText, formatBytes, formatDuration, hostOf, isProbablyUrl, resolutionLabel } from "../lib/format";
import { expandLinks, joinPath, nameFromUrl, safeFolderName } from "../lib/batch";
import { Field, Modal } from "./Modal";
import { FileTile } from "./FileTile";
import { PickList } from "./PickList";
import { AlertIcon, BoltIcon, ClipboardIcon, FolderIcon, LayersIcon, LinkIcon, PlusIcon, PuzzleIcon } from "./Icons";
import { ToolsInstallCard } from "./MediaTools";
import { useT, type MessageKey, type TFunction } from "../i18n";

/** Qualities offered for a whole playlist (videos are not inspected one by one). */
const PLAYLIST_QUALITIES: { id: string; label: MessageKey | null; text?: string }[] = [
  { id: "best", label: "add.qualityBest" },
  { id: "1080", label: null, text: "1080p" },
  { id: "720", label: null, text: "720p" },
  { id: "480", label: null, text: "480p" },
  { id: "audio", label: null, text: "MP3" },
];

type PlaylistState =
  | { kind: "loading"; url: string }
  | { kind: "ok"; url: string; info: PlaylistInfo }
  | { kind: "error"; url: string; message: string };

/** `…watch?v=x&list=PL…` on YouTube: the playlist the video belongs to. */
function youtubeList(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/watch\?[^#]*?\blist=([\w-]+)/i.exec(url.trim());
  return m ? `https://www.youtube.com/playlist?list=${m[1]}` : null;
}

interface Props {
  /** Prefilled from a browser capture. */
  capture?: Capture;
  defaultDir: string;
  defaultConnections: number;
  onClose: () => void;
  onAdded: (name: string, started: boolean) => void;
  onError: (msg: string) => void;
}

type ProbeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; result: ProbeResult }
  | { kind: "error"; message: string };

const CONNECTION_CHOICES = [1, 2, 4, 8, 16, 32];

/** Sites whose links are video pages (probing them runs yt-dlp, which takes a few seconds). */
const VIDEO_SITE =
  /^https?:\/\/((www|m|mobile|web|music|vm|vt|v|player|clips|gaming)\.)?(youtube\.com|youtu\.be|tiktok\.com|douyin\.com|facebook\.com|fb\.watch|instagram\.com|x\.com|twitter\.com|vimeo\.com|dailymotion\.com|soundcloud\.com|bilibili\.com|twitch\.tv)\//i;

/** yt-dlp extractor names -> how people write them. */
const SITE_NAMES: Record<string, string> = { Youtube: "YouTube", YoutubeTab: "YouTube", Twitter: "X", TikTok: "TikTok", Douyin: "Douyin", Facebook: "Facebook", Instagram: "Instagram", Vimeo: "Vimeo", Dailymotion: "Dailymotion", Soundcloud: "SoundCloud", BiliBili: "Bilibili", TwitchVod: "Twitch", TwitchClips: "Twitch" };

const MEDIA_EXT = /\.(mp4|m4v|mkv|webm|mov|mp3|m4a|opus|ogg)$/i;
const withExt = (name: string, ext: string) => (name ? `${name.replace(MEDIA_EXT, "")}.${ext}` : name);

/** The engine's quality labels are English words for "best" and M4A audio; heights and "MP3" pass through. */
function qualityLabel(t: TFunction, q: { id: string; label: string }): string {
  if (q.id === "best") return t("add.qualityBest");
  if (q.id === "audio" && q.label !== "MP3") return t("add.qualityM4a");
  return q.label;
}

export function AddDialog({ capture, defaultDir, defaultConnections, onClose, onAdded, onError }: Props) {
  const t = useT();
  const [url, setUrl] = useState(capture?.url ?? "");
  const [fileName, setFileName] = useState(capture?.fileName ?? "");
  const [nameTouched, setNameTouched] = useState(Boolean(capture?.fileName));
  const [saveDir, setSaveDir] = useState(defaultDir);
  // Chosen by hand: stop following the file type ("sort by type").
  const [dirTouched, setDirTouched] = useState(false);
  const [connections, setConnections] = useState(defaultConnections);
  const [probe, setProbe] = useState<ProbeState>({ kind: "idle" });
  // Video pages: chosen quality, and a counter to probe again after installing yt-dlp.
  const [quality, setQuality] = useState<string | null>(null);
  const [probeNonce, setProbeNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const urlRef = useRef<HTMLTextAreaElement>(null);
  // Several links (a pasted list or a [01-20] pattern), or a playlist: a checklist.
  const links = useMemo(() => expandLinks(url), [url]);
  const batch = links.length > 1;
  const [playlist, setPlaylist] = useState<PlaylistState | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [plQuality, setPlQuality] = useState("1080");
  const [plFolder, setPlFolder] = useState(true);

  const headers: RequestHeaders | undefined = capture
    ? { referrer: capture.referrer, userAgent: capture.userAgent, cookies: capture.cookies }
    : undefined;

  // A new list starts fully checked.
  useEffect(() => setUnchecked(new Set()), [url, playlist?.kind]);

  // Inspect the URL (debounced): name, size, range support.
  useEffect(() => {
    const target = url.trim();
    setPlaylist(null);
    if (!isProbablyUrl(target) || expandLinks(target).length > 1) {
      setProbe({ kind: "idle" });
      return;
    }
    setProbe({ kind: "loading" });
    let stale = false;
    const timer = setTimeout(() => {
      api
        .probe(target, headers)
        .then((result) => {
          if (stale) return;
          setProbe({ kind: "ok", result });
          if (result.media) {
            const qs = result.media.qualities;
            setQuality((qs.find((q) => q.id === "1080") ?? qs[0])?.id ?? null);
          }
          if (!nameTouched) setFileName(result.fileName);
        })
        .catch((e) => {
          if (stale) return;
          const message = String(e);
          setProbe({ kind: "error", message });
          // A playlist or channel page: list its videos instead.
          if (/this link is a playlist/i.test(message)) loadPlaylist(target);
        });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, probeNonce]);

  useEffect(() => {
    if (!capture) urlRef.current?.focus();
  }, [capture]);

  function loadPlaylist(target: string) {
    setPlaylist({ kind: "loading", url: target });
    api
      .mediaPlaylist(target, headers)
      .then((info) => setPlaylist((p) => (p?.url === target ? { kind: "ok", url: target, info } : p)))
      .catch((e) => setPlaylist((p) => (p?.url === target ? { kind: "error", url: target, message: String(e) } : p)));
  }

  async function pickFolder() {
    const dir = await open({ directory: true, defaultPath: saveDir || undefined });
    if (typeof dir === "string") {
      setSaveDir(dir);
      setDirTouched(true);
    }
  }

  async function submit(startPaused: boolean) {
    setBusy(true);
    try {
      const d = await api.add({
        url: url.trim(),
        fileName: fileName.trim() || null,
        saveDir: saveDir.trim() || null,
        connections,
        headers,
        startPaused,
        kind: downloadKind,
        mediaQuality,
      });
      onAdded(d.fileName, !startPaused);
      onClose();
    } catch (e) {
      onError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Add every checked link (batch) or playlist video, one download each. */
  async function submitMany(startPaused: boolean) {
    const plInfo = playlist?.kind === "ok" ? playlist.info : null;
    const urls = (plInfo ? plInfo.entries.map((e) => e.url) : links).filter((u) => !unchecked.has(u));
    if (!urls.length) return;
    setBusy(true);
    let added = 0;
    let firstError: string | null = null;
    try {
      // Playlist: one folder for all (by type, then the playlist's own folder).
      let plDir: string | null = null;
      if (plInfo) {
        plDir = dirTouched ? saveDir : await api.categoryDir("", "media", plQuality).catch(() => saveDir);
        const sub = safeFolderName(plInfo.title);
        if (plFolder && sub) plDir = joinPath(plDir, sub);
      }
      for (const u of urls) {
        const dir = plDir ?? (dirTouched ? saveDir : await api.categoryDir(nameFromUrl(u), null, null).catch(() => saveDir));
        try {
          await api.add({
            url: u,
            saveDir: dir.trim() || null,
            connections,
            headers,
            startPaused,
            kind: plInfo ? "media" : null,
            mediaQuality: plInfo ? plQuality : null,
          });
          added++;
        } catch (e) {
          firstError ??= `${u}: ${String(e)}`;
        }
      }
    } finally {
      setBusy(false);
    }
    if (added) onAdded(t("add.addedMany", { n: added }), !startPaused);
    if (firstError) onError(added ? t("add.someFailed", { n: urls.length - added, error: firstError }) : firstError);
    if (added) onClose();
  }

  const valid = isProbablyUrl(url);
  const stream = probe.kind === "ok" ? probe.result.stream : null;
  const media = probe.kind === "ok" ? probe.result.media : null;
  const toolsMissing = probe.kind === "error" && isMediaToolsMissing(probe.message);
  const picked = media?.qualities.find((q) => q.id === quality) ?? null;
  const size = media ? (picked?.estimatedSize ?? null) : probe.kind === "ok" ? probe.result.totalSize : (capture?.fileSize ?? null);
  const blocked = Boolean(stream?.live || media?.isLive || toolsMissing);
  const videoSite = VIDEO_SITE.test(url);
  const plInfo = playlist?.kind === "ok" ? playlist.info : null;
  const downloadKind = plInfo || media ? "media" : stream ? "hls" : (capture?.kind ?? null);
  const mediaQuality = plInfo ? plQuality : media ? quality : null;

  // "Sort by type": the folder follows the file type (the app knows the
  // folders; without sorting this is the download folder).
  useEffect(() => {
    if (dirTouched) return;
    let stale = false;
    api
      .categoryDir(fileName, downloadKind, mediaQuality)
      .then((dir) => !stale && setSaveDir(dir))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [fileName, downloadKind, mediaQuality, dirTouched]);

  function pickQuality(id: string) {
    setQuality(id);
    const audio = media?.qualities.find((q) => q.id === id);
    // Audio is MP3 with ffmpeg, the original M4A without.
    setFileName((n) => withExt(n, id === "audio" ? (audio?.label === "MP3" ? "mp3" : "m4a") : "mp4"));
  }
  const shownName = fileName || (valid ? "…" : "");
  const fromClipboard = capture?.source === "clipboard";
  // Checklist modes: several links, or the videos of a playlist.
  const listMode = batch || playlist != null;
  const listUrls = plInfo ? plInfo.entries.map((e) => e.url) : batch ? links : [];
  const pickedCount = listUrls.filter((u) => !unchecked.has(u)).length;
  const canAdd = !busy && (listMode ? pickedCount > 0 : valid && !blocked);
  const go = (startPaused: boolean) => (listMode ? submitMany(startPaused) : submit(startPaused));
  const wholeList = listMode ? null : youtubeList(url);

  return (
    <Modal
      title={
        fromClipboard
          ? t("add.titleClipboard")
          : capture
            ? capture.kind === "media"
              ? t("add.titleCaptureMedia")
              : t("add.titleCapture")
            : t("add.title")
      }
      subtitle={
        fromClipboard
          ? t("add.fromClipboard")
          : capture
            ? t("add.from", { host: hostOf(capture.referrer || capture.url) })
            : t("add.subtitle")
      }
      icon={fromClipboard ? <ClipboardIcon /> : capture ? <PuzzleIcon /> : <LinkIcon />}
      onClose={onClose}
      width="max-w-[560px]"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn-outline" disabled={!canAdd} onClick={() => go(true)}>
            <PlusIcon /> {t("add.addLater")}
          </button>
          <button className="btn-primary min-w-[110px]" disabled={!canAdd} onClick={() => go(false)}>
            <BoltIcon /> {listMode ? t("add.downloadN", { n: pickedCount }) : t("add.downloadNow")}
          </button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd) go(false);
        }}
      >
        <div className="relative">
          <LinkIcon className="pointer-events-none absolute top-[13px] left-3.5 text-faint" />
          <textarea
            ref={urlRef}
            rows={Math.min(6, Math.max(1, url.split("\n").length))}
            className="field block resize-none py-2.5 pl-10 font-mono text-[12px] leading-[18px]"
            placeholder="https://example.com/file.zip"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds; Shift+Enter starts another line for more links.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            spellCheck={false}
          />
          {!url.trim() && <p className="mt-1.5 text-[11.5px] text-mute">{t("add.batchTip")}</p>}
        </div>

        {/* Several links: one download each */}
        {batch && (
          <PickList
            items={links.map((u) => ({ key: u, title: nameFromUrl(u), sub: hostOf(u) }))}
            unchecked={unchecked}
            onChange={setUnchecked}
          />
        )}

        {/* Playlist / channel */}
        {playlist?.kind === "loading" && (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-panel/60 p-3.5 text-[12.5px] text-mute">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/25 border-t-brand" /> {t("add.loadingPlaylist")}
          </div>
        )}
        {playlist?.kind === "error" && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3.5 text-[12.5px] text-red-600">
            <AlertIcon /> {errorText(playlist.message)}
          </div>
        )}
        {plInfo && (
          <>
            <div className="flex items-center gap-3 rounded-xl border border-line bg-panel/60 p-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/12 text-rose-600 dark:text-rose-400">
                <LayersIcon />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium text-ink">{plInfo.title}</div>
                <div className="truncate text-[12px] text-mute">
                  {[plInfo.uploader, t("add.playlistCount", { n: plInfo.entries.length })].filter(Boolean).join(" · ")}
                </div>
              </div>
              {/* Opened from one video of the list: go back to just that one. */}
              {youtubeList(url) && (
                <button type="button" className="btn-ghost shrink-0 text-[12px]" onClick={() => setPlaylist(null)}>
                  {t("add.singleVideo")}
                </button>
              )}
            </div>
            <label className="flex items-center gap-2.5 text-[12.5px] text-ink-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={plFolder} onChange={(e) => setPlFolder(e.target.checked)} />
              {t("add.playlistFolder", { name: safeFolderName(plInfo.title) || "…" })}
            </label>
            <Field label={t("add.quality")} hint={t("add.playlistQualityHint")}>
              <div className="flex gap-1 rounded-lg bg-panel p-1">
                {PLAYLIST_QUALITIES.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setPlQuality(q.id)}
                    aria-pressed={plQuality === q.id}
                    className={`flex-1 rounded-md py-1.5 text-[12.5px] font-medium transition ${
                      plQuality === q.id ? "bg-card text-brand shadow-card" : "text-mute hover:text-ink"
                    }`}
                  >
                    {q.label ? t(q.label) : q.text}
                  </button>
                ))}
              </div>
            </Field>
            <PickList
              items={plInfo.entries.map((e) => ({
                key: e.url,
                title: e.title,
                sub: e.durationSecs ? formatDuration(e.durationSecs) : hostOf(e.url),
                thumb: e.thumbnail,
              }))}
              unchecked={unchecked}
              onChange={setUnchecked}
            />
          </>
        )}

        {/* File preview card */}
        {valid && !listMode && (
          <div className="animate-fade-in flex items-center gap-3.5 rounded-xl border border-line bg-panel/60 p-3.5">
            {media?.thumbnail ? (
              <img src={media.thumbnail} alt="" className="h-[54px] w-24 shrink-0 rounded-lg bg-track object-cover" referrerPolicy="no-referrer" />
            ) : (
              <FileTile name={shownName} />
            )}
            <div className="min-w-0 flex-1">
              <input
                className="w-full truncate bg-transparent text-[14px] font-medium text-ink outline-none placeholder:text-faint"
                value={fileName}
                placeholder={t("add.fileNamePlaceholder")}
                onChange={(e) => {
                  setFileName(e.target.value);
                  setNameTouched(true);
                }}
              />
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
                {probe.kind === "loading" && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />{" "}
                    {videoSite ? t("add.loadingVideo") : t("add.checking")}
                  </span>
                )}
                {probe.kind === "error" && !toolsMissing && (
                  <span className="flex items-center gap-1.5 text-red-500">
                    <AlertIcon /> {errorText(probe.message)}
                  </span>
                )}
                {toolsMissing && <span className="text-mute">{t("add.toolsNeeded")}</span>}
                {(probe.kind === "ok" || size != null) && (
                  <span className="font-medium text-ink-2" title={stream || media ? t("add.estimate") : undefined}>
                    {(stream || media) && size != null ? "≈ " : ""}
                    {formatBytes(size)}
                  </span>
                )}
                {media && (
                  <>
                    <span className="rounded-full bg-rose-500/12 px-2 py-px text-[11px] font-medium text-rose-700 dark:text-rose-300">
                      {SITE_NAMES[media.site] ?? (media.site || "Video")}
                      {media.durationSecs ? ` · ${formatDuration(media.durationSecs)}` : ""}
                    </span>
                    {media.uploader && <span className="truncate">{media.uploader}</span>}
                    {media.isLive && (
                      <span className="flex items-center gap-1.5 text-red-500">
                        <AlertIcon /> {t("add.liveVideo")}
                      </span>
                    )}
                  </>
                )}
                {stream && (
                  <>
                    <span className="rounded-full bg-rose-500/12 px-2 py-px text-[11px] font-medium text-rose-700 dark:text-rose-300">
                      Video HLS
                      {resolutionLabel(stream.resolution) ? ` · ${resolutionLabel(stream.resolution)}` : ""}
                      {stream.live ? "" : ` · ${formatDuration(stream.durationSecs)}`}
                    </span>
                    {stream.live ? (
                      <span className="flex items-center gap-1.5 text-red-500">
                        <AlertIcon /> {t("add.liveStream")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-500/12 px-2 py-px text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                        {t("add.hlsSegments", { n: stream.segments })}
                        {stream.encrypted ? t("add.encrypted") : ""}
                      </span>
                    )}
                  </>
                )}
                {probe.kind === "ok" &&
                  !stream &&
                  !media &&
                  (probe.result.resumable ? (
                    <span className="rounded-full bg-emerald-500/12 px-2 py-px text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                      {t("add.multiConn")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-500/14 px-2 py-px text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {t("add.singleConn")}
                    </span>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* A video opened from a playlist: offer the whole list. */}
        {wholeList && (
          <button type="button" className="btn-outline w-full justify-center" onClick={() => loadPlaylist(wholeList)}>
            <LayersIcon /> {t("add.wholePlaylist")}
          </button>
        )}

        {toolsMissing && !listMode && <ToolsInstallCard onInstalled={() => setProbeNonce((n) => n + 1)} onError={onError} />}

        {media && !listMode && !media.isLive && media.qualities.length > 0 && (
          <Field label={t("add.quality")} hint={media.needsFfmpegForBest ? t("add.qualityHint") : undefined}>
            <div className="flex flex-wrap gap-1.5">
              {media.qualities.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => pickQuality(q.id)}
                  aria-pressed={quality === q.id}
                  className={`flex min-w-[76px] flex-col items-start rounded-lg border px-3 py-1.5 text-left transition ${
                    quality === q.id ? "border-brand bg-brand/8 ring-2 ring-brand/15" : "border-line bg-card hover:border-line-strong"
                  }`}
                >
                  <span className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${quality === q.id ? "text-brand" : "text-ink"}`}>
                    {qualityLabel(t, q)}
                  </span>
                  <span className="text-[11px] text-mute tabular-nums">{q.estimatedSize ? `≈ ${formatBytes(q.estimatedSize)}` : "—"}</span>
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label={t("add.saveTo")}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <FolderIcon className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint" />
              <input
                className="field pl-10"
                value={saveDir}
                onChange={(e) => {
                  setSaveDir(e.target.value);
                  setDirTouched(true);
                }}
              />
            </div>
            <button type="button" className="btn-outline" onClick={pickFolder}>
              {t("add.browse")}
            </button>
          </div>
        </Field>

        {!media && !toolsMissing && !playlist && (
          <Field
            label={t("add.connections")}
            hint={t("add.connectionsHint")}
          >
            <div className="flex gap-1 rounded-lg bg-panel p-1">
              {CONNECTION_CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setConnections(c)}
                  className={`flex-1 rounded-md py-1.5 text-[12.5px] font-medium tabular-nums transition ${
                    connections === c ? "bg-card text-brand shadow-card" : "text-mute hover:text-ink"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </Field>
        )}
      </form>
    </Modal>
  );
}
