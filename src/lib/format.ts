import type { Status } from "./api";
import { locale, t, type MessageKey } from "../i18n";

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : v < 10 ? 2 : v < 100 ? 1 : 0)} ${UNITS[i]}`;
}

export function formatSpeed(bps: number | null | undefined): string {
  if (!bps || bps < 1) return "0 B/s";
  return `${formatBytes(bps)}/s`;
}

export function formatEta(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs)) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 99) return t("time.over99h");
  if (h > 0) return t("time.hm", { h, m });
  if (m > 0) return t("time.ms", { m, s });
  return t("time.s", { s });
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(locale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return t("time.justNow");
  if (diff < 3600) return t("time.minutesAgo", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("time.hoursAgo", { n: Math.floor(diff / 3600) });
  if (diff < 86400 * 7) return t("time.daysAgo", { n: Math.floor(diff / 86400) });
  return new Date(ms).toLocaleDateString(locale());
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export type FileKind = "video" | "audio" | "archive" | "document" | "program" | "image" | "other";

const KINDS: Record<Exclude<FileKind, "other">, string[]> = {
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "mpg", "mpeg"],
  audio: ["mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "img", "dmg", "tgz"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "epub", "csv", "odt", "md"],
  program: ["exe", "msi", "apk", "deb", "rpm", "appimage", "pkg", "msix", "run"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tiff", "heic", "avif"],
};

export function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function fileKind(name: string): FileKind {
  const ext = fileExt(name);
  for (const [kind, exts] of Object.entries(KINDS)) {
    if (exts.includes(ext)) return kind as FileKind;
  }
  return "other";
}

/** Tile colors per file kind: [background, foreground]. */
export const KIND_COLORS: Record<FileKind, string> = {
  video: "bg-rose-500/12 text-rose-600 dark:text-rose-400",
  audio: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400",
  archive: "bg-amber-500/14 text-amber-600 dark:text-amber-400",
  document: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  program: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  image: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  other: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
};

export function statusLabel(status: Status): string {
  return t(`status.${status}`);
}

export const STATUS_PILL: Record<Status, string> = {
  queued: "bg-slate-500/12 text-slate-600 dark:text-slate-300",
  downloading: "bg-blue-500/12 text-blue-600 dark:text-blue-300",
  paused: "bg-amber-500/14 text-amber-700 dark:text-amber-300",
  completed: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  failed: "bg-red-500/12 text-red-600 dark:text-red-300",
  canceled: "bg-slate-500/12 text-slate-500 dark:text-slate-400",
};

export function isProbablyUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** 2895 -> "48:15", 4000 -> "1:06:40". */
export function formatDuration(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs) || secs <= 0) return "—";
  const s = Math.round(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "1280×720" -> "720p" style label. */
export function resolutionLabel(res: [number, number] | null | undefined): string | null {
  if (!res) return null;
  const [w, h] = res;
  const short = Math.min(w, h);
  return short >= 2160 ? "4K" : `${short}p`;
}

/** Engine errors are English; translate the ones users can act on. */
const ERROR_TEXT: [RegExp, MessageKey][] = [
  [/live streams cannot be downloaded/i, "error.live"],
  [/protected with .*\(DRM\)/i, "error.drm"],
  [/audio is a separate stream/i, "error.splitAudio"],
  [/not an HLS playlist/i, "error.notHls"],
  [/could not decrypt a segment/i, "error.decrypt"],
  [/media tools/i, "error.mediaTools"],
  [/this link is a playlist/i, "error.playlist"],
  [/yt-dlp: .*(Private video|This video is private)/i, "error.private"],
  [/yt-dlp: .*(Sign in to confirm|confirm your age|age-restricted)/i, "error.signIn"],
  [/yt-dlp: .*Fresh cookies/i, "error.freshCookies"],
  [/yt-dlp: .*(Video unavailable|not available)/i, "error.unavailable"],
  [/yt-dlp: .*Unsupported URL/i, "error.unsupported"],
  [/server responded with HTTP 403/i, "error.forbidden"],
];

export function errorText(message: string | null | undefined): string {
  if (!message) return "";
  for (const [re, key] of ERROR_TEXT) if (re.test(message)) return t(key);
  const yt = /^yt-dlp: (.*)/s.exec(message);
  if (yt) return t("error.video", { msg: yt[1] });
  return message;
}

/**
 * Release notes hold one block per language, `<!-- lang:en -->…<!-- /lang -->`
 * (scripts/release-notes.mjs, from v0.5.3). Returns the block for `lang`,
 * else the English one, else the whole text (older, Vietnamese-only notes).
 */
export function notesFor(text: string, lang: string): string {
  const blocks = new Map<string, string>();
  for (const m of text.matchAll(/<!--\s*lang:(\w+)\s*-->([\s\S]*?)<!--\s*\/lang\s*-->/g)) {
    blocks.set(m[1], m[2].trim());
  }
  return blocks.get(lang) ?? blocks.get("en") ?? text;
}
