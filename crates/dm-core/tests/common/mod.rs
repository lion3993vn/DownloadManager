//! In-process HTTP server with configurable misbehaviour, for engine tests.
//!
//! Routes (all serve the same deterministic payload):
//! - `/file`        range support, Content-Length
//! - `/norange`     ignores `Range`, always 200
//! - `/chunked`     ignores `Range`, no Content-Length
//! - `/flaky`       range support, but every response aborts after 300 KB
//! - `/slow`        range support, throttled (~2 MB/s per connection)
//! - `/versioned`   range support, ETag + body change after `GET /bump`
//! - `/attachment`  Content-Disposition file name
//! - `/limited`     range support, but 429 beyond 2 concurrent connections
//! - `/rangeforbidden` 403 for any request with a `Range` header
//! - `/hls/{name}`  HLS fixtures over a separate payload (see [`serve_hls`])
//! - anything else  404

#![allow(dead_code)]

use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use bytes::Bytes;
use dm_core::{DownloadId, DownloadInfo, Engine, EngineEvent, EngineSettings, Status};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::Receiver;

#[derive(Clone)]
struct Srv {
    v1: Arc<Vec<u8>>,
    v2: Arc<Vec<u8>>,
    version: Arc<AtomicU64>,
    range_requests: Arc<AtomicU64>,
    concurrent: Arc<AtomicU64>,
    rejected: Arc<AtomicU64>,
    hls: Arc<Hls>,
}

/// Decrements the concurrent-connection counter when the body is dropped.
struct ConnGuard(Arc<AtomicU64>);
impl Drop for ConnGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

pub struct TestServer {
    pub base: String,
    srv: Srv,
}

impl TestServer {
    pub fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }
    pub fn data(&self) -> &[u8] {
        &self.srv.v1
    }
    pub fn data_v2(&self) -> &[u8] {
        &self.srv.v2
    }
    pub fn range_requests(&self) -> u64 {
        self.srv.range_requests.load(Ordering::SeqCst)
    }
    pub fn rejected(&self) -> u64 {
        self.srv.rejected.load(Ordering::SeqCst)
    }
    /// What every HLS fixture decodes to.
    pub fn hls_data(&self) -> &[u8] {
        &self.srv.hls.data
    }
    pub fn hls_init(&self) -> &[u8] {
        HLS_INIT
    }
    pub fn hls_segment_requests(&self) -> u64 {
        self.srv.hls.segment_requests.load(Ordering::SeqCst)
    }
}

fn payload(size: usize, seed: u32) -> Vec<u8> {
    // xorshift so that misplaced bytes are always detected.
    let mut x = 0x9E37_79B9u32 ^ seed;
    (0..size)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            x as u8
        })
        .collect()
}

pub async fn start(size: usize) -> TestServer {
    let srv = Srv {
        v1: Arc::new(payload(size, 1)),
        v2: Arc::new(payload(size, 2)),
        version: Arc::new(AtomicU64::new(1)),
        range_requests: Arc::new(AtomicU64::new(0)),
        concurrent: Arc::new(AtomicU64::new(0)),
        rejected: Arc::new(AtomicU64::new(0)),
        hls: Arc::new(Hls::new(size)),
    };
    let app = Router::new()
        .route("/bump", get(bump))
        .route("/hls/{name}", get(serve_hls))
        .route("/{mode}", get(serve))
        .with_state(srv.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    TestServer {
        base: format!("http://{addr}"),
        srv,
    }
}

async fn bump(State(s): State<Srv>) -> &'static str {
    s.version.store(2, Ordering::SeqCst);
    "ok"
}

fn parse_range(headers: &HeaderMap, len: u64) -> Option<(u64, u64)> {
    let v = headers.get(header::RANGE)?.to_str().ok()?;
    let spec = v.strip_prefix("bytes=")?;
    let (a, b) = spec.split_once('-')?;
    let start: u64 = a.parse().ok()?;
    let end: u64 = if b.is_empty() {
        len - 1
    } else {
        b.parse::<u64>().ok()?.min(len - 1)
    };
    (start <= end).then_some((start, end))
}

#[derive(Default)]
struct BodyOpts {
    abort_after: Option<usize>,
    delay_per_chunk: Option<Duration>,
    guard: Option<Arc<ConnGuard>>,
}

fn stream_body(data: Arc<Vec<u8>>, start: usize, end_excl: usize, opts: BodyOpts) -> Body {
    const CHUNK: usize = 16 * 1024;
    let state = (start, 0usize);
    let stream = futures_util::stream::unfold(state, move |(pos, sent)| {
        let data = data.clone();
        let abort_after = opts.abort_after;
        let delay = opts.delay_per_chunk;
        // Keep the connection counted until the body stream is dropped.
        let guard = opts.guard.clone();
        async move {
            let _guard = guard;
            if pos >= end_excl {
                return None;
            }
            if abort_after.is_some_and(|limit| sent >= limit) {
                let err =
                    std::io::Error::new(std::io::ErrorKind::ConnectionReset, "simulated drop");
                return Some((Err(err), (end_excl, sent)));
            }
            if let Some(d) = delay {
                tokio::time::sleep(d).await;
            }
            let n = CHUNK.min(end_excl - pos);
            let chunk = Bytes::copy_from_slice(&data[pos..pos + n]);
            Some((Ok::<_, std::io::Error>(chunk), (pos + n, sent + n)))
        }
    });
    Body::from_stream(stream)
}

async fn serve(State(s): State<Srv>, Path(mode): Path<String>, headers: HeaderMap) -> Response {
    let data = if mode == "versioned" && s.version.load(Ordering::SeqCst) == 2 {
        s.v2.clone()
    } else {
        s.v1.clone()
    };
    let len = data.len() as u64;
    let (ranges, chunked, opts) = match mode.as_str() {
        "file" | "attachment" | "versioned" => (true, false, BodyOpts::default()),
        "norange" => (false, false, BodyOpts::default()),
        "chunked" => (false, true, BodyOpts::default()),
        "rangeforbidden" if headers.contains_key(header::RANGE) => {
            return StatusCode::FORBIDDEN.into_response()
        }
        "rangeforbidden" => (false, false, BodyOpts::default()),
        "flaky" => (
            true,
            false,
            BodyOpts {
                abort_after: Some(300 * 1024),
                ..Default::default()
            },
        ),
        "slow" => (
            true,
            false,
            BodyOpts {
                delay_per_chunk: Some(Duration::from_millis(8)),
                ..Default::default()
            },
        ),
        "limited" => {
            if s.concurrent.fetch_add(1, Ordering::SeqCst) >= 2 {
                s.concurrent.fetch_sub(1, Ordering::SeqCst);
                s.rejected.fetch_add(1, Ordering::SeqCst);
                return (StatusCode::TOO_MANY_REQUESTS, [(header::RETRY_AFTER, "1")])
                    .into_response();
            }
            let guard = Some(Arc::new(ConnGuard(s.concurrent.clone())));
            let opts = BodyOpts {
                delay_per_chunk: Some(Duration::from_millis(2)),
                guard,
                ..Default::default()
            };
            (true, false, opts)
        }
        _ => return StatusCode::NOT_FOUND.into_response(),
    };

    let mut resp_headers = HeaderMap::new();
    if mode == "versioned" {
        let etag = format!("\"v{}\"", s.version.load(Ordering::SeqCst));
        resp_headers.insert(header::ETAG, HeaderValue::from_str(&etag).unwrap());
    }
    if mode == "attachment" {
        resp_headers.insert(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment; filename=\"report final.bin\""),
        );
    }

    let range = if ranges {
        parse_range(&headers, len)
    } else {
        None
    };
    match range {
        Some((start, end)) => {
            s.range_requests.fetch_add(1, Ordering::SeqCst);
            resp_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
            resp_headers.insert(
                header::CONTENT_RANGE,
                HeaderValue::from_str(&format!("bytes {start}-{end}/{len}")).unwrap(),
            );
            resp_headers.insert(header::CONTENT_LENGTH, (end - start + 1).into());
            let body = stream_body(data, start as usize, end as usize + 1, opts);
            (StatusCode::PARTIAL_CONTENT, resp_headers, body).into_response()
        }
        None => {
            if !chunked {
                resp_headers.insert(header::CONTENT_LENGTH, len.into());
            }
            let body = stream_body(data, 0, len as usize, opts);
            (StatusCode::OK, resp_headers, body).into_response()
        }
    }
}

pub fn settings(dir: &std::path::Path) -> EngineSettings {
    EngineSettings {
        download_dir: dir.to_path_buf(),
        connections: 8,
        min_segment_size: 128 * 1024,
        max_retries: 5,
        ..Default::default()
    }
}

/// Wait until download `id` satisfies `pred`, failing after 30 s.
pub async fn wait_for(
    engine: &Engine,
    events: &mut Receiver<EngineEvent>,
    id: DownloadId,
    pred: impl Fn(&DownloadInfo) -> bool,
) -> DownloadInfo {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(d) = engine.get(id) {
            if pred(&d) {
                return d;
            }
        }
        if tokio::time::timeout_at(deadline, events.recv())
            .await
            .is_err()
        {
            panic!("timed out waiting; last state: {:?}", engine.get(id))
        }
    }
}

pub async fn wait_done(
    engine: &Engine,
    events: &mut Receiver<EngineEvent>,
    id: DownloadId,
) -> DownloadInfo {
    let d = wait_for(engine, events, id, |d| {
        matches!(
            d.status,
            Status::Completed | Status::Failed | Status::Canceled
        )
    })
    .await;
    assert_eq!(
        d.status,
        Status::Completed,
        "download ended with error: {:?}",
        d.error
    );
    d
}

/// Wait until at least `bytes` have been received (by progress events).
pub async fn wait_progress(events: &mut Receiver<EngineEvent>, id: DownloadId, bytes: u64) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        match tokio::time::timeout_at(deadline, events.recv()).await {
            Err(_) => panic!("timed out waiting for progress"),
            Ok(Ok(EngineEvent::Progress { progress }))
                if progress.id == id && progress.downloaded >= bytes =>
            {
                return
            }
            Ok(_) => {}
        }
    }
}

/// Wait until the engine has no running task for `id` any more.
pub async fn wait_idle(engine: &Engine, id: DownloadId) {
    for _ in 0..400 {
        if !engine.is_running(id) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("task for {id} did not stop");
}

// ---------------------------------------------------------------------------
// HLS fixtures
// ---------------------------------------------------------------------------

const HLS_SEGMENTS: usize = 12;
const HLS_KEY: [u8; 16] = *b"0123456789abcdef";
const HLS_IV: [u8; 16] = [7; 16];
/// First encrypted segment's media sequence number (implicit IV).
const HLS_SEQ: u64 = 5;
const HLS_INIT: &[u8] = b"fake-init-section";

struct Hls {
    data: Vec<u8>,
    /// `bounds[i]..bounds[i + 1]` is segment `i`; sizes vary on purpose.
    bounds: Vec<usize>,
    segment_requests: AtomicU64,
}

impl Hls {
    fn new(size: usize) -> Self {
        let data = payload(size, 3);
        let weights: Vec<usize> = (0..HLS_SEGMENTS).map(|i| 3 + (i * 7) % 5).collect();
        let sum: usize = weights.iter().sum();
        let mut bounds = vec![0];
        let mut acc = 0;
        for w in &weights[..HLS_SEGMENTS - 1] {
            acc += w;
            bounds.push(size * acc / sum);
        }
        bounds.push(size);
        Hls {
            data,
            bounds,
            segment_requests: AtomicU64::new(0),
        }
    }

    fn segment(&self, i: usize) -> &[u8] {
        &self.data[self.bounds[i]..self.bounds[i + 1]]
    }

    /// Segments 0..6 use the explicit IV, the rest the sequence-number IV.
    fn encrypted(&self, i: usize) -> Vec<u8> {
        use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
        let iv = if i < HLS_SEGMENTS / 2 {
            HLS_IV
        } else {
            u128::from(HLS_SEQ + i as u64).to_be_bytes()
        };
        cbc::Encryptor::<aes::Aes128>::new(&HLS_KEY.into(), &iv.into())
            .encrypt_padded_vec_mut::<Pkcs7>(self.segment(i))
    }

    fn media(&self, prefix: &str, ended: bool) -> String {
        let mut s = String::from("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n");
        for i in 0..HLS_SEGMENTS {
            s += &format!("#EXTINF:4.0,\n{prefix}{i}.ts\n");
        }
        if ended {
            s += "#EXT-X-ENDLIST\n";
        }
        s
    }
}

fn playlist(body: String) -> Response {
    (
        [(header::CONTENT_TYPE, "application/vnd.apple.mpegurl")],
        body,
    )
        .into_response()
}

/// - `master.m3u8`   two variants; only the 720p one (`media.m3u8`) exists
/// - `media.m3u8`    12 plain segments `seg{i}.ts`
/// - `noext`         same as `media.m3u8` but without the `.m3u8` extension
/// - `slow.m3u8`     same segments, throttled (for pause / resume)
/// - `enc.m3u8`      AES-128 (explicit IV, then sequence-number IV), key at `key`
/// - `fmp4.m3u8`     init section `init.mp4` + the plain segments
/// - `range.m3u8`    byte ranges into the single resource `all.bin`
/// - `live.m3u8`     no `#EXT-X-ENDLIST`
async fn serve_hls(State(s): State<Srv>, Path(name): Path<String>, headers: HeaderMap) -> Response {
    let h = &s.hls;
    let n = HLS_SEGMENTS;
    let seg_index = |prefix: &str| -> Option<usize> {
        let i: usize = name
            .strip_prefix(prefix)?
            .strip_suffix(".ts")?
            .parse()
            .ok()?;
        (i < n).then_some(i)
    };
    if let Some(i) = seg_index("seg") {
        h.segment_requests.fetch_add(1, Ordering::SeqCst);
        return Bytes::copy_from_slice(h.segment(i)).into_response();
    }
    if let Some(i) = seg_index("slow") {
        h.segment_requests.fetch_add(1, Ordering::SeqCst);
        let data = Arc::new(h.segment(i).to_vec());
        let len = data.len();
        let opts = BodyOpts {
            delay_per_chunk: Some(Duration::from_millis(60)),
            ..Default::default()
        };
        return stream_body(data, 0, len, opts).into_response();
    }
    if let Some(i) = seg_index("enc") {
        h.segment_requests.fetch_add(1, Ordering::SeqCst);
        return h.encrypted(i).into_response();
    }
    match name.as_str() {
        "master.m3u8" => playlist(
            "#EXTM3U\n\
             #EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=640x360\nlow.m3u8\n\
             #EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\nmedia.m3u8\n"
                .into(),
        ),
        "media.m3u8" | "noext" => playlist(h.media("seg", true)),
        "slow.m3u8" => playlist(h.media("slow", true)),
        "live.m3u8" => playlist(h.media("seg", false)),
        "fmp4.m3u8" => {
            let body = h.media("seg", true).replacen(
                "#EXT-X-TARGETDURATION:4\n",
                "#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI=\"init.mp4\"\n",
                1,
            );
            playlist(body)
        }
        "init.mp4" => Bytes::from_static(HLS_INIT).into_response(),
        "enc.m3u8" => {
            let iv: String = HLS_IV.iter().map(|b| format!("{b:02x}")).collect();
            let mut body = format!(
                "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:{HLS_SEQ}\n\
                 #EXT-X-KEY:METHOD=AES-128,URI=\"key\",IV=0x{iv}\n"
            );
            for i in 0..n {
                if i == n / 2 {
                    body += "#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n";
                }
                body += &format!("#EXTINF:4.0,\nenc{i}.ts\n");
            }
            body += "#EXT-X-ENDLIST\n";
            playlist(body)
        }
        "key" => Bytes::from_static(&HLS_KEY).into_response(),
        "range.m3u8" => {
            let mut body = String::from("#EXTM3U\n#EXT-X-VERSION:4\n#EXT-X-TARGETDURATION:4\n");
            for i in 0..n {
                let (a, b) = (h.bounds[i], h.bounds[i + 1]);
                // Every other segment leaves the offset implicit.
                if i % 2 == 0 {
                    body += &format!("#EXTINF:4.0,\n#EXT-X-BYTERANGE:{}@{a}\nall.bin\n", b - a);
                } else {
                    body += &format!("#EXTINF:4.0,\n#EXT-X-BYTERANGE:{}\nall.bin\n", b - a);
                }
            }
            body += "#EXT-X-ENDLIST\n";
            playlist(body)
        }
        "all.bin" => {
            h.segment_requests.fetch_add(1, Ordering::SeqCst);
            let len = h.data.len() as u64;
            match parse_range(&headers, len) {
                Some((a, b)) => (
                    StatusCode::PARTIAL_CONTENT,
                    [(header::CONTENT_RANGE, format!("bytes {a}-{b}/{len}"))],
                    Bytes::copy_from_slice(&h.data[a as usize..=b as usize]),
                )
                    .into_response(),
                None => Bytes::copy_from_slice(&h.data).into_response(),
            }
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}
