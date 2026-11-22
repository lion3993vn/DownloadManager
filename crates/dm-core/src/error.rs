use crate::types::DownloadId;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("server responded with HTTP {0}")]
    Status(u16),
    /// 429 / 503: too many connections or temporarily overloaded.
    #[error("server is busy (HTTP {status})")]
    Busy {
        status: u16,
        retry_after: Option<u64>,
    },
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("server stopped honoring range requests")]
    RangeNotSupported,
    #[error("download {0} not found")]
    NotFound(DownloadId),
    #[error("invalid URL: {0}")]
    InvalidUrl(String),
    #[error("no data received for too long (read timeout)")]
    Timeout,
    #[error("connection closed before the segment was complete")]
    Incomplete,
    /// A video page was given but yt-dlp is not installed (the app offers to install it).
    #[error("media tools (yt-dlp) are not installed")]
    MediaToolsMissing,
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;
