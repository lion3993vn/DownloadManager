import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Status = "queued" | "downloading" | "paused" | "completed" | "failed" | "canceled";

export interface SegmentInfo {
  start: number;
  end: number;
  done: number;
}

export type DownloadKind = "file" | "hls" | "media";

export interface DownloadInfo {
  id: number;
  url: string;
  kind: DownloadKind;
  /** Quality picked for a video page (`media`). */
  mediaQuality: string | null;
  fileName: string;
  saveDir: string;
  totalSize: number | null;
  downloaded: number;
  status: Status;
  error: string | null;
  resumable: boolean;
  connections: number;
  createdAt: number;
  completedAt: number | null;
  segments: SegmentInfo[];
}

export interface Progress {
  id: number;
  downloaded: number;
  totalSize: number | null;
  speed: number;
  etaSecs: number | null;
  activeConnections: number;
  segments: SegmentInfo[];
}

export type EngineEvent =
  | { type: "added"; download: DownloadInfo }
  | { type: "updated"; download: DownloadInfo }
  | { type: "progress"; progress: Progress }
  | { type: "removed"; id: number };

export interface RequestHeaders {
  referrer?: string | null;
  userAgent?: string | null;
  cookies?: string | null;
}

export interface NewDownload {
  url: string;
  fileName?: string | null;
  saveDir?: string | null;
  connections?: number | null;
  headers?: RequestHeaders;
  startPaused?: boolean;
  kind?: DownloadKind | null;
  mediaQuality?: string | null;
}

export interface ProbeResult {
  totalSize: number | null;
  resumable: boolean;
  fileName: string;
  contentType: string | null;
  finalUrl: string;
  stream: StreamInfo | null;
  media: MediaInfo | null;
}

/** A video page described by yt-dlp (see `dm_core::MediaInfo`). */
export interface MediaInfo {
  title: string;
  site: string;
  uploader: string | null;
  durationSecs: number | null;
  thumbnail: string | null;
  isLive: boolean;
  /** Best first; the last one is audio only (`id: "audio"`). */
  qualities: MediaQuality[];
  needsFfmpegForBest: boolean;
}

export interface MediaQuality {
  id: string;
  label: string;
  estimatedSize: number | null;
}

export interface ToolsStatus {
  ytdlpVersion: string | null;
  ffmpeg: boolean;
  ffmpegFromSystem: boolean;
  canInstallFfmpeg: boolean;
  busy: boolean;
  installSize: number;
}

export interface ToolsProgress {
  step: "yt-dlp" | "ffmpeg" | "extract" | "update";
  downloaded: number;
  total: number | null;
}

/** The engine error when a video page needs yt-dlp first. */
export const isMediaToolsMissing = (e: unknown) => /media tools/i.test(String(e));

/** An HLS video stream (see `dm_core::StreamInfo`). */
export interface StreamInfo {
  durationSecs: number;
  segments: number;
  resolution: [number, number] | null;
  bandwidth: number | null;
  estimatedSize: number | null;
  live: boolean;
  encrypted: boolean;
  container: string;
}

export interface EngineSettings {
  downloadDir: string;
  connections: number;
  maxConcurrent: number;
  speedLimit: number;
  minSegmentSize: number;
  maxRetries: number;
}

export interface AppSettings {
  bridgeToken: string;
  bridgePort: number;
  confirmCaptures: boolean;
  closeToTray: boolean;
  /** UI language preference: "auto" (follow the OS), "vi" or "en". */
  language: string;
}

export interface Settings {
  engine: EngineSettings;
  app: AppSettings;
  /** Launch at login (read from the OS). */
  autostart: boolean;
}

export interface BridgeStatus {
  running: boolean;
  port: number;
  error: string | null;
}

export interface Capture extends RequestHeaders {
  id: number;
  url: string;
  fileName?: string | null;
  fileSize?: number | null;
  mime?: string | null;
  kind?: DownloadKind | null;
}

export interface PairRequest {
  id: number;
  origin: string;
  browser: string;
}

export interface BrowserInfo {
  id: string;
  name: string;
  engine: "chromium" | "firefox";
  extensionsUrl: string;
}

export interface ExtensionSetupInfo {
  folder: string;
  manifestPath: string;
  browsers: BrowserInfo[];
}

export interface ConnectedExtension {
  origin: string;
  browser: string;
  lastSeen: number;
  /** `null`: an old extension that does not report its version. */
  version: string | null;
}

export interface AvailableUpdate {
  version: string;
  date: string | null;
  notes: string | null;
}

export interface UpdateStatus {
  currentVersion: string;
  available: AvailableUpdate | null;
}

export interface ReleaseInfo {
  version: string;
  name: string;
  notes: string;
  publishedAt: string | null;
  url: string;
  prerelease: boolean;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export const api = {
  list: () => invoke<DownloadInfo[]>("list_downloads"),
  add: (request: NewDownload) => invoke<DownloadInfo>("add_download", { request }),
  probe: (url: string, headers?: RequestHeaders) => invoke<ProbeResult>("probe_url", { url, headers }),
  pause: (id: number) => invoke<void>("pause_download", { id }),
  resume: (id: number) => invoke<void>("resume_download", { id }),
  cancel: (id: number) => invoke<void>("cancel_download", { id }),
  remove: (id: number, deleteFile: boolean) => invoke<void>("remove_download", { id, deleteFile }),
  pauseAll: () => invoke<void>("pause_all"),
  resumeAll: () => invoke<void>("resume_all"),
  openFile: (id: number) => invoke<void>("open_file", { id }),
  showInFolder: (id: number) => invoke<void>("show_in_folder", { id }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  regenerateToken: () => invoke<string>("regenerate_token"),
  bridgeStatus: () => invoke<BridgeStatus>("bridge_status"),
  takeCaptures: () => invoke<Capture[]>("take_captures"),
  pendingPairRequests: () => invoke<PairRequest[]>("pending_pair_requests"),
  answerPairRequest: (id: number, approve: boolean) => invoke<void>("answer_pair_request", { id, approve }),
  extensionSetupInfo: () => invoke<ExtensionSetupInfo>("extension_setup_info"),
  connectedExtensions: () => invoke<ConnectedExtension[]>("connected_extensions"),
  extensionVersion: () => invoke<string | null>("extension_version"),
  mediaToolsStatus: () => invoke<ToolsStatus>("media_tools_status"),
  installMediaTools: () => invoke<ToolsStatus>("install_media_tools"),
  updateMediaTools: () => invoke<ToolsStatus>("update_media_tools"),
  removeMediaTools: () => invoke<void>("remove_media_tools"),
  openBrowserExtensions: (browserId: string) => invoke<void>("open_browser_extensions", { browserId }),
  revealExtensionFolder: () => invoke<void>("reveal_extension_folder"),
  checkUpdate: () => invoke<UpdateStatus>("check_update"),
  installUpdate: () => invoke<void>("install_update"),
  listReleases: () => invoke<ReleaseInfo[]>("list_releases"),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
};

export const onEngineEvent = (cb: (e: EngineEvent) => void): Promise<UnlistenFn> =>
  listen<EngineEvent>("dm://event", (e) => cb(e.payload));

export const onCapture = (cb: () => void): Promise<UnlistenFn> => listen("dm://capture", () => cb());

export const onPairRequest = (cb: (r: PairRequest) => void): Promise<UnlistenFn> =>
  listen<PairRequest>("dm://pair-request", (e) => cb(e.payload));

export const onExtensionConnected = (cb: (e: ConnectedExtension) => void): Promise<UnlistenFn> =>
  listen<ConnectedExtension>("dm://extension-connected", (e) => cb(e.payload));

export const onToolsProgress = (cb: (p: ToolsProgress) => void): Promise<UnlistenFn> =>
  listen<ToolsProgress>("dm://tools-progress", (e) => cb(e.payload));

export const onExtensionUpdated = (cb: (e: ConnectedExtension) => void): Promise<UnlistenFn> =>
  listen<ConnectedExtension>("dm://extension-updated", (e) => cb(e.payload));

export const onUpdateAvailable = (cb: (u: AvailableUpdate) => void): Promise<UnlistenFn> =>
  listen<AvailableUpdate>("dm://update-available", (e) => cb(e.payload));

export const onUpdateProgress = (cb: (p: UpdateProgress) => void): Promise<UnlistenFn> =>
  listen<UpdateProgress>("dm://update-progress", (e) => cb(e.payload));

export const onUpdateInstalling = (cb: () => void): Promise<UnlistenFn> => listen("dm://update-installing", () => cb());

/** Compare dotted versions numerically: >0 if a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Browsers whose extension is older than the one bundled with the app. Only the
 * most recently seen extension of each browser counts, so a removed old copy
 * does not keep warning forever.
 */
export function outdatedExtensions(list: ConnectedExtension[], bundled: string | null): ConnectedExtension[] {
  if (!bundled) return [];
  const latest = new Map<string, ConnectedExtension>();
  for (const e of list) {
    const known = latest.get(e.browser);
    if (!known || e.lastSeen > known.lastSeen) latest.set(e.browser, e);
  }
  return [...latest.values()].filter((e) => !e.version || compareVersions(bundled, e.version) > 0);
}
