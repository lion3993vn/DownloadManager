//! The actual byte transfer of one download: probe, segmented parallel
//! download with dynamic work stealing (or a single stream when the server
//! does not support ranges), progress reporting and finalisation.

use crate::engine::Inner;
use crate::error::{Error, Result};
use crate::http;
use crate::naming;
use crate::planner::plan_segments;
use crate::storage::remove_part;
use crate::storage::{open_part_file, write_all_at};
use crate::types::{DownloadId, DownloadInfo, DownloadKind, Progress, SegmentInfo};
use futures_util::StreamExt;
use reqwest::header::RANGE;
use reqwest::StatusCode;
use std::fs::File;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

/// Bytes buffered per connection before they are written to disk.
const WRITE_BUFFER: usize = 512 * 1024;
/// A connection that receives nothing for this long is dropped and retried.
pub(crate) const READ_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
pub(crate) const PERSIST_INTERVAL: Duration = Duration::from_secs(1);
/// Marks the end of a single-stream download whose size is unknown.
const UNKNOWN_END: u64 = u64::MAX;

pub(crate) enum Outcome {
    Completed,
    Stopped,
}

pub(crate) async fn run(
    inner: Arc<Inner>,
    id: DownloadId,
    token: CancellationToken,
) -> Result<Outcome> {
    let mut info = inner.snapshot(id)?;
    if info.kind == DownloadKind::Hls {
        return crate::hls::run(inner, info, token).await;
    }
    if info.kind == DownloadKind::Media {
        return crate::media::run(inner, info, token).await;
    }
    let settings = inner.settings();

    // 1. Probe the server (also validates that a resume is still safe).
    let mut attempt = 0;
    let probe = loop {
        let r = tokio::select! {
            _ = token.cancelled() => return Ok(Outcome::Stopped),
            r = http::probe(&inner.client, &info.url, &info.headers) => r,
        };
        attempt += 1;
        match r {
            Ok(p) => break p,
            Err(e @ (Error::Busy { .. } | Error::Http(_) | Error::Timeout))
                if attempt <= settings.max_retries =>
            {
                tracing::debug!(id, error = %e, attempt, "probe failed, retrying");
                backoff(attempt, retry_after(&e), &token).await;
                if token.is_cancelled() {
                    return Ok(Outcome::Stopped);
                }
            }
            Err(e) => return Err(e),
        }
    };
    // A playlist served without the `.m3u8` extension: download it as HLS.
    if crate::hls::is_playlist(&probe) {
        remove_part(&info.part_path());
        info.kind = DownloadKind::Hls;
        info.segments.clear();
        info.downloaded = 0;
        inner.commit(&info);
        return crate::hls::run(inner, info, token).await;
    }
    let remote_changed = info.total_size != probe.total_size
        || differs(&info.etag, &probe.etag)
        || differs(&info.last_modified, &probe.last_modified);
    let fresh_start = info.segments.is_empty() || !probe.resumable || remote_changed;
    if fresh_start {
        if !info.segments.is_empty() {
            tracing::info!(
                id,
                "remote file changed or not resumable, restarting from zero"
            );
        }
        // Remove the old partial file under its current name before renaming.
        let _ = std::fs::remove_file(info.part_path());
        info.segments.clear();
        info.downloaded = 0;
        if info.auto_name && probe.name_from_server && probe.file_name != info.file_name {
            info.file_name = inner.unique_name(id, &info.save_dir, &probe.file_name);
        }
    }
    info.total_size = probe.total_size;
    info.resumable = probe.resumable;
    info.etag = probe.etag;
    info.last_modified = probe.last_modified;
    info.auto_name = false;
    let connections = info.connections.max(1);
    if info.segments.is_empty() {
        info.segments = match (info.resumable, info.total_size) {
            (true, Some(total)) => plan_segments(total, connections, settings.min_segment_size)
                .into_iter()
                .map(|(start, end)| SegmentInfo {
                    start,
                    end,
                    done: 0,
                })
                .collect(),
            _ => Vec::new(),
        };
    }
    inner.commit(&info);

    // 2. Transfer.
    let part_path = info.part_path();
    let segmented = info.resumable && info.total_size.is_some_and(|t| t > 0);
    let size_hint = if segmented { info.total_size } else { None };
    let file = {
        let path = part_path.clone();
        let truncate = !segmented;
        tokio::task::spawn_blocking(move || open_part_file(&path, size_hint, truncate))
            .await
            .map_err(join_error)??
    };

    let segs: Vec<Seg> = if segmented {
        info.segments.iter().map(Seg::from_info).collect()
    } else {
        let end = info.total_size.unwrap_or(UNKNOWN_END);
        vec![Seg {
            start: 0,
            end,
            pos: 0,
            flushed: 0,
            active: false,
        }]
    };
    let ctx = Arc::new(Ctx {
        inner: inner.clone(),
        url: info.url.clone(),
        headers: info.headers.clone(),
        file: Arc::new(file),
        segs: Mutex::new(segs),
        min_steal: (settings.min_segment_size / 2).max(64 * 1024),
        max_retries: settings.max_retries,
        active: AtomicU32::new(0),
        alive: AtomicU32::new(if segmented { connections } else { 1 }),
    });

    let mut workers = JoinSet::new();
    if segmented {
        for _ in 0..connections {
            workers.spawn(segment_worker(ctx.clone(), token.clone()));
        }
    } else {
        workers.spawn(single_stream_worker(ctx.clone(), token.clone()));
    }

    let mut first_error: Option<Error> = None;
    let mut ticker = tokio::time::interval(PROGRESS_INTERVAL);
    let mut speed = SpeedMeter::new(ctx.received());
    let mut last_persist = Instant::now();
    loop {
        tokio::select! {
            joined = workers.join_next() => match joined {
                None => break,
                Some(Ok(Ok(()))) => {}
                Some(Ok(Err(e))) => {
                    tracing::warn!(id, error = %e, "connection gave up");
                    first_error.get_or_insert(e);
                }
                Some(Err(e)) => { first_error.get_or_insert(join_error(e)); }
            },
            _ = ticker.tick() => {
                let received = ctx.received();
                let bps = speed.update(received);
                inner.emit_progress(ctx.progress(id, &info, received, bps));
                if last_persist.elapsed() >= PERSIST_INTERVAL {
                    last_persist = Instant::now();
                    ctx.write_back(&mut info);
                    inner.commit_quiet(&info);
                }
            }
        }
    }

    // 3. Wrap up. All workers have exited, so we hold the only file handle.
    let complete = ctx.is_complete();
    let received = ctx.flushed_total();
    if !segmented && complete {
        info.total_size = Some(received);
    }
    ctx.write_back(&mut info);
    drop(ctx);

    if complete {
        finalize(&inner, &mut info).await?;
        return Ok(Outcome::Completed);
    }
    if !segmented {
        // Without range support a partial file is useless.
        info.segments.clear();
        info.downloaded = 0;
        let _ = std::fs::remove_file(&part_path);
    }
    inner.commit_quiet(&info);
    if token.is_cancelled() {
        return Ok(Outcome::Stopped);
    }
    Err(first_error.unwrap_or(Error::Incomplete))
}

pub(crate) async fn finalize(inner: &Inner, info: &mut DownloadInfo) -> Result<()> {
    let part = info.part_path();
    let dir = info.save_dir.clone();
    let name = info.file_name.clone();
    let final_path = tokio::task::spawn_blocking(move || -> std::io::Result<_> {
        let target = naming::unique_path(&dir, &name);
        std::fs::rename(&part, &target)?;
        Ok(target)
    })
    .await
    .map_err(join_error)??;
    if let Some(name) = final_path.file_name() {
        info.file_name = name.to_string_lossy().into_owned();
    }
    info.downloaded = info.total_size.unwrap_or(info.downloaded);
    info.segments.clear();
    inner.commit_quiet(info);
    Ok(())
}

fn differs(old: &Option<String>, new: &Option<String>) -> bool {
    matches!((old, new), (Some(a), Some(b)) if a != b)
}

pub(crate) fn join_error(e: tokio::task::JoinError) -> Error {
    Error::Other(format!("internal task failed: {e}"))
}

/// Mutable state of one byte range while downloading.
#[derive(Debug, Clone)]
struct Seg {
    start: u64,
    /// Exclusive end; may shrink when another connection steals the tail.
    end: u64,
    /// Bytes received up to here (some may still be buffered in memory).
    pos: u64,
    /// Bytes written to disk up to here.
    flushed: u64,
    /// A connection currently owns this segment.
    active: bool,
}

impl Seg {
    fn from_info(s: &SegmentInfo) -> Self {
        let p = s.start + s.done;
        Seg {
            start: s.start,
            end: s.end,
            pos: p,
            flushed: p,
            active: false,
        }
    }
}

struct Ctx {
    inner: Arc<Inner>,
    url: String,
    headers: crate::types::RequestHeaders,
    file: Arc<File>,
    segs: Mutex<Vec<Seg>>,
    min_steal: u64,
    max_retries: u32,
    /// Connections currently transferring.
    active: AtomicU32,
    /// Worker tasks still running.
    alive: AtomicU32,
}

impl Ctx {
    /// Leave the pool if at least one other worker remains to finish the job.
    fn try_shed(&self) -> bool {
        let mut n = self.alive.load(Ordering::SeqCst);
        while n > 1 {
            match self
                .alive
                .compare_exchange(n, n - 1, Ordering::SeqCst, Ordering::SeqCst)
            {
                Ok(_) => return true,
                Err(current) => n = current,
            }
        }
        false
    }

    /// Pick work: an idle unfinished segment, or else split the largest
    /// remaining active segment in half and take its tail (work stealing).
    fn claim(&self) -> Option<usize> {
        let mut segs = self.segs.lock().unwrap();
        if let Some(i) = segs.iter().position(|s| !s.active && s.pos < s.end) {
            segs[i].active = true;
            return Some(i);
        }
        let (i, remaining) = segs
            .iter()
            .enumerate()
            .filter(|(_, s)| s.active)
            .map(|(i, s)| (i, s.end - s.pos))
            .max_by_key(|&(_, r)| r)?;
        if remaining < 2 * self.min_steal {
            return None;
        }
        let mid = segs[i].pos + remaining / 2;
        let end = segs[i].end;
        segs[i].end = mid;
        segs.push(Seg {
            start: mid,
            end,
            pos: mid,
            flushed: mid,
            active: true,
        });
        Some(segs.len() - 1)
    }

    /// Give a segment back after a failure; unflushed bytes are re-downloaded.
    fn release(&self, idx: usize) {
        let mut segs = self.segs.lock().unwrap();
        let s = &mut segs[idx];
        s.active = false;
        s.pos = s.flushed;
    }

    fn received(&self) -> u64 {
        self.segs
            .lock()
            .unwrap()
            .iter()
            .map(|s| s.pos - s.start)
            .sum()
    }

    fn flushed_total(&self) -> u64 {
        self.segs
            .lock()
            .unwrap()
            .iter()
            .map(|s| s.flushed - s.start)
            .sum()
    }

    fn is_complete(&self) -> bool {
        self.segs.lock().unwrap().iter().all(|s| s.flushed >= s.end)
    }

    fn segment_infos(segs: &[Seg], total: Option<u64>, use_pos: bool) -> Vec<SegmentInfo> {
        let mut out: Vec<SegmentInfo> = segs
            .iter()
            .map(|s| {
                let end = if s.end == UNKNOWN_END {
                    total.unwrap_or(s.pos)
                } else {
                    s.end
                };
                let p = if use_pos { s.pos } else { s.flushed };
                SegmentInfo {
                    start: s.start,
                    end,
                    done: p - s.start,
                }
            })
            .collect();
        out.sort_by_key(|s| s.start);
        out
    }

    /// Copy the on-disk state into `info` (what is safe to resume from).
    fn write_back(&self, info: &mut DownloadInfo) {
        let segs = self.segs.lock().unwrap();
        info.segments = Self::segment_infos(&segs, info.total_size, false);
        info.downloaded = segs.iter().map(|s| s.flushed - s.start).sum();
    }

    fn progress(&self, id: DownloadId, info: &DownloadInfo, received: u64, speed: f64) -> Progress {
        let segs = self.segs.lock().unwrap();
        let eta_secs = info
            .total_size
            .filter(|_| speed > 1.0)
            .map(|t| (t.saturating_sub(received) as f64 / speed).ceil() as u64);
        Progress {
            id,
            downloaded: received,
            total_size: info.total_size,
            speed,
            eta_secs,
            active_connections: self.active.load(Ordering::Relaxed),
            segments: Self::segment_infos(&segs, info.total_size, true),
        }
    }

    async fn flush(&self, idx: usize, buf: &mut Vec<u8>, buf_start: &mut u64) -> Result<()> {
        if buf.is_empty() {
            return Ok(());
        }
        let data = std::mem::replace(buf, Vec::with_capacity(WRITE_BUFFER));
        let len = data.len() as u64;
        let file = self.file.clone();
        let offset = *buf_start;
        tokio::task::spawn_blocking(move || write_all_at(&file, &data, offset))
            .await
            .map_err(join_error)??;
        *buf_start += len;
        self.segs.lock().unwrap()[idx].flushed = *buf_start;
        Ok(())
    }

    /// Stream the response into segment `idx` until the segment is done,
    /// the stream ends, or we are cancelled. Always flushes what it received.
    async fn pump(
        &self,
        idx: usize,
        resp: reqwest::Response,
        token: &CancellationToken,
    ) -> Result<()> {
        let mut buf_start = self.segs.lock().unwrap()[idx].pos;
        let mut buf = Vec::with_capacity(WRITE_BUFFER);
        let mut stream = resp.bytes_stream();
        let result = loop {
            let next = tokio::select! {
                _ = token.cancelled() => break Ok(()),
                n = tokio::time::timeout(READ_TIMEOUT, stream.next()) => n,
            };
            let chunk = match next {
                Err(_) => break Err(Error::Timeout),
                Ok(None) => {
                    let s = &self.segs.lock().unwrap()[idx];
                    break if s.end == UNKNOWN_END || s.pos >= s.end {
                        Ok(())
                    } else {
                        Err(Error::Incomplete)
                    };
                }
                Ok(Some(Err(e))) => break Err(e.into()),
                Ok(Some(Ok(c))) => c,
            };
            // Clip to the current end: the tail may have been stolen meanwhile.
            let (take, finished) = {
                let mut segs = self.segs.lock().unwrap();
                let s = &mut segs[idx];
                let take = (s.end - s.pos).min(chunk.len() as u64) as usize;
                s.pos += take as u64;
                (take, s.pos >= s.end)
            };
            buf.extend_from_slice(&chunk[..take]);
            self.inner.limiter.acquire(take as u64).await;
            if finished {
                break Ok(());
            }
            if buf.len() >= WRITE_BUFFER {
                if let Err(e) = self.flush(idx, &mut buf, &mut buf_start).await {
                    break Err(e);
                }
            }
        };
        let flushed = self.flush(idx, &mut buf, &mut buf_start).await;
        result.and(flushed)
    }
}

/// One parallel connection: keeps claiming / stealing segments until no work is left.
async fn segment_worker(ctx: Arc<Ctx>, token: CancellationToken) -> Result<()> {
    let (result, shed) = segment_worker_loop(&ctx, &token).await;
    if !shed {
        ctx.alive.fetch_sub(1, Ordering::SeqCst);
    }
    result
}

/// Returns the result and whether the worker already left via [`Ctx::try_shed`].
async fn segment_worker_loop(ctx: &Ctx, token: &CancellationToken) -> (Result<()>, bool) {
    let mut failures = 0u32;
    while !token.is_cancelled() {
        let Some(idx) = ctx.claim() else {
            return (Ok(()), false);
        };
        let before = ctx.segs.lock().unwrap()[idx].flushed;
        ctx.active.fetch_add(1, Ordering::Relaxed);
        let result = fetch_segment(ctx, idx, token).await;
        ctx.active.fetch_sub(1, Ordering::Relaxed);
        let after = ctx.segs.lock().unwrap()[idx].flushed;
        match result {
            Ok(()) => {
                failures = 0;
                ctx.segs.lock().unwrap()[idx].active = false;
            }
            Err(e) => {
                ctx.release(idx);
                if token.is_cancelled() {
                    return (Ok(()), false);
                }
                if matches!(e, Error::RangeNotSupported | Error::Status(400..=499)) {
                    return (Err(e), false);
                }
                // Server limits connections per client: drop this connection and
                // let the remaining ones take over its segment.
                if matches!(e, Error::Busy { .. }) && ctx.try_shed() {
                    tracing::info!(error = %e, "server busy, reducing connections");
                    return (Ok(()), true);
                }
                failures = if after > before { 1 } else { failures + 1 };
                if failures > ctx.max_retries {
                    return (Err(e), false);
                }
                tracing::debug!(error = %e, failures, "segment failed, retrying");
                backoff(failures, retry_after(&e), token).await;
            }
        }
    }
    (Ok(()), false)
}

async fn fetch_segment(ctx: &Ctx, idx: usize, token: &CancellationToken) -> Result<()> {
    let (pos, end) = {
        let s = &ctx.segs.lock().unwrap()[idx];
        (s.pos, s.end)
    };
    if pos >= end {
        return Ok(());
    }
    let req = http::request(&ctx.inner.client, &ctx.url, &ctx.headers)
        .header(RANGE, format!("bytes={}-{}", pos, end - 1));
    let resp = tokio::select! {
        _ = token.cancelled() => return Ok(()),
        r = req.send() => r?,
    };
    match resp.status() {
        StatusCode::PARTIAL_CONTENT => {}
        StatusCode::OK => return Err(Error::RangeNotSupported),
        _ => return Err(http::status_error(&resp)),
    }
    if http::content_range_start(resp.headers()).is_some_and(|start| start != pos) {
        return Err(Error::RangeNotSupported);
    }
    ctx.pump(idx, resp, token).await
}

/// Servers without range support: one connection, restart from zero on failure.
async fn single_stream_worker(ctx: Arc<Ctx>, token: CancellationToken) -> Result<()> {
    let mut failures = 0u32;
    loop {
        {
            let mut segs = ctx.segs.lock().unwrap();
            segs[0].pos = 0;
            segs[0].flushed = 0;
            segs[0].active = true;
        }
        let req = http::request(&ctx.inner.client, &ctx.url, &ctx.headers);
        let result = async {
            let resp = tokio::select! {
                _ = token.cancelled() => return Ok(()),
                r = req.send() => r?,
            };
            if !resp.status().is_success() {
                return Err(http::status_error(&resp));
            }
            ctx.active.fetch_add(1, Ordering::Relaxed);
            let r = ctx.pump(0, resp, &token).await;
            ctx.active.fetch_sub(1, Ordering::Relaxed);
            r
        }
        .await;
        match result {
            Ok(()) => {
                if !token.is_cancelled() {
                    // Stream ended normally: whatever we got is the whole file.
                    let mut segs = ctx.segs.lock().unwrap();
                    if segs[0].end == UNKNOWN_END {
                        segs[0].end = segs[0].flushed;
                    }
                }
                return Ok(());
            }
            Err(e) => {
                if token.is_cancelled() {
                    return Ok(());
                }
                failures += 1;
                if failures > ctx.max_retries || matches!(e, Error::Status(400..=499)) {
                    return Err(e);
                }
                backoff(failures, retry_after(&e), &token).await;
            }
        }
    }
}

pub(crate) fn retry_after(e: &Error) -> Option<Duration> {
    match e {
        Error::Busy { retry_after, .. } => {
            Some(Duration::from_secs(retry_after.unwrap_or(2).clamp(1, 60)))
        }
        _ => None,
    }
}

pub(crate) async fn backoff(
    failures: u32,
    retry_after: Option<Duration>,
    token: &CancellationToken,
) {
    let exp = Duration::from_millis(500 * 2u64.pow(failures.saturating_sub(1).min(5)));
    let delay = retry_after
        .unwrap_or(Duration::ZERO)
        .max(exp.min(Duration::from_secs(15)));
    tokio::select! {
        _ = token.cancelled() => {}
        _ = tokio::time::sleep(delay) => {}
    }
}

/// Exponentially smoothed bytes/second.
pub(crate) struct SpeedMeter {
    last_bytes: u64,
    last_time: Instant,
    speed: f64,
}

impl SpeedMeter {
    pub(crate) fn new(bytes: u64) -> Self {
        Self {
            last_bytes: bytes,
            last_time: Instant::now(),
            speed: 0.0,
        }
    }

    pub(crate) fn update(&mut self, bytes: u64) -> f64 {
        let now = Instant::now();
        let dt = now.duration_since(self.last_time).as_secs_f64();
        if dt > 0.0 {
            let instant = bytes.saturating_sub(self.last_bytes) as f64 / dt;
            self.speed = if self.speed == 0.0 {
                instant
            } else {
                self.speed * 0.7 + instant * 0.3
            };
        }
        self.last_bytes = bytes;
        self.last_time = now;
        self.speed
    }
}
