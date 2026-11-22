//! HLS (HTTP Live Streaming) downloads.
//!
//! A VOD playlist lists media segments that are independent HTTP resources, so
//! they are fetched in parallel (one per connection) into a segment folder next
//! to the part file and joined in order at the end. MPEG-TS segments join into
//! a playable `.ts`; fMP4 segments with an `EXT-X-MAP` init section join into a
//! fragmented `.mp4`. Nothing is remuxed, so no ffmpeg is needed.
//!
//! Resume: every finished segment is a file `NNNNN.seg` in the folder, so a
//! restart only fetches the missing ones.

use crate::engine::Inner;
use crate::error::{Error, Result};
use crate::http;
use crate::storage::{part_dir, remove_part};
use crate::transfer::{self, Outcome, SpeedMeter};
use crate::types::{
    DownloadInfo, DownloadKind, ProbeResult, Progress, RequestHeaders, SegmentInfo, StreamInfo,
};
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use futures_util::StreamExt;
use reqwest::header::RANGE;
use reqwest::{Client, StatusCode, Url};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

const MAX_PLAYLIST_BYTES: usize = 16 * 1024 * 1024;
const MAX_SEGMENT_BYTES: usize = 512 * 1024 * 1024;
/// Written into the segment folder; a mismatch means the folder is stale.
const MANIFEST: &str = "manifest";
const INIT_FILE: &str = "init.seg";
/// Most segment-progress bars the UI gets (segments are grouped beyond that).
const MAX_BARS: usize = 64;

// ---------------------------------------------------------------------------
// Detection and naming
// ---------------------------------------------------------------------------

/// `.m3u8` URLs are HLS playlists.
pub(crate) fn kind_from_url(url: &str) -> DownloadKind {
    match Url::parse(url) {
        Ok(u) if u.path().to_ascii_lowercase().ends_with(".m3u8") => DownloadKind::Hls,
        _ => DownloadKind::File,
    }
}

/// Whether a probed URL turned out to be an HLS playlist.
pub(crate) fn is_playlist(probe: &ProbeResult) -> bool {
    let mpegurl = probe
        .content_type
        .as_deref()
        .is_some_and(|t| t.to_ascii_lowercase().contains("mpegurl"));
    mpegurl || kind_from_url(&probe.final_url) == DownloadKind::Hls
}

/// `"index.m3u8"` -> `"index.ts"`, `"Phim hay"` -> `"Phim hay.ts"`.
pub(crate) fn output_name(name: &str, ext: &str) -> String {
    const REPLACE: &[&str] = &[
        "m3u8", "m3u", "ts", "mp4", "m4v", "mkv", "webm", "mov", "flv",
    ];
    let stem = match name.rsplit_once('.') {
        Some((stem, e)) if REPLACE.contains(&e.to_ascii_lowercase().as_str()) => stem,
        _ => name,
    };
    let stem = stem.trim();
    let stem = if stem.is_empty() { "video" } else { stem };
    format!("{stem}.{ext}")
}

// ---------------------------------------------------------------------------
// Playlist model and parser
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
struct ByteRange {
    offset: u64,
    len: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Resource {
    uri: String,
    range: Option<ByteRange>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Key {
    uri: String,
    /// When absent the IV is the segment's media sequence number.
    iv: Option<[u8; 16]>,
}

#[derive(Debug, Clone)]
struct Segment {
    res: Resource,
    duration: f64,
    key: Option<Key>,
    seq: u64,
}

#[derive(Debug, Default)]
struct MediaPlaylist {
    segments: Vec<Segment>,
    /// Init section (fMP4) that precedes every segment.
    map: Option<Resource>,
    /// Has an end (VOD); live playlists keep growing and cannot be downloaded.
    ended: bool,
}

impl MediaPlaylist {
    fn container(&self) -> &'static str {
        if self.map.is_some() {
            "mp4"
        } else {
            "ts"
        }
    }

    fn duration(&self) -> f64 {
        self.segments.iter().map(|s| s.duration).sum()
    }
}

#[derive(Debug, Clone)]
struct Variant {
    uri: String,
    bandwidth: Option<u64>,
    resolution: Option<(u32, u32)>,
    audio_group: Option<String>,
}

enum Playlist {
    Master {
        variants: Vec<Variant>,
        /// Audio groups whose renditions are separate playlists (not muxed).
        external_audio: HashSet<String>,
    },
    Media(MediaPlaylist),
}

fn not_hls() -> Error {
    Error::Other("not an HLS playlist".into())
}

fn join_url(base: &Url, uri: &str) -> Result<String> {
    base.join(uri)
        .map(String::from)
        .map_err(|e| Error::InvalidUrl(format!("{uri}: {e}")))
}

/// `KEY=value,QUOTED="a,b"` -> map with upper-case keys and unquoted values.
fn attributes(s: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut rest = s.trim();
    while let Some(eq) = rest.find('=') {
        let name = rest[..eq].trim().to_ascii_uppercase();
        rest = &rest[eq + 1..];
        let value = if let Some(quoted) = rest.strip_prefix('"') {
            let end = quoted.find('"').unwrap_or(quoted.len());
            let value = quoted[..end].to_string();
            let after = quoted.get(end + 1..).unwrap_or("");
            rest = after.find(',').map_or("", |i| &after[i + 1..]);
            value
        } else {
            let end = rest.find(',').unwrap_or(rest.len());
            let value = rest[..end].trim().to_string();
            rest = rest.get(end + 1..).unwrap_or("");
            value
        };
        out.insert(name, value);
        rest = rest.trim_start();
    }
    out
}

/// `"1000@200"` -> (1000, Some(200)); `"1000"` -> (1000, None).
fn byte_range(s: &str) -> Option<(u64, Option<u64>)> {
    match s.trim().split_once('@') {
        Some((len, off)) => Some((len.trim().parse().ok()?, Some(off.trim().parse().ok()?))),
        None => Some((s.trim().parse().ok()?, None)),
    }
}

fn parse_iv(s: &str) -> Option<[u8; 16]> {
    let hex = s
        .trim()
        .strip_prefix("0x")
        .or_else(|| s.trim().strip_prefix("0X"))?;
    u128::from_str_radix(hex, 16).ok().map(u128::to_be_bytes)
}

fn parse_resolution(s: &str) -> Option<(u32, u32)> {
    let (w, h) = s.trim().split_once(['x', 'X'])?;
    Some((w.parse().ok()?, h.parse().ok()?))
}

fn parse(text: &str, base: &Url) -> Result<Playlist> {
    let mut lines = text
        .trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty());
    if !lines.next().is_some_and(|l| l.starts_with("#EXTM3U")) {
        return Err(not_hls());
    }

    let mut variants = Vec::new();
    let mut external_audio = HashSet::new();
    let mut pending_variant: Option<Variant> = None;

    let mut media = MediaPlaylist::default();
    let mut seq = 0u64;
    let mut duration: Option<f64> = None;
    let mut pending_range: Option<(u64, Option<u64>)> = None;
    let mut prev_range_end: Option<(String, u64)> = None;
    let mut key: Option<Key> = None;
    let mut unsupported_method: Option<String> = None;

    for line in lines {
        let Some(tag_line) = line.strip_prefix('#') else {
            let uri = join_url(base, line)?;
            if let Some(mut v) = pending_variant.take() {
                v.uri = uri;
                variants.push(v);
                continue;
            }
            if let Some(method) = &unsupported_method {
                return Err(Error::Other(format!(
                    "the stream is protected with {method} (DRM) and cannot be downloaded"
                )));
            }
            let range = pending_range.take().map(|(len, offset)| {
                let offset = offset.unwrap_or(match &prev_range_end {
                    Some((u, end)) if *u == uri => *end,
                    _ => 0,
                });
                ByteRange { offset, len }
            });
            if let Some(r) = &range {
                prev_range_end = Some((uri.clone(), r.offset + r.len));
            }
            media.segments.push(Segment {
                res: Resource { uri, range },
                duration: duration.take().unwrap_or(0.0),
                key: key.clone(),
                seq,
            });
            seq += 1;
            continue;
        };
        let (tag, value) = tag_line.split_once(':').unwrap_or((tag_line, ""));
        match tag {
            "EXT-X-STREAM-INF" => {
                let a = attributes(value);
                pending_variant = Some(Variant {
                    uri: String::new(),
                    bandwidth: a.get("BANDWIDTH").and_then(|b| b.parse().ok()),
                    resolution: a.get("RESOLUTION").and_then(|r| parse_resolution(r)),
                    audio_group: a.get("AUDIO").cloned(),
                });
            }
            "EXT-X-MEDIA" => {
                let a = attributes(value);
                if a.get("TYPE").is_some_and(|t| t == "AUDIO") && a.contains_key("URI") {
                    if let Some(group) = a.get("GROUP-ID") {
                        external_audio.insert(group.clone());
                    }
                }
            }
            "EXT-X-MEDIA-SEQUENCE" => seq = value.trim().parse().unwrap_or(0),
            "EXTINF" => {
                duration = Some(
                    value
                        .split(',')
                        .next()
                        .and_then(|d| d.trim().parse().ok())
                        .unwrap_or(0.0),
                );
            }
            "EXT-X-BYTERANGE" => pending_range = byte_range(value),
            "EXT-X-KEY" => {
                let a = attributes(value);
                unsupported_method = None;
                key = None;
                match a.get("METHOD").map(String::as_str) {
                    None | Some("NONE") => {}
                    Some("AES-128") => {
                        let uri = a
                            .get("URI")
                            .ok_or_else(|| Error::Other("AES-128 key without URI".into()))?;
                        key = Some(Key {
                            uri: join_url(base, uri)?,
                            iv: a.get("IV").and_then(|iv| parse_iv(iv)),
                        });
                    }
                    Some(other) => unsupported_method = Some(other.to_string()),
                }
            }
            "EXT-X-MAP" => {
                let a = attributes(value);
                let uri = a
                    .get("URI")
                    .ok_or_else(|| Error::Other("EXT-X-MAP without URI".into()))?;
                let range = a
                    .get("BYTERANGE")
                    .and_then(|r| byte_range(r))
                    .map(|(len, off)| ByteRange {
                        offset: off.unwrap_or(0),
                        len,
                    });
                let res = Resource {
                    uri: join_url(base, uri)?,
                    range,
                };
                match &media.map {
                    None => media.map = Some(res),
                    Some(m) if *m == res => {}
                    Some(_) => {
                        return Err(Error::Other(
                            "the playlist switches init sections, which is not supported".into(),
                        ))
                    }
                }
            }
            "EXT-X-ENDLIST" => media.ended = true,
            "EXT-X-PLAYLIST-TYPE" if value.trim() == "VOD" => media.ended = true,
            _ => {}
        }
    }

    if variants.is_empty() {
        Ok(Playlist::Media(media))
    } else {
        Ok(Playlist::Master {
            variants,
            external_audio,
        })
    }
}

/// Best quality whose audio is muxed in (separate audio would need remuxing).
fn pick_variant<'a>(
    variants: &'a [Variant],
    external_audio: &HashSet<String>,
) -> Result<&'a Variant> {
    variants
        .iter()
        .filter(|v| {
            v.audio_group
                .as_ref()
                .is_none_or(|g| !external_audio.contains(g))
        })
        .max_by_key(|v| {
            (
                v.resolution.map_or(0, |(w, h)| u64::from(w) * u64::from(h)),
                v.bandwidth.unwrap_or(0),
            )
        })
        .ok_or_else(|| {
            Error::Other("the audio is a separate stream, which is not supported yet".into())
        })
}

// ---------------------------------------------------------------------------
// Fetching playlists
// ---------------------------------------------------------------------------

/// Cookies belong to the site the user downloaded from: never send them to
/// other hosts (segments and keys are often on a CDN).
fn scoped_headers(origin: &Url, target: &str, headers: &RequestHeaders) -> RequestHeaders {
    let same_host = Url::parse(target).is_ok_and(|t| {
        t.host_str() == origin.host_str()
            && t.port_or_known_default() == origin.port_or_known_default()
    });
    let mut h = headers.clone();
    if !same_host {
        h.cookies = None;
    }
    h
}

async fn fetch_text(client: &Client, url: &str, headers: &RequestHeaders) -> Result<(String, Url)> {
    let resp = http::request(client, url, headers).send().await?;
    if !resp.status().is_success() {
        return Err(http::status_error(&resp));
    }
    let final_url = resp.url().clone();
    if resp
        .content_length()
        .is_some_and(|n| n > MAX_PLAYLIST_BYTES as u64)
    {
        return Err(not_hls());
    }
    let bytes = resp.bytes().await?;
    if bytes.len() > MAX_PLAYLIST_BYTES {
        return Err(not_hls());
    }
    Ok((String::from_utf8_lossy(&bytes).into_owned(), final_url))
}

struct Resolved {
    media: MediaPlaylist,
    variant: Option<Variant>,
}

impl Resolved {
    fn summary(&self) -> StreamInfo {
        let duration = self.media.duration();
        let bandwidth = self.variant.as_ref().and_then(|v| v.bandwidth);
        StreamInfo {
            duration_secs: duration,
            segments: self.media.segments.len() as u32,
            resolution: self.variant.as_ref().and_then(|v| v.resolution),
            bandwidth,
            estimated_size: bandwidth
                .filter(|_| duration > 0.0)
                .map(|b| (b as f64 * duration / 8.0) as u64),
            live: !self.media.ended,
            encrypted: self.media.segments.iter().any(|s| s.key.is_some()),
            container: self.media.container().to_string(),
        }
    }
}

/// Load a playlist; a master playlist is followed to its best variant.
async fn resolve(client: &Client, url: &str, headers: &RequestHeaders) -> Result<Resolved> {
    let origin = Url::parse(url).map_err(|e| Error::InvalidUrl(e.to_string()))?;
    let (text, base) = fetch_text(client, url, headers).await?;
    match parse(&text, &base)? {
        Playlist::Media(media) => Ok(Resolved {
            media,
            variant: None,
        }),
        Playlist::Master {
            variants,
            external_audio,
        } => {
            let variant = pick_variant(&variants, &external_audio)?.clone();
            let h = scoped_headers(&origin, &variant.uri, headers);
            let (text, base) = fetch_text(client, &variant.uri, &h).await?;
            match parse(&text, &base)? {
                Playlist::Media(media) => Ok(Resolved {
                    media,
                    variant: Some(variant),
                }),
                Playlist::Master { .. } => Err(Error::Other(
                    "nested master playlists are not supported".into(),
                )),
            }
        }
    }
}

/// Describe a stream without downloading it.
pub(crate) async fn inspect(
    client: &Client,
    url: &str,
    headers: &RequestHeaders,
) -> Result<StreamInfo> {
    Ok(resolve(client, url, headers).await?.summary())
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

fn seg_path(dir: &Path, i: usize) -> PathBuf {
    dir.join(format!("{i:05}.seg"))
}

/// Identifies the playlist a segment folder belongs to. URLs are left out on
/// purpose: signed CDN URLs change on every load.
fn manifest_for(media: &MediaPlaylist) -> String {
    format!(
        "hls-v1 {} {} {}\n",
        media.segments.len(),
        (media.duration() * 1000.0).round() as u64,
        media.container()
    )
}

pub(crate) async fn run(
    inner: Arc<Inner>,
    mut info: DownloadInfo,
    token: CancellationToken,
) -> Result<Outcome> {
    let settings = inner.settings();
    let origin = Url::parse(&info.url).map_err(|e| Error::InvalidUrl(e.to_string()))?;

    // 1. Playlist, retrying transient failures like the file probe does.
    let mut attempt = 0;
    let resolved = loop {
        let r = tokio::select! {
            _ = token.cancelled() => return Ok(Outcome::Stopped),
            r = resolve(&inner.client, &info.url, &info.headers) => r,
        };
        attempt += 1;
        match r {
            Ok(r) => break r,
            Err(e @ (Error::Busy { .. } | Error::Http(_) | Error::Timeout))
                if attempt <= settings.max_retries =>
            {
                tracing::debug!(id = info.id, error = %e, attempt, "playlist failed, retrying");
                transfer::backoff(attempt, transfer::retry_after(&e), &token).await;
                if token.is_cancelled() {
                    return Ok(Outcome::Stopped);
                }
            }
            Err(e) => return Err(e),
        }
    };
    let estimate_from_bandwidth = resolved.summary().estimated_size;
    let media = resolved.media;
    if !media.ended {
        return Err(Error::Other(
            "live streams cannot be downloaded (the playlist has no end)".into(),
        ));
    }
    if media.segments.is_empty() {
        return Err(Error::Other("the playlist has no segments".into()));
    }

    // 2. Segment folder. Start over when it belongs to another playlist.
    let manifest = manifest_for(&media);
    let mut part = info.part_path();
    let mut dir = part_dir(&part);
    let existing = std::fs::read_to_string(dir.join(MANIFEST)).ok();
    if existing.as_deref() != Some(manifest.as_str()) {
        remove_part(&part);
        info.segments.clear();
        info.downloaded = 0;
        // The container decides the extension; rename while nothing is on disk.
        let wanted = output_name(&info.file_name, media.container());
        if wanted != info.file_name {
            info.file_name = inner.unique_name(info.id, &info.save_dir, &wanted);
            part = info.part_path();
            dir = part_dir(&part);
            remove_part(&part);
        }
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(MANIFEST), &manifest)?;
    }
    info.kind = DownloadKind::Hls;
    info.resumable = true;
    info.auto_name = false;
    info.etag = None;
    info.last_modified = None;

    let n = media.segments.len();
    let (done, done_bytes) = {
        let dir = dir.clone();
        tokio::task::spawn_blocking(move || {
            let mut done = vec![false; n];
            let mut bytes = 0;
            for (i, d) in done.iter_mut().enumerate() {
                if let Ok(m) = std::fs::metadata(seg_path(&dir, i)) {
                    *d = true;
                    bytes += m.len();
                }
            }
            (done, bytes)
        })
        .await
        .map_err(transfer::join_error)?
    };
    let pending: VecDeque<usize> = (0..n).filter(|&i| !done[i]).collect();
    let workers_wanted = (info.connections.max(1) as usize).min(pending.len().max(1));
    let done_count = n - pending.len();

    let job = Arc::new(Job {
        inner: inner.clone(),
        origin,
        headers: info.headers.clone(),
        dir: dir.clone(),
        segments: media.segments,
        queue: Mutex::new(pending),
        done: Mutex::new(done),
        done_bytes: AtomicU64::new(done_bytes),
        done_count: AtomicUsize::new(done_count),
        init_bytes: AtomicU64::new(0),
        inflight: AtomicU64::new(0),
        keys: Mutex::new(HashMap::new()),
        active: AtomicU32::new(0),
        alive: AtomicU32::new(workers_wanted as u32),
        max_retries: settings.max_retries,
        fallback_total: estimate_from_bandwidth,
    });

    // 3. Init section (fMP4) first: tiny, and needed by the final file.
    if let Some(map) = &media.map {
        match job.ensure_init(map, &token).await {
            Ok(true) => {}
            Ok(false) => return Ok(Outcome::Stopped),
            Err(e) => return Err(e),
        }
    }
    job.write_back(&mut info);
    inner.commit(&info);

    // 4. Segments in parallel.
    let mut workers = JoinSet::new();
    for _ in 0..workers_wanted {
        workers.spawn(worker(job.clone(), token.clone()));
    }
    let mut first_error: Option<Error> = None;
    let mut ticker = tokio::time::interval(transfer::PROGRESS_INTERVAL);
    let mut speed = SpeedMeter::new(job.received());
    let mut last_persist = Instant::now();
    loop {
        tokio::select! {
            joined = workers.join_next() => match joined {
                None => break,
                Some(Ok(Ok(()))) => {}
                Some(Ok(Err(e))) => {
                    tracing::warn!(id = info.id, error = %e, "HLS connection gave up");
                    first_error.get_or_insert(e);
                }
                Some(Err(e)) => { first_error.get_or_insert(transfer::join_error(e)); }
            },
            _ = ticker.tick() => {
                let received = job.received();
                let bps = speed.update(received);
                inner.emit_progress(job.progress(info.id, received, bps));
                if last_persist.elapsed() >= transfer::PERSIST_INTERVAL {
                    last_persist = Instant::now();
                    job.write_back(&mut info);
                    inner.commit_quiet(&info);
                }
            }
        }
    }

    // 5. Join the segments, or keep them for the next resume.
    job.write_back(&mut info);
    let complete = job.done_count.load(Ordering::SeqCst) == n;
    let has_init = media.map.is_some();
    drop(job);
    if complete {
        let (dir, part_path) = (dir.clone(), part.clone());
        let size =
            tokio::task::spawn_blocking(move || join_segments(&dir, &part_path, n, has_init))
                .await
                .map_err(transfer::join_error)??;
        info.total_size = Some(size);
        transfer::finalize(&inner, &mut info).await?;
        return Ok(Outcome::Completed);
    }
    inner.commit_quiet(&info);
    if token.is_cancelled() {
        return Ok(Outcome::Stopped);
    }
    Err(first_error.unwrap_or(Error::Incomplete))
}

/// Concatenate init + segments into the part file, deleting each segment once
/// copied so the peak disk usage stays near the final size.
fn join_segments(dir: &Path, part: &Path, n: usize, has_init: bool) -> io::Result<u64> {
    let mut out = io::BufWriter::with_capacity(1024 * 1024, std::fs::File::create(part)?);
    if has_init {
        io::copy(&mut std::fs::File::open(dir.join(INIT_FILE))?, &mut out)?;
    }
    for i in 0..n {
        let path = seg_path(dir, i);
        io::copy(&mut std::fs::File::open(&path)?, &mut out)?;
        let _ = std::fs::remove_file(&path);
    }
    out.flush()?;
    let size = out.get_ref().metadata()?.len();
    drop(out);
    let _ = std::fs::remove_dir_all(dir);
    Ok(size)
}

struct Job {
    inner: Arc<Inner>,
    origin: Url,
    headers: RequestHeaders,
    dir: PathBuf,
    segments: Vec<Segment>,
    /// Segment indices still to fetch.
    queue: Mutex<VecDeque<usize>>,
    done: Mutex<Vec<bool>>,
    /// Bytes of finished segments on disk (including the init section).
    done_bytes: AtomicU64,
    done_count: AtomicUsize,
    init_bytes: AtomicU64,
    /// Bytes received for segments still in flight.
    inflight: AtomicU64,
    keys: Mutex<HashMap<String, [u8; 16]>>,
    /// Connections currently transferring.
    active: AtomicU32,
    /// Worker tasks still running.
    alive: AtomicU32,
    max_retries: u32,
    /// Size guess from the playlist's bandwidth, until real segments arrive.
    fallback_total: Option<u64>,
}

impl Job {
    fn received(&self) -> u64 {
        self.done_bytes.load(Ordering::SeqCst) + self.inflight.load(Ordering::SeqCst)
    }

    /// Average finished segment × segment count, or the bandwidth guess.
    fn estimated_total(&self) -> Option<u64> {
        let count = self.done_count.load(Ordering::SeqCst) as u64;
        let init = self.init_bytes.load(Ordering::SeqCst);
        let n = self.segments.len() as u64;
        if count == 0 {
            return self.fallback_total;
        }
        let seg_bytes = self.done_bytes.load(Ordering::SeqCst).saturating_sub(init);
        if count == n {
            return Some(seg_bytes + init);
        }
        Some(seg_bytes / count * n + init)
    }

    /// Group segments into at most [`MAX_BARS`] ranges of the estimated size,
    /// so the UI's byte-based segment bar can show which parts are done.
    fn bars(&self, total: Option<u64>) -> Vec<SegmentInfo> {
        let Some(total) = total.filter(|&t| t > 0) else {
            return Vec::new();
        };
        let done = self.done.lock().unwrap();
        let n = done.len();
        let k = n.min(MAX_BARS);
        (0..k)
            .map(|b| {
                let (lo, hi) = (b * n / k, (b + 1) * n / k);
                let start = total * lo as u64 / n as u64;
                let end = total * hi as u64 / n as u64;
                let finished = done[lo..hi].iter().filter(|d| **d).count() as u64;
                SegmentInfo {
                    start,
                    end,
                    done: (end - start) * finished / (hi - lo) as u64,
                }
            })
            .collect()
    }

    fn progress(&self, id: i64, received: u64, speed: f64) -> Progress {
        let total = self.estimated_total().map(|t| t.max(received));
        Progress {
            id,
            downloaded: received,
            total_size: total,
            speed,
            eta_secs: total
                .filter(|_| speed > 1.0)
                .map(|t| (t.saturating_sub(received) as f64 / speed).ceil() as u64),
            active_connections: self.active.load(Ordering::Relaxed),
            segments: self.bars(total),
        }
    }

    /// Copy what is safe to resume from into `info`.
    fn write_back(&self, info: &mut DownloadInfo) {
        let done_bytes = self.done_bytes.load(Ordering::SeqCst);
        let total = self.estimated_total().map(|t| t.max(done_bytes));
        info.downloaded = done_bytes;
        info.total_size = total;
        info.segments = self.bars(total);
    }

    /// Leave the pool if at least one other worker remains.
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

    /// GET a resource into memory. `Ok(None)` when cancelled. Received bytes
    /// count as in flight until the caller calls [`Job::settle`].
    async fn download(
        &self,
        res: &Resource,
        token: &CancellationToken,
    ) -> Result<Option<(Vec<u8>, u64)>> {
        let headers = scoped_headers(&self.origin, &res.uri, &self.headers);
        let mut req = http::request(&self.inner.client, &res.uri, &headers);
        if let Some(r) = &res.range {
            req = req.header(
                RANGE,
                format!("bytes={}-{}", r.offset, r.offset + r.len - 1),
            );
        }
        let resp = tokio::select! {
            _ = token.cancelled() => return Ok(None),
            r = req.send() => r?,
        };
        let status = resp.status();
        if !status.is_success() {
            return Err(http::status_error(&resp));
        }
        let capacity = resp.content_length().unwrap_or(0).min(64 * 1024 * 1024) as usize;
        let mut body = Vec::with_capacity(capacity);
        let mut stream = resp.bytes_stream();
        let mut counted = 0u64;
        let result = loop {
            let next = tokio::select! {
                _ = token.cancelled() => break Ok(false),
                n = tokio::time::timeout(transfer::READ_TIMEOUT, stream.next()) => n,
            };
            match next {
                Err(_) => break Err(Error::Timeout),
                Ok(None) => break Ok(true),
                Ok(Some(Err(e))) => break Err(e.into()),
                Ok(Some(Ok(chunk))) => {
                    if body.len() + chunk.len() > MAX_SEGMENT_BYTES {
                        break Err(Error::Other("segment is too large".into()));
                    }
                    body.extend_from_slice(&chunk);
                    counted += chunk.len() as u64;
                    self.inflight
                        .fetch_add(chunk.len() as u64, Ordering::SeqCst);
                    self.inner.limiter.acquire(chunk.len() as u64).await;
                }
            }
        };
        let finished = match result {
            Ok(f) => f,
            Err(e) => {
                self.settle(counted);
                return Err(e);
            }
        };
        if !finished {
            self.settle(counted);
            return Ok(None);
        }
        if let Some(r) = &res.range {
            if status == StatusCode::OK {
                // The server ignored the range and sent the whole resource.
                let start = r.offset as usize;
                let end = start.saturating_add(r.len as usize);
                if end > body.len() {
                    self.settle(counted);
                    return Err(Error::Incomplete);
                }
                body = body[start..end].to_vec();
            } else if body.len() as u64 != r.len {
                self.settle(counted);
                return Err(Error::Incomplete);
            }
        }
        Ok(Some((body, counted)))
    }

    fn settle(&self, counted: u64) {
        self.inflight.fetch_sub(counted, Ordering::SeqCst);
    }

    async fn key(&self, uri: &str, token: &CancellationToken) -> Result<Option<[u8; 16]>> {
        if let Some(k) = self.keys.lock().unwrap().get(uri) {
            return Ok(Some(*k));
        }
        let res = Resource {
            uri: uri.to_string(),
            range: None,
        };
        let Some((data, counted)) = self.download(&res, token).await? else {
            return Ok(None);
        };
        self.settle(counted);
        let key: [u8; 16] = data
            .try_into()
            .map_err(|_| Error::Other("invalid AES-128 key (expected 16 bytes)".into()))?;
        self.keys.lock().unwrap().insert(uri.to_string(), key);
        Ok(Some(key))
    }

    /// Fetch, decrypt and store segment `i`. `Ok(false)` when cancelled.
    async fn fetch(&self, i: usize, token: &CancellationToken) -> Result<bool> {
        let seg = &self.segments[i];
        let decrypt_with = match &seg.key {
            None => None,
            Some(k) => {
                let Some(key) = self.key(&k.uri, token).await? else {
                    return Ok(false);
                };
                Some((
                    key,
                    k.iv.unwrap_or_else(|| u128::from(seg.seq).to_be_bytes()),
                ))
            }
        };
        let Some((data, counted)) = self.download(&seg.res, token).await? else {
            return Ok(false);
        };
        let path = seg_path(&self.dir, i);
        let stored = tokio::task::spawn_blocking(move || -> Result<u64> {
            let data = match decrypt_with {
                Some((key, iv)) => decrypt(&data, &key, &iv)?,
                None => data,
            };
            write_atomic(&path, &data)?;
            Ok(data.len() as u64)
        })
        .await
        .map_err(transfer::join_error)?;
        let stored = match stored {
            Ok(n) => n,
            Err(e) => {
                self.settle(counted);
                return Err(e);
            }
        };
        self.done_bytes.fetch_add(stored, Ordering::SeqCst);
        self.settle(counted);
        self.done.lock().unwrap()[i] = true;
        self.done_count.fetch_add(1, Ordering::SeqCst);
        Ok(true)
    }

    /// Make sure the init section is on disk. `Ok(false)` when cancelled.
    async fn ensure_init(&self, map: &Resource, token: &CancellationToken) -> Result<bool> {
        let path = self.dir.join(INIT_FILE);
        if let Ok(m) = std::fs::metadata(&path) {
            self.init_bytes.store(m.len(), Ordering::SeqCst);
            self.done_bytes.fetch_add(m.len(), Ordering::SeqCst);
            return Ok(true);
        }
        let mut failures = 0;
        loop {
            match self.download(map, token).await {
                Ok(None) => return Ok(false),
                Ok(Some((data, counted))) => {
                    self.settle(counted);
                    let len = data.len() as u64;
                    let p = path.clone();
                    tokio::task::spawn_blocking(move || write_atomic(&p, &data))
                        .await
                        .map_err(transfer::join_error)??;
                    self.init_bytes.store(len, Ordering::SeqCst);
                    self.done_bytes.fetch_add(len, Ordering::SeqCst);
                    return Ok(true);
                }
                Err(e) => {
                    failures += 1;
                    if failures > self.max_retries || matches!(e, Error::Status(400..=499)) {
                        return Err(e);
                    }
                    transfer::backoff(failures, transfer::retry_after(&e), token).await;
                    if token.is_cancelled() {
                        return Ok(false);
                    }
                }
            }
        }
    }
}

fn decrypt(data: &[u8], key: &[u8; 16], iv: &[u8; 16]) -> Result<Vec<u8>> {
    Aes128CbcDec::new(key.into(), iv.into())
        .decrypt_padded_vec_mut::<Pkcs7>(data)
        .map_err(|_| Error::Other("could not decrypt a segment (wrong key?)".into()))
}

/// Write to a temporary name first so a crash never leaves a truncated
/// segment that a resume would mistake for a finished one.
fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

async fn worker(job: Arc<Job>, token: CancellationToken) -> Result<()> {
    let (result, shed) = worker_loop(&job, &token).await;
    if !shed {
        job.alive.fetch_sub(1, Ordering::SeqCst);
    }
    result
}

/// Returns the result and whether the worker already left via [`Job::try_shed`].
async fn worker_loop(job: &Job, token: &CancellationToken) -> (Result<()>, bool) {
    let mut failures = 0u32;
    while !token.is_cancelled() {
        let Some(i) = job.queue.lock().unwrap().pop_front() else {
            return (Ok(()), false);
        };
        job.active.fetch_add(1, Ordering::Relaxed);
        let result = job.fetch(i, token).await;
        job.active.fetch_sub(1, Ordering::Relaxed);
        match result {
            Ok(true) => failures = 0,
            Ok(false) => {
                job.queue.lock().unwrap().push_front(i);
                return (Ok(()), false);
            }
            Err(e) => {
                job.queue.lock().unwrap().push_front(i);
                if token.is_cancelled() {
                    return (Ok(()), false);
                }
                if matches!(e, Error::Status(400..=499)) {
                    return (Err(e), false);
                }
                if matches!(e, Error::Busy { .. }) && job.try_shed() {
                    tracing::info!(error = %e, "server busy, reducing HLS connections");
                    return (Ok(()), true);
                }
                failures += 1;
                if failures > job.max_retries {
                    return (Err(e), false);
                }
                tracing::debug!(error = %e, failures, "HLS segment failed, retrying");
                transfer::backoff(failures, transfer::retry_after(&e), token).await;
            }
        }
    }
    (Ok(()), false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        Url::parse("https://cdn.example.com/video/720p/index.m3u8").unwrap()
    }

    fn media(text: &str) -> MediaPlaylist {
        match parse(text, &base()).unwrap() {
            Playlist::Media(m) => m,
            Playlist::Master { .. } => panic!("expected a media playlist"),
        }
    }

    #[test]
    fn parses_media_playlist() {
        let m = media(
            "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:7\n\
             #EXTINF:9.5,\nseg0.ts\n#EXTINF:10.0,title\n/abs/seg1.ts?t=1\n\
             #EXTINF:4,\nhttps://other.example.com/seg2.ts\n#EXT-X-ENDLIST\n",
        );
        assert!(m.ended);
        assert_eq!(m.container(), "ts");
        assert_eq!(m.segments.len(), 3);
        assert_eq!(
            m.segments[0].res.uri,
            "https://cdn.example.com/video/720p/seg0.ts"
        );
        assert_eq!(
            m.segments[1].res.uri,
            "https://cdn.example.com/abs/seg1.ts?t=1"
        );
        assert_eq!(m.segments[2].res.uri, "https://other.example.com/seg2.ts");
        assert_eq!(m.segments[0].seq, 7);
        assert_eq!(m.segments[2].seq, 9);
        assert!((m.duration() - 23.5).abs() < 1e-9);
    }

    #[test]
    fn live_playlist_has_no_end() {
        let m = media("#EXTM3U\n#EXTINF:6,\na.ts\n#EXTINF:6,\nb.ts\n");
        assert!(!m.ended);
        let vod = media("#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:6,\na.ts\n");
        assert!(vod.ended);
    }

    #[test]
    fn parses_keys_maps_and_byteranges() {
        let m = media(
            "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\",BYTERANGE=\"720@0\"\n\
             #EXT-X-KEY:METHOD=AES-128,URI=\"https://keys.example.com/k?id=1,2\",IV=0x000102030405060708090a0b0c0d0e0f\n\
             #EXTINF:4,\n#EXT-X-BYTERANGE:1000@720\nmain.mp4\n\
             #EXTINF:4,\n#EXT-X-BYTERANGE:500\nmain.mp4\n\
             #EXT-X-KEY:METHOD=NONE\n#EXTINF:4,\nplain.m4s\n#EXT-X-ENDLIST\n",
        );
        assert_eq!(m.container(), "mp4");
        let map = m.map.as_ref().unwrap();
        assert_eq!(map.uri, "https://cdn.example.com/video/720p/init.mp4");
        assert_eq!(
            map.range,
            Some(ByteRange {
                offset: 0,
                len: 720
            })
        );
        let key = m.segments[0].key.as_ref().unwrap();
        assert_eq!(key.uri, "https://keys.example.com/k?id=1,2");
        assert_eq!(key.iv.unwrap()[15], 0x0f);
        assert_eq!(
            m.segments[0].res.range,
            Some(ByteRange {
                offset: 720,
                len: 1000
            })
        );
        // Offset omitted: continues where the previous range of the same URI ended.
        assert_eq!(
            m.segments[1].res.range,
            Some(ByteRange {
                offset: 1720,
                len: 500
            })
        );
        assert!(m.segments[2].key.is_none());
    }

    #[test]
    fn drm_is_rejected() {
        let text = "#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI=\"skd://x\"\n#EXTINF:4,\na.ts\n#EXT-X-ENDLIST\n";
        assert!(parse(text, &base()).is_err());
    }

    #[test]
    fn not_a_playlist() {
        assert!(parse("<html></html>", &base()).is_err());
    }

    #[test]
    fn picks_best_muxed_variant() {
        let text = "#EXTM3U\n\
            #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"aud\",NAME=\"en\",URI=\"audio.m3u8\"\n\
            #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\n360p.m3u8\n\
            #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO=\"aud\"\n1080p-video-only.m3u8\n\
            #EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS=\"avc1.4d401f,mp4a.40.2\"\n720p.m3u8\n";
        let Playlist::Master {
            variants,
            external_audio,
        } = parse(text, &base()).unwrap()
        else {
            panic!("expected a master playlist");
        };
        assert_eq!(variants.len(), 3);
        let best = pick_variant(&variants, &external_audio).unwrap();
        assert_eq!(best.uri, "https://cdn.example.com/video/720p/720p.m3u8");
        assert_eq!(best.resolution, Some((1280, 720)));
        assert_eq!(best.bandwidth, Some(2_800_000));
    }

    #[test]
    fn attribute_lists() {
        let a = attributes("METHOD=AES-128,URI=\"a,b\",IV=0x1F");
        assert_eq!(a["METHOD"], "AES-128");
        assert_eq!(a["URI"], "a,b");
        assert_eq!(a["IV"], "0x1F");
    }

    #[test]
    fn output_names() {
        assert_eq!(output_name("index.m3u8", "ts"), "index.ts");
        assert_eq!(output_name("Phim hay", "ts"), "Phim hay.ts");
        assert_eq!(output_name("Tập 1.5", "mp4"), "Tập 1.5.mp4");
        assert_eq!(output_name("clip.ts", "mp4"), "clip.mp4");
        assert_eq!(output_name(".m3u8", "ts"), "video.ts");
    }

    #[test]
    fn detects_hls_urls() {
        assert_eq!(
            kind_from_url("https://a.com/x/master.M3U8?token=1"),
            DownloadKind::Hls
        );
        assert_eq!(kind_from_url("https://a.com/movie.mp4"), DownloadKind::File);
        assert_eq!(kind_from_url("https://a.com/?f=a.m3u8"), DownloadKind::File);
    }

    #[test]
    fn cookies_stay_on_their_host() {
        let origin = Url::parse("https://site.com/v/index.m3u8").unwrap();
        let h = RequestHeaders {
            cookies: Some("s=1".into()),
            ..Default::default()
        };
        assert!(scoped_headers(&origin, "https://site.com/v/a.ts", &h)
            .cookies
            .is_some());
        assert!(scoped_headers(&origin, "https://cdn.other.com/a.ts", &h)
            .cookies
            .is_none());
    }
}
