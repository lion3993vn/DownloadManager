const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : v < 10 ? 2 : 1)} ${UNITS[i]}`;
}

export function formatSpeed(bps: number | null | undefined): string {
  if (!bps || bps < 1) return "—";
  return `${formatBytes(bps)}/s`;
}

export function formatEta(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs)) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 99) return "> 99 giờ";
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export type FileKind = "video" | "audio" | "archive" | "document" | "program" | "image" | "other";

const KINDS: Record<Exclude<FileKind, "other">, string[]> = {
  video: ["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "mpg", "mpeg"],
  audio: ["mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma"],
  archive: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "img", "dmg", "tgz"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "epub", "csv", "odt"],
  program: ["exe", "msi", "apk", "deb", "rpm", "appimage", "pkg", "msix", "bin", "run"],
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tiff", "heic"],
};

export function fileKind(name: string): FileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  for (const [kind, exts] of Object.entries(KINDS)) {
    if (exts.includes(ext)) return kind as FileKind;
  }
  return "other";
}

export function isProbablyUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}
