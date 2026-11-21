import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Status = "queued" | "downloading" | "paused" | "completed" | "failed" | "canceled";

export interface SegmentInfo {
  start: number;
  end: number;
  done: number;
}

export interface DownloadInfo {
  id: number;
  url: string;
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
}

export interface ProbeResult {
  totalSize: number | null;
  resumable: boolean;
  fileName: string;
  contentType: string | null;
  finalUrl: string;
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
}

export interface Settings {
  engine: EngineSettings;
  app: AppSettings;
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
}

export interface PairRequest {
  id: number;
  origin: string;
  browser: string;
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
};

export const onEngineEvent = (cb: (e: EngineEvent) => void): Promise<UnlistenFn> =>
  listen<EngineEvent>("dm://event", (e) => cb(e.payload));

export const onCapture = (cb: () => void): Promise<UnlistenFn> => listen("dm://capture", () => cb());

export const onPairRequest = (cb: (r: PairRequest) => void): Promise<UnlistenFn> =>
  listen<PairRequest>("dm://pair-request", (e) => cb(e.payload));
