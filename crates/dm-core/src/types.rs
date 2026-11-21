use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub type DownloadId = i64;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Canceled,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Queued => "queued",
            Status::Downloading => "downloading",
            Status::Paused => "paused",
            Status::Completed => "completed",
            Status::Failed => "failed",
            Status::Canceled => "canceled",
        }
    }

    pub fn parse(s: &str) -> Status {
        match s {
            "queued" => Status::Queued,
            "downloading" => Status::Downloading,
            "paused" => Status::Paused,
            "completed" => Status::Completed,
            "canceled" => Status::Canceled,
            _ => Status::Failed,
        }
    }
}

/// Extra request context, usually captured from the browser so that
/// authenticated / hot-link protected downloads keep working.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestHeaders {
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
    /// Raw `Cookie` header value (`a=1; b=2`).
    pub cookies: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDownload {
    pub url: String,
    /// Explicit file name. When `None` the name is derived from the server response.
    pub file_name: Option<String>,
    /// Target directory. When `None` the engine's default directory is used.
    pub save_dir: Option<PathBuf>,
    /// Number of parallel connections. When `None` the engine default is used.
    pub connections: Option<u32>,
    #[serde(default)]
    pub headers: RequestHeaders,
    /// Add to the list without starting.
    #[serde(default)]
    pub start_paused: bool,
}

/// One byte range `[start, end)` of the file and how much of it is on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentInfo {
    pub start: u64,
    pub end: u64,
    pub done: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadInfo {
    pub id: DownloadId,
    pub url: String,
    pub file_name: String,
    pub save_dir: PathBuf,
    pub total_size: Option<u64>,
    pub downloaded: u64,
    pub status: Status,
    pub error: Option<String>,
    /// Whether the server supports range requests (pause/resume + multi-connection).
    pub resumable: bool,
    pub connections: u32,
    /// Unix epoch milliseconds.
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub segments: Vec<SegmentInfo>,
    #[serde(skip)]
    pub headers: RequestHeaders,
    #[serde(skip)]
    pub etag: Option<String>,
    #[serde(skip)]
    pub last_modified: Option<String>,
    /// File name was guessed from the URL and may be replaced by the server's name.
    #[serde(skip)]
    pub auto_name: bool,
}

impl DownloadInfo {
    pub fn file_path(&self) -> PathBuf {
        self.save_dir.join(&self.file_name)
    }

    pub fn part_path(&self) -> PathBuf {
        self.save_dir
            .join(format!("{}.{}.dmpart", self.file_name, self.id))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub id: DownloadId,
    pub downloaded: u64,
    pub total_size: Option<u64>,
    /// Bytes per second (smoothed).
    pub speed: f64,
    pub eta_secs: Option<u64>,
    pub active_connections: u32,
    pub segments: Vec<SegmentInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEvent {
    Added { download: DownloadInfo },
    Updated { download: DownloadInfo },
    Progress { progress: Progress },
    Removed { id: DownloadId },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineSettings {
    pub download_dir: PathBuf,
    /// Parallel connections per download.
    pub connections: u32,
    /// Downloads running at the same time; the rest wait in the queue.
    pub max_concurrent: u32,
    /// Global speed limit in bytes/second, 0 = unlimited.
    pub speed_limit: u64,
    /// Segments are never planned or split smaller than this.
    pub min_segment_size: u64,
    /// Consecutive failures a connection tolerates before giving up.
    pub max_retries: u32,
}

impl Default for EngineSettings {
    fn default() -> Self {
        Self {
            download_dir: default_download_dir(),
            connections: 8,
            max_concurrent: 3,
            speed_limit: 0,
            min_segment_size: 1024 * 1024,
            max_retries: 5,
        }
    }
}

pub const MAX_CONNECTIONS: u32 = 32;

fn default_download_dir() -> PathBuf {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    home.join("Downloads")
}

/// Result of inspecting a URL before downloading.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub total_size: Option<u64>,
    pub resumable: bool,
    /// Name suggested by the server (Content-Disposition) or the URL.
    pub file_name: String,
    pub content_type: Option<String>,
    pub final_url: String,
    #[serde(skip)]
    pub etag: Option<String>,
    #[serde(skip)]
    pub last_modified: Option<String>,
    #[serde(skip)]
    pub name_from_server: bool,
}
