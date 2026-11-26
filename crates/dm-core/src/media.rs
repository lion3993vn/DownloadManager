//! Video pages (YouTube, Facebook, TikTok…) downloaded through yt-dlp.
//!
//! Sites like YouTube scramble their stream URLs and change the scheme every
//! few weeks, and serve video and audio as separate streams above 720p.
//! yt-dlp keeps up with that; ffmpeg joins the two streams. Both are external
//! programs the host app installs and hands over with
//! [`crate::Engine::set_media_tools`].
//!
//! A download runs `yt-dlp -J` first (title, chosen formats, size), then the
//! real download into a work folder next to the part file, reading progress
//! from yt-dlp's output. Pausing kills the process tree; yt-dlp resumes its
//! `.part` files on the next run.

use crate::engine::Inner;
use crate::error::{Error, Result};
use crate::naming;
use crate::storage::{part_dir, remove_part};
use crate::transfer::{self, Outcome, SpeedMeter};
use crate::types::{
    DownloadInfo, DownloadKind, MediaInfo, MediaQuality, ProbeResult, Progress, RequestHeaders,
    SegmentInfo,
};
use serde_json::Value;
use std::collections::{BTreeSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio_util::sync::CancellationToken;

/// External programs used for [`DownloadKind::Media`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaTools {
    pub ytdlp: PathBuf,
    /// Without ffmpeg only single files with audio + video can be fetched,
    /// and audio stays in its original format instead of MP3.
    pub ffmpeg: Option<PathBuf>,
}

/// Quality used when none was chosen.
pub const DEFAULT_QUALITY: &str = "1080";
const INSPECT_TIMEOUT: Duration = Duration::from_secs(90);
const TRANSCODE_TIMEOUT: Duration = Duration::from_secs(4 * 3600);
const INFO_FILE: &str = "info.json";
/// Output template inside the work folder: a fixed name so a resume finds
/// yt-dlp's `.part` files again.
const OUTPUT: &str = "video.%(ext)s";

/// Hosts whose links are video pages (pasting one means "download the video").
const SITES: &[&str] = &[
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "tiktok.com",
    "douyin.com",
    "facebook.com",
    "fb.watch",
    "instagram.com",
    "x.com",
    "twitter.com",
    "vimeo.com",
    "dailymotion.com",
    "dai.ly",
    "soundcloud.com",
    "bilibili.com",
    "twitch.tv",
];

pub(crate) fn is_media_site(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(host) = u.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    // Only the site itself and its page subdomains: CDN hosts such as
    // `v16-webapp-prime.tiktok.com` serve raw files, which yt-dlp would just
    // copy (TikTok's are often HEVC).
    let host = PAGE_PREFIXES
        .iter()
        .find_map(|p| host.strip_prefix(p).filter(|rest| SITES.contains(rest)))
        .unwrap_or(host.as_str());
    SITES.contains(&host)
}

/// Subdomains that serve pages (and short links), not media files.
const PAGE_PREFIXES: &[&str] = &[
    "www.", "m.", "mobile.", "web.", "music.", "vm.", "vt.", "v.", "player.", "clips.", "gaming.",
];

// ---------------------------------------------------------------------------
// Formats and names
// ---------------------------------------------------------------------------

/// Format filter dropping HEVC (TikTok's `bytevc1`): Windows only plays it
/// with a paid codec pack, so the file would have sound but no picture.
/// `?` keeps formats whose codec is unknown.
const NO_HEVC: &str = "[vcodec!*=?hev][vcodec!*=?hvc][vcodec!*=?265][vcodec!*=?bytevc1]";

/// HEVC under any of its names (`hev1`, `hvc1`, `h265`, TikTok/Douyin `bytevc1`).
fn is_hevc(vcodec: &str) -> bool {
    let v = vcodec.to_ascii_lowercase();
    v.starts_with("hev") || v.starts_with("hvc") || v.contains("265") || v.contains("bytevc1")
}

/// Video codec of the format(s) yt-dlp chose.
fn chosen_vcodec(info: &Value) -> Option<&str> {
    let parts = info.get("requested_formats").and_then(Value::as_array);
    parts
        .into_iter()
        .flatten()
        .chain(std::iter::once(info))
        .filter_map(|f| str_of(f, "vcodec"))
        .find(|v| *v != "none")
}

/// yt-dlp arguments for a quality, and the extension the result will have.
fn format_args(quality: &str, has_ffmpeg: bool) -> (Vec<String>, &'static str) {
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
    if quality == "audio" {
        return if has_ffmpeg {
            (
                s(&[
                    "-f",
                    "ba/b",
                    "-x",
                    "--audio-format",
                    "mp3",
                    "--audio-quality",
                    "0",
                ]),
                "mp3",
            )
        } else {
            (s(&["-f", "ba[ext=m4a]/ba/b"]), "m4a")
        };
    }
    let height: Option<u32> = quality.parse().ok();
    if has_ffmpeg {
        // Best video up to the height + best audio, merged into MP4. H.264/AAC
        // are preferred at equal resolution: they play everywhere.
        let sort = match height {
            Some(h) => format!("res:{h},vcodec:h264,acodec:aac"),
            None => "res,vcodec:h264,acodec:aac".to_string(),
        };
        // Non-HLS first: with YouTube's DASH formats yt-dlp knows the size and
        // fetches range chunks in parallel (`-N`); HLS has neither. HEVC only
        // when nothing else exists (TikTok offers it at a higher resolution).
        let f = format!("bv*[protocol!*=m3u8]{NO_HEVC}+ba/bv*{NO_HEVC}+ba/bv*+ba/b");
        let mut a = vec!["-f".to_string(), f, "-S".to_string()];
        a.push(sort);
        a.extend(s(&["--merge-output-format", "mp4"]));
        (a, "mp4")
    } else {
        // Only files that already contain both.
        let f = match height {
            Some(h) => {
                format!("b[height<={h}][ext=mp4]{NO_HEVC}/b[height<={h}]{NO_HEVC}/b[height<={h}]/b")
            }
            None => format!("b[ext=mp4]{NO_HEVC}/b{NO_HEVC}/b"),
        };
        (vec!["-f".into(), f], "mp4")
    }
}

const MEDIA_EXTS: &[&str] = &[
    "mp4", "m4v", "mkv", "webm", "mov", "flv", "ts", "mp3", "m4a", "aac", "opus", "ogg", "wav",
];

/// `"Clip.mp4"` + `"mp3"` -> `"Clip.mp3"`; `"Tập 1.5"` + `"mp4"` -> `"Tập 1.5.mp4"`.
pub(crate) fn with_ext(name: &str, ext: &str) -> String {
    let stem = match name.rsplit_once('.') {
        Some((stem, e)) if MEDIA_EXTS.contains(&e.to_ascii_lowercase().as_str()) => stem,
        _ => name,
    };
    let stem = stem.trim();
    let stem = if stem.is_empty() { "video" } else { stem };
    format!("{stem}.{ext}")
}

fn str_of<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str).filter(|s| !s.is_empty())
}

fn num_of(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}

fn size_of(f: &Value) -> Option<u64> {
    num_of(f, "filesize")
        .or_else(|| num_of(f, "filesize_approx"))
        .map(|n| n as u64)
}

fn has_video(f: &Value) -> bool {
    str_of(f, "vcodec") != Some("none") && num_of(f, "height").is_some()
}

fn has_audio(f: &Value) -> bool {
    // Unknown codec (some sites): assume it is a normal file with sound.
    str_of(f, "acodec") != Some("none")
}

fn bucket(height: u32) -> u32 {
    [2160, 1440, 1080, 720, 480, 360]
        .into_iter()
        .find(|&b| height >= b)
        .unwrap_or(240)
}

/// Pickable qualities from yt-dlp's format list.
fn qualities(info: &Value, has_ffmpeg: bool) -> (Vec<MediaQuality>, bool) {
    let formats: Vec<&Value> = info
        .get("formats")
        .and_then(Value::as_array)
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    let audio_only: Vec<&Value> = formats
        .iter()
        .copied()
        .filter(|f| !has_video(f) && has_audio(f) && str_of(f, "acodec").is_some())
        .collect();
    let best_audio = audio_only
        .iter()
        .max_by(|a, b| {
            let r = |f: &Value| num_of(f, "abr").or_else(|| num_of(f, "tbr")).unwrap_or(0.0);
            r(a).total_cmp(&r(b))
        })
        .copied();
    let height = |f: &Value| num_of(f, "height").unwrap_or(0.0) as u32;
    let muxed: Vec<&Value> = formats
        .iter()
        .copied()
        .filter(|f| has_video(f) && has_audio(f))
        .collect();
    let videos: Vec<&Value> = if has_ffmpeg {
        formats.iter().copied().filter(|f| has_video(f)).collect()
    } else {
        muxed.clone()
    };

    let buckets: BTreeSet<u32> = videos.iter().map(|f| bucket(height(f))).collect();
    let mut out: Vec<MediaQuality> = buckets
        .iter()
        .rev()
        .map(|&b| {
            let best = videos
                .iter()
                .filter(|f| bucket(height(f)) <= b)
                .max_by_key(|f| (height(f), num_of(f, "tbr").unwrap_or(0.0) as u64))
                .copied();
            let size = best.and_then(|v| {
                let v_size = size_of(v)?;
                if has_audio(v) && str_of(v, "acodec").is_some() || !has_ffmpeg {
                    Some(v_size)
                } else {
                    Some(v_size + best_audio.and_then(size_of).unwrap_or(0))
                }
            });
            MediaQuality {
                id: b.to_string(),
                label: if b >= 2160 {
                    "4K".into()
                } else {
                    format!("{b}p")
                },
                estimated_size: size,
            }
        })
        .collect();
    if out.is_empty() && !formats.is_empty() && audio_only.len() < formats.len() {
        out.push(MediaQuality {
            id: "best".into(),
            label: "Best".into(),
            estimated_size: None,
        });
    }
    if best_audio.is_some() || !formats.is_empty() {
        out.push(MediaQuality {
            id: "audio".into(),
            label: if has_ffmpeg { "MP3" } else { "Audio (M4A)" }.into(),
            estimated_size: best_audio.and_then(size_of),
        });
    }
    let top = |fs: &[&Value]| fs.iter().map(|f| height(f)).max().unwrap_or(0);
    let all_video: Vec<&Value> = formats.iter().copied().filter(|f| has_video(f)).collect();
    let needs_ffmpeg = !has_ffmpeg && top(&all_video) > top(&muxed);
    (out, needs_ffmpeg)
}

fn describe(info: &Value, has_ffmpeg: bool) -> MediaInfo {
    let (qualities, needs_ffmpeg_for_best) = qualities(info, has_ffmpeg);
    MediaInfo {
        title: str_of(info, "title").unwrap_or("video").to_string(),
        site: str_of(info, "extractor_key")
            .or_else(|| str_of(info, "extractor"))
            .unwrap_or("")
            .to_string(),
        uploader: str_of(info, "uploader")
            .or_else(|| str_of(info, "channel"))
            .map(str::to_owned),
        duration_secs: num_of(info, "duration"),
        thumbnail: str_of(info, "thumbnail").map(str::to_owned),
        is_live: info
            .get("is_live")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        qualities,
        needs_ffmpeg_for_best,
    }
}

/// Size of what `-J -f …` selected (video + audio when merged).
/// Whether yt-dlp fetches the chosen formats as fragments, which `-N`
/// downloads in parallel (plain HTTPS formats use one connection).
fn fragmented(info: &Value) -> bool {
    let parts = match info.get("requested_formats").and_then(Value::as_array) {
        Some(parts) if !parts.is_empty() => parts.iter().collect::<Vec<_>>(),
        _ => vec![info],
    };
    parts
        .iter()
        .any(|f| str_of(f, "protocol").is_some_and(|p| p.contains("dash") || p.contains("m3u8")))
}

fn selected_size(info: &Value) -> Option<u64> {
    match info.get("requested_formats").and_then(Value::as_array) {
        Some(parts) if !parts.is_empty() => parts.iter().map(size_of).sum(),
        _ => size_of(info),
    }
}

// ---------------------------------------------------------------------------
// Running yt-dlp
// ---------------------------------------------------------------------------

fn command(tools: &MediaTools, headers: &RequestHeaders) -> Command {
    let mut c = Command::new(&tools.ytdlp);
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        // Titles are often not ASCII; never let Python pick the console code page.
        .env("PYTHONIOENCODING", "utf-8")
        .args(["--encoding", "utf-8", "--no-playlist", "--no-colors"])
        // Serve YouTube's plain HTTPS formats as range fragments, so `-N`
        // downloads them over several connections (one otherwise).
        .args(["--extractor-args", "youtube:formats=dashy"]);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        // Own process group, so the whole tree (yt-dlp + ffmpeg) can be stopped.
        c.process_group(0);
    }
    if let Some(ffmpeg) = &tools.ffmpeg {
        c.arg("--ffmpeg-location").arg(ffmpeg);
    }
    if let Some(r) = headers.referrer.as_deref().filter(|s| !s.is_empty()) {
        c.args(["--referer", r]);
    }
    // Browser cookies go with the browser's User-Agent: some sites tie them together.
    if let Some(ck) = headers.cookies.as_deref().filter(|s| !s.is_empty()) {
        if let Some(ua) = headers.user_agent.as_deref().filter(|s| !s.is_empty()) {
            c.args(["--user-agent", ua]);
        }
        c.arg("--add-header").arg(format!("Cookie:{ck}"));
    }
    c
}

/// Extract with as little of the browser as works, and return the headers to
/// download with. yt-dlp picks its own client and User-Agent per site; YouTube
/// cookies from a signed-in browser make it fail with "Video unavailable". So
/// the browser's cookies (and User-Agent) are only tried when the plain attempt
/// fails, for pages that need a login.
async fn extract(
    tools: &MediaTools,
    url: &str,
    headers: &RequestHeaders,
    format: &[String],
    token: &CancellationToken,
) -> Result<Option<(Value, RequestHeaders)>> {
    let plain = RequestHeaders {
        referrer: headers.referrer.clone(),
        user_agent: None,
        cookies: None,
    };
    let first = dump_json(tools, url, &plain, format, token).await;
    let has_cookies = headers.cookies.as_deref().is_some_and(|c| !c.is_empty());
    match first {
        Err(e) if has_cookies && !matches!(e, Error::Timeout) => {
            match dump_json(tools, url, headers, format, token).await {
                Ok(v) => Ok(v.map(|v| (v, headers.clone()))),
                // The first error is the one about the video itself.
                Err(_) => Err(e),
            }
        }
        r => Ok(r?.map(|v| (v, plain))),
    }
}

/// Stop yt-dlp and everything it started. The standalone yt-dlp binaries
/// re-launch themselves as a child process, so killing only the direct child
/// would leave the download running.
async fn kill_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .creation_flags(0x0800_0000)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        #[cfg(unix)]
        {
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &format!("-{pid}")])
                .status();
        }
    }
    let _ = child.kill().await;
}

/// The last `ERROR:` line yt-dlp printed, without its prefixes.
fn error_from(stderr: &str) -> Error {
    let line = stderr
        .lines()
        .rev()
        .find(|l| l.starts_with("ERROR:"))
        .or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty()))
        .unwrap_or("yt-dlp failed");
    let msg = line.trim_start_matches("ERROR:").trim();
    // "[youtube] abc123: Video unavailable" -> "Video unavailable"
    let msg = match msg.strip_prefix('[').and_then(|r| r.split_once("] ")) {
        Some((_, rest)) => rest.split_once(": ").map_or(rest, |(_, m)| m),
        None => msg,
    };
    Error::Other(format!("yt-dlp: {msg}"))
}

/// Run yt-dlp to completion and return stdout. `Ok(None)` when cancelled.
async fn run_to_end(
    mut cmd: Command,
    token: &CancellationToken,
    timeout: Duration,
) -> Result<Option<String>> {
    let mut child = cmd
        .spawn()
        .map_err(|e| Error::Other(format!("cannot start yt-dlp: {e}")))?;
    let mut stdout = child.stdout.take().expect("piped");
    let mut stderr = child.stderr.take().expect("piped");
    let io = async {
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let _ = tokio::join!(stdout.read_to_end(&mut out), stderr.read_to_end(&mut err));
        let status = child.wait().await;
        (out, err, status)
    };
    tokio::pin!(io);
    let (out, err, status) = tokio::select! {
        r = &mut io => r,
        _ = token.cancelled() => return Ok(None),
        _ = tokio::time::sleep(timeout) => return Err(Error::Timeout),
    };
    // (Dropping `child` on the early returns above kills it via kill_on_drop.)
    let status = status?;
    let err = String::from_utf8_lossy(&err);
    if !status.success() {
        return Err(error_from(&err));
    }
    Ok(Some(String::from_utf8_lossy(&out).into_owned()))
}

async fn dump_json(
    tools: &MediaTools,
    url: &str,
    headers: &RequestHeaders,
    format: &[String],
    token: &CancellationToken,
) -> Result<Option<Value>> {
    let mut cmd = command(tools, headers);
    cmd.arg("-J").args(format).arg("--").arg(url);
    let Some(out) = run_to_end(cmd, token, INSPECT_TIMEOUT).await? else {
        return Ok(None);
    };
    let v: Value = serde_json::from_str(out.trim())
        .map_err(|e| Error::Other(format!("yt-dlp returned unreadable data: {e}")))?;
    if str_of(&v, "_type") == Some("playlist") {
        return Err(Error::Other(
            "this link is a playlist; open a single video instead".into(),
        ));
    }
    Ok(Some(v))
}

/// Describe a video page (title, qualities…) without downloading it.
pub(crate) async fn probe(
    tools: &MediaTools,
    url: &str,
    headers: &RequestHeaders,
) -> Result<ProbeResult> {
    let (info, _) = extract(tools, url, headers, &[], &CancellationToken::new())
        .await?
        .expect("not cancelled");
    let media = describe(&info, tools.ffmpeg.is_some());
    let default = media
        .qualities
        .iter()
        .find(|q| q.id == DEFAULT_QUALITY)
        .or_else(|| media.qualities.first());
    let ext = if default.is_some_and(|q| q.id == "audio") {
        "mp3"
    } else {
        "mp4"
    };
    Ok(ProbeResult {
        total_size: default.and_then(|q| q.estimated_size),
        resumable: !media.is_live,
        file_name: with_ext(&naming::sanitize(&media.title), ext),
        content_type: None,
        final_url: str_of(&info, "webpage_url").unwrap_or(url).to_string(),
        stream: None,
        media: Some(media),
        etag: None,
        last_modified: None,
        name_from_server: true,
    })
}

/// One line of `--progress-template` output.
#[derive(Debug, PartialEq)]
struct Tick {
    downloaded: u64,
    total: Option<u64>,
    speed: f64,
    /// Fragments in the current stream (`None` for a plain HTTPS stream).
    fragments: Option<u32>,
}

fn parse_tick(line: &str) -> Option<Tick> {
    let mut it = line.strip_prefix("[dm] ")?.split_whitespace();
    let num = |s: Option<&str>| {
        s.and_then(|v| v.parse::<f64>().ok())
            .filter(|v| v.is_finite() && *v >= 0.0)
    };
    let downloaded = num(it.next())? as u64;
    let total = num(it.next());
    let estimate = num(it.next());
    let speed = num(it.next()).unwrap_or(0.0);
    let fragments = num(it.next()).map(|n| n as u32).filter(|&n| n > 0);
    Some(Tick {
        downloaded,
        total: total.or(estimate).map(|t| t as u64).filter(|&t| t > 0),
        speed,
        fragments,
    })
}

/// Turns per-stream progress (video, then audio) into one running total.
#[derive(Default)]
struct Stages {
    /// Which stream (0 = first) is downloading.
    index: usize,
    base: u64,
    last_downloaded: u64,
    last_total: u64,
}

impl Stages {
    /// -> (downloaded so far, total known so far)
    fn feed(&mut self, t: &Tick) -> (u64, u64) {
        // A new stream starts from zero.
        if t.downloaded + (1 << 20) < self.last_downloaded {
            self.base += self.last_total.max(self.last_downloaded);
            self.index += 1;
        }
        self.last_downloaded = t.downloaded;
        self.last_total = t.total.unwrap_or(t.downloaded).max(t.downloaded);
        (self.base + t.downloaded, self.base + self.last_total)
    }
}

/// Re-encode HEVC video to H.264 (audio copied) into `out`. Used on Windows
/// when a site offers nothing but HEVC, which Windows only plays with a paid
/// codec. `Ok(false)` when cancelled.
async fn to_h264(
    ffmpeg: &Path,
    input: &Path,
    out: &Path,
    token: &CancellationToken,
) -> Result<bool> {
    let mut c = Command::new(ffmpeg);
    c.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .args(["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i"])
        .arg(input)
        .args([
            "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast",
        ])
        .args([
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
        ])
        .arg(out);
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    match run_to_end(c, token, TRANSCODE_TIMEOUT).await {
        Ok(Some(_)) => Ok(true),
        // A half-written file must not be taken for the result on resume.
        Ok(None) => {
            let _ = std::fs::remove_file(out);
            Ok(false)
        }
        Err(e) => {
            let _ = std::fs::remove_file(out);
            Err(e)
        }
    }
}

/// yt-dlp splits YouTube "dashy" formats into 10 MiB byte ranges.
const DASHY_CHUNK: u64 = 10 << 20;

/// Per-fragment progress of the stream being downloaded, read from yt-dlp's
/// files in the work folder: `…-FragN.part` while a fragment downloads,
/// `…-FragN` once done, then appended to the stream's part file. yt-dlp only
/// prints a total; this shows each connection like a normal download does.
/// `base` is the size of the streams before this one (video before audio).
fn fragment_segments(dir: &Path, base: u64, size: u64, count: u32) -> Option<Vec<SegmentInfo>> {
    if count < 2 || size == 0 {
        return None;
    }
    let n = u64::from(count);
    let chunk = if size > (n - 1) * DASHY_CHUNK && size <= n * DASHY_CHUNK {
        DASHY_CHUNK
    } else {
        size.div_ceil(n)
    };
    let range = |i: u64| {
        let start = (i - 1) * chunk;
        (start, chunk.min(size.saturating_sub(start)))
    };
    let mut frags = Vec::new(); // (fragment number from 1, bytes on disk)
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let name = e.file_name();
        let Some((_, rest)) = name.to_str().and_then(|s| s.rsplit_once("-Frag")) else {
            continue;
        };
        let (num, partial) = match rest.strip_suffix(".part") {
            Some(num) => (num, true),
            None => (rest, false),
        };
        let Some(i) = num.parse::<u64>().ok().filter(|i| (1..=n).contains(i)) else {
            continue;
        };
        let len = range(i).1;
        let done = if partial {
            e.metadata().map_or(0, |m| m.len()).min(len)
        } else {
            len
        };
        frags.push((i, done));
    }
    frags.sort_unstable();
    let first = frags.first()?.0;
    // Everything before the first fragment file is already appended.
    let appended = base + range(first).0;
    let mut segs = Vec::with_capacity(frags.len() + 1);
    if appended > 0 {
        segs.push(SegmentInfo {
            start: 0,
            end: appended,
            done: appended,
        });
    }
    for (i, done) in frags {
        let (start, len) = range(i);
        segs.push(SegmentInfo {
            start: base + start,
            end: base + start + len,
            done,
        });
    }
    Some(segs)
}

pub(crate) async fn run(
    inner: Arc<Inner>,
    mut info: DownloadInfo,
    token: CancellationToken,
) -> Result<Outcome> {
    let tools = inner.media_tools().ok_or(Error::MediaToolsMissing)?;
    let quality = info
        .media_quality
        .clone()
        .unwrap_or_else(|| DEFAULT_QUALITY.to_string());
    let (format, ext) = format_args(&quality, tools.ffmpeg.is_some());

    // 1. Extract (also refreshes stream URLs, which expire after a few hours).
    let Some((meta, headers)) = extract(&tools, &info.url, &info.headers, &format, &token).await?
    else {
        return Ok(Outcome::Stopped);
    };
    if meta.get("is_live").and_then(Value::as_bool) == Some(true) {
        return Err(Error::Other(
            "live streams cannot be downloaded (the playlist has no end)".into(),
        ));
    }

    // 2. Work folder; name the file after the video while nothing is on disk.
    let mut part = info.part_path();
    let mut dir = part_dir(&part);
    if !dir.exists() {
        let wanted = if info.auto_name {
            with_ext(
                &naming::sanitize(str_of(&meta, "title").unwrap_or("video")),
                ext,
            )
        } else {
            with_ext(&info.file_name, ext)
        };
        if wanted != info.file_name {
            info.file_name = inner.unique_name(info.id, &info.save_dir, &wanted);
            part = info.part_path();
            dir = part_dir(&part);
        }
        std::fs::create_dir_all(&dir)?;
    }
    let info_path = dir.join(INFO_FILE);
    std::fs::write(&info_path, meta.to_string())?;
    let estimate = selected_size(&meta);
    let connections = if fragmented(&meta) {
        info.connections.clamp(1, 16)
    } else {
        1
    };
    info.kind = DownloadKind::Media;
    info.media_quality = Some(quality);
    info.resumable = true;
    info.auto_name = false;
    info.total_size = estimate.or(info.total_size);
    inner.commit(&info);

    // 3. Download.
    let mut cmd = command(&tools, &headers);
    cmd.args(&format)
        .arg("--load-info-json")
        .arg(&info_path)
        .arg("-o")
        .arg(dir.join(OUTPUT))
        .args(["--newline", "--progress", "--continue", "--no-mtime"])
        .args(["--retries", "10", "--fragment-retries", "10"])
        .args(["-N", &connections.to_string()])
        .args(speed_limit_args(inner.settings().speed_limit))
        .args([
            "--progress-template",
            "download:[dm] %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.fragment_count)s",
            "--print",
            "after_move:[dmfile] %(filepath)s",
        ]);
    let mut child = cmd
        .spawn()
        .map_err(|e| Error::Other(format!("cannot start yt-dlp: {e}")))?;
    let mut lines = BufReader::new(child.stdout.take().expect("piped")).lines();
    let stderr_tail = Arc::new(Mutex::new(VecDeque::<String>::new()));
    let stderr_task = {
        let tail = stderr_tail.clone();
        let mut err = BufReader::new(child.stderr.take().expect("piped")).lines();
        tokio::spawn(async move {
            while let Ok(Some(l)) = err.next_line().await {
                let mut t = tail.lock().unwrap();
                if t.len() >= 40 {
                    t.pop_front();
                }
                t.push_back(l);
            }
        })
    };

    // Exact stream sizes (video, audio) place the fragments on the bar.
    let stage_sizes: Vec<u64> = match meta.get("requested_formats").and_then(Value::as_array) {
        Some(parts) if !parts.is_empty() => parts.iter().map(|f| size_of(f).unwrap_or(0)).collect(),
        _ => vec![size_of(&meta).unwrap_or(0)],
    };
    let mut fragments: Option<u32> = None;
    let mut stages = Stages::default();
    let mut received = info.downloaded;
    let mut live_total = 0u64;
    let mut yt_speed = 0.0f64;
    let mut meter = SpeedMeter::new(received);
    let mut final_file: Option<PathBuf> = None;
    let mut ticker = tokio::time::interval(transfer::PROGRESS_INTERVAL);
    let mut last_persist = Instant::now();
    let total_of = |live: u64, received: u64| {
        let t = estimate.unwrap_or(0).max(live).max(received);
        (t > 0).then_some(t)
    };
    loop {
        tokio::select! {
            _ = token.cancelled() => {
                kill_tree(&mut child).await;
                break;
            }
            line = lines.next_line() => match line {
                Ok(Some(l)) => {
                    if let Some(t) = parse_tick(&l) {
                        let (d, total) = stages.feed(&t);
                        received = d;
                        live_total = total;
                        yt_speed = t.speed;
                        fragments = t.fragments;
                    } else if let Some(p) = l.strip_prefix("[dmfile] ") {
                        final_file = Some(PathBuf::from(p.trim()));
                    }
                }
                _ => break,
            },
            _ = ticker.tick() => {
                let smooth = meter.update(received);
                let speed = if yt_speed > 0.0 { yt_speed } else { smooth };
                let total = total_of(live_total, received);
                inner.emit_progress(Progress {
                    id: info.id,
                    downloaded: received,
                    total_size: total,
                    speed,
                    eta_secs: total
                        .filter(|_| speed > 1.0)
                        .map(|t| (t.saturating_sub(received) as f64 / speed).ceil() as u64),
                    active_connections: connections,
                    segments: fragments
                        .and_then(|count| {
                            let i = stages.index;
                            let base = stage_sizes.get(..i).map_or(0, |s| s.iter().sum());
                            fragment_segments(&dir, base, *stage_sizes.get(i)?, count)
                        })
                        .unwrap_or_else(|| {
                            total.map_or_else(Vec::new, |t| vec![SegmentInfo { start: 0, end: t, done: received.min(t) }])
                        }),
                });
                if last_persist.elapsed() >= transfer::PERSIST_INTERVAL {
                    last_persist = Instant::now();
                    info.downloaded = received;
                    info.total_size = total;
                    inner.commit_quiet(&info);
                }
            }
        }
    }
    let status = child.wait().await;
    let _ = stderr_task.await;
    info.downloaded = received;
    info.total_size = total_of(live_total, received);

    if token.is_cancelled() {
        inner.commit_quiet(&info);
        return Ok(Outcome::Stopped);
    }
    if !status.is_ok_and(|s| s.success()) {
        inner.commit_quiet(&info);
        let tail: Vec<String> = stderr_tail.lock().unwrap().iter().cloned().collect();
        return Err(error_from(&tail.join("\n")));
    }

    // 4. Move the result next to the other downloads.
    let produced = match final_file.filter(|p| p.exists()) {
        Some(p) => p,
        None => {
            newest_output(&dir).ok_or_else(|| Error::Other("yt-dlp produced no file".into()))?
        }
    };
    // HEVC was the only choice: make it playable on Windows.
    let mut produced = produced;
    if let (true, Some(ffmpeg), Some(vcodec)) = (cfg!(windows), &tools.ffmpeg, chosen_vcodec(&meta))
    {
        if ext == "mp4" && is_hevc(vcodec) {
            let out = dir.join("h264.mp4");
            match to_h264(ffmpeg, &produced, &out, &token).await {
                Ok(true) => produced = out,
                Ok(false) => {
                    inner.commit_quiet(&info);
                    return Ok(Outcome::Stopped);
                }
                // Keep the HEVC file: it plays with the codec pack or another player.
                Err(e) => tracing::warn!("HEVC to H.264 failed for {}: {e}", info.id),
            }
        }
    }
    let produced_ext = produced
        .extension()
        .map(|e| e.to_string_lossy().into_owned())
        .unwrap_or_else(|| ext.to_string());
    let (save_dir, name) = (
        info.save_dir.clone(),
        with_ext(&info.file_name, &produced_ext),
    );
    let target = tokio::task::spawn_blocking(move || -> std::io::Result<PathBuf> {
        let target = naming::unique_path(&save_dir, &name);
        if std::fs::rename(&produced, &target).is_err() {
            std::fs::copy(&produced, &target)?;
        }
        Ok(target)
    })
    .await
    .map_err(transfer::join_error)??;
    let size = std::fs::metadata(&target)
        .map(|m| m.len())
        .unwrap_or(received);
    if let Some(n) = target.file_name() {
        info.file_name = n.to_string_lossy().into_owned();
    }
    info.total_size = Some(size);
    info.downloaded = size;
    info.segments.clear();
    inner.commit_quiet(&info);
    let _ = tokio::task::spawn_blocking(move || remove_part(&part)).await;
    Ok(Outcome::Completed)
}

/// The engine-wide speed limit, applied to this yt-dlp run.
fn speed_limit_args(bytes_per_sec: u64) -> Vec<String> {
    if bytes_per_sec == 0 {
        return Vec::new();
    }
    vec!["--limit-rate".into(), bytes_per_sec.to_string()]
}

/// Fallback when `--print after_move` gave nothing: the finished `video.*`.
fn newest_output(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            name.starts_with("video.")
                && !name.ends_with(".part")
                && !name.ends_with(".ytdl")
                && !name.contains(".part-")
                && p.extension()
                    .is_some_and(|e| MEDIA_EXTS.contains(&e.to_string_lossy().as_ref()))
        })
        .max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn known_sites() {
        assert!(is_media_site("https://www.youtube.com/watch?v=jNQXAC9IVRw"));
        assert!(is_media_site("https://youtu.be/jNQXAC9IVRw"));
        assert!(is_media_site("https://m.youtube.com/shorts/x"));
        assert!(is_media_site("https://www.tiktok.com/@a/video/1"));
        assert!(!is_media_site("https://notyoutube.com/watch"));
        assert!(!is_media_site("https://example.com/video.mp4"));
        assert!(is_media_site("https://vm.tiktok.com/ZMabc/"));
        assert!(is_media_site(
            "https://www.douyin.com/video/7312345678901234567"
        ));
        assert!(is_media_site("https://v.douyin.com/iABCdef/"));
        assert!(!is_media_site(
            "https://v3-web.douyinvod.com/abc/video/tos/cn/x/"
        ));
        assert!(is_media_site("https://player.vimeo.com/video/1"));
        // CDN hosts serve raw files, not pages.
        assert!(!is_media_site(
            "https://v16-webapp-prime.tiktok.com/video/tos/alisg/x/"
        ));
        assert!(!is_media_site(
            "https://rr3---sn-8qj-i5o6.googlevideo.com/videoplayback"
        ));
        assert!(!is_media_site(
            "https://video.fsgn5-1.fna.fbcdn.net/v/t42.mp4"
        ));
    }

    #[test]
    fn names_get_the_right_extension() {
        assert_eq!(with_ext("Clip.mp4", "mp3"), "Clip.mp3");
        assert_eq!(with_ext("Tập 1.5", "mp4"), "Tập 1.5.mp4");
        assert_eq!(with_ext("watch", "mp4"), "watch.mp4");
        assert_eq!(with_ext(".webm", "mp4"), "video.mp4");
    }

    #[test]
    fn fragmented_formats_use_several_connections() {
        let dash = json!({"requested_formats": [
            {"protocol": "http_dash_segments"}, {"protocol": "https"}
        ]});
        assert!(fragmented(&dash));
        assert!(!fragmented(&json!({"protocol": "https"})));
        assert!(fragmented(&json!({"protocol": "m3u8_native"})));
    }

    #[test]
    fn format_selection() {
        let (a, ext) = format_args("720", true);
        assert_eq!(ext, "mp4");
        assert!(a.contains(&"res:720,vcodec:h264,acodec:aac".to_string()));
        assert!(a.contains(&"--merge-output-format".to_string()));
        assert!(a[1].starts_with("bv*[protocol!*=m3u8][vcodec!*=?hev]"));
        assert!(a[1].ends_with("+ba/bv*+ba/b"));
        let (a, ext) = format_args("audio", true);
        assert_eq!(ext, "mp3");
        assert!(a.contains(&"-x".to_string()));
        let (a, ext) = format_args("audio", false);
        assert_eq!(ext, "m4a");
        assert!(!a.contains(&"-x".to_string()));
        let (a, _) = format_args("1080", false);
        assert!(a[1].starts_with("b[height<=1080][ext=mp4][vcodec!*=?hev]"));
        assert!(a[1].ends_with("/b[height<=1080]/b"));
        let (a, _) = format_args("best", true);
        assert!(a.contains(&"res,vcodec:h264,acodec:aac".to_string()));
    }

    fn sample() -> Value {
        json!({
            "title": "Me at the zoo", "extractor_key": "Youtube", "uploader": "jawed",
            "duration": 19.0, "thumbnail": "https://i.ytimg.com/vi/x/hq.jpg",
            "formats": [
                {"format_id": "139", "vcodec": "none", "acodec": "mp4a.40.5", "abr": 48.0, "filesize": 100_000},
                {"format_id": "140", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 128.0, "filesize": 300_000},
                {"format_id": "160", "vcodec": "avc1", "acodec": "none", "height": 144, "tbr": 100.0, "filesize": 200_000},
                {"format_id": "18", "vcodec": "avc1", "acodec": "mp4a.40.2", "height": 360, "tbr": 500.0, "filesize": 1_000_000},
                {"format_id": "136", "vcodec": "avc1", "acodec": "none", "height": 720, "tbr": 1500.0, "filesize_approx": 3_000_000},
                {"format_id": "137", "vcodec": "avc1", "acodec": "none", "height": 1080, "tbr": 3000.0, "filesize": 6_000_000},
                {"format_id": "sb0", "vcodec": "none", "acodec": "none", "format_note": "storyboard"}
            ]
        })
    }

    #[test]
    fn qualities_with_ffmpeg() {
        let m = describe(&sample(), true);
        assert_eq!(m.title, "Me at the zoo");
        assert_eq!(m.site, "Youtube");
        let ids: Vec<&str> = m.qualities.iter().map(|q| q.id.as_str()).collect();
        assert_eq!(ids, ["1080", "720", "360", "240", "audio"]);
        // Video-only stream + best audio.
        assert_eq!(m.qualities[0].estimated_size, Some(6_300_000));
        assert_eq!(m.qualities[1].estimated_size, Some(3_300_000));
        // Muxed format: no extra audio.
        assert_eq!(m.qualities[2].estimated_size, Some(1_000_000));
        assert_eq!(m.qualities.last().unwrap().estimated_size, Some(300_000));
        assert_eq!(m.qualities.last().unwrap().label, "MP3");
        assert!(!m.needs_ffmpeg_for_best);
    }

    #[test]
    fn qualities_without_ffmpeg() {
        let m = describe(&sample(), false);
        let ids: Vec<&str> = m.qualities.iter().map(|q| q.id.as_str()).collect();
        assert_eq!(ids, ["360", "audio"]);
        assert!(m.needs_ffmpeg_for_best);
    }

    #[test]
    fn selected_sizes() {
        let merged = json!({"requested_formats": [{"filesize": 10}, {"filesize_approx": 5}]});
        assert_eq!(selected_size(&merged), Some(15));
        assert_eq!(selected_size(&json!({"filesize": 7})), Some(7));
        assert_eq!(
            selected_size(&json!({"requested_formats": [{"filesize": 1}, {}]})),
            None
        );
    }

    #[test]
    fn progress_lines() {
        assert_eq!(
            parse_tick("[dm] 1024 4096 NA 512.5"),
            Some(Tick {
                downloaded: 1024,
                total: Some(4096),
                speed: 512.5,
                fragments: None,
            })
        );
        assert_eq!(
            parse_tick("[dm] 1024 NA 8000.0 NA 56"),
            Some(Tick {
                downloaded: 1024,
                total: Some(8000),
                speed: 0.0,
                fragments: Some(56),
            })
        );
        assert_eq!(parse_tick("[dm] 1 2 NA 3 NA").unwrap().fragments, None);
        assert_eq!(parse_tick("[download] 50%"), None);
    }

    #[test]
    fn stages_add_up() {
        let mut s = Stages::default();
        let t = |d, total| Tick {
            downloaded: d,
            total: Some(total),
            speed: 0.0,
            fragments: None,
        };
        assert_eq!(s.feed(&t(5_000_000, 10_000_000)), (5_000_000, 10_000_000));
        assert_eq!(s.feed(&t(10_000_000, 10_000_000)), (10_000_000, 10_000_000));
        // Audio stream starts.
        assert_eq!(s.feed(&t(1_000, 3_000_000)), (10_001_000, 13_000_000));
        assert_eq!(s.feed(&t(3_000_000, 3_000_000)), (13_000_000, 13_000_000));
    }

    #[test]
    fn fragment_files_become_segments() {
        const M: u64 = 10 << 20;
        let dir = tempfile::tempdir().unwrap();
        let put =
            |name: &str, len: usize| std::fs::write(dir.path().join(name), vec![0u8; len]).unwrap();
        // 3 fragments of a 25 MiB stream: 1 appended, 2 done, 3 half way.
        put("video.f137.mp4.part", M as usize);
        put("video.f137.mp4.part.ytdl", 10);
        put("video.f137.mp4.part-Frag2", M as usize);
        put("video.f137.mp4.part-Frag3.part", 1 << 20);
        let size = 25 << 20;
        let segs = fragment_segments(dir.path(), 0, size, 3).unwrap();
        let tuple = |s: &SegmentInfo| (s.start, s.end, s.done);
        assert_eq!(
            segs.iter().map(tuple).collect::<Vec<_>>(),
            [(0, M, M), (M, 2 * M, M), (2 * M, size, 1 << 20)]
        );
        // During the audio stream, the video stream is the base.
        let segs = fragment_segments(dir.path(), 100, size, 3).unwrap();
        assert_eq!(tuple(&segs[0]), (0, 100 + M, 100 + M));
        assert_eq!(tuple(&segs[2]), (100 + 2 * M, 100 + size, 1 << 20));
        // A plain stream has no fragments.
        assert!(fragment_segments(dir.path(), 0, size, 1).is_none());
        assert!(fragment_segments(tempfile::tempdir().unwrap().path(), 0, size, 3).is_none());
    }

    #[test]
    fn hevc_names() {
        for v in ["hev1.1.6.L93.B0", "hvc1", "h265", "bytevc1", "HEVC"] {
            assert!(is_hevc(v), "{v}");
        }
        for v in ["avc1.640028", "h264", "vp9", "av01.0.08M.08"] {
            assert!(!is_hevc(v), "{v}");
        }
        let info = json!({"requested_formats": [{"vcodec": "bytevc1"}, {"vcodec": "none"}]});
        assert_eq!(chosen_vcodec(&info), Some("bytevc1"));
        assert_eq!(chosen_vcodec(&json!({"vcodec": "h264"})), Some("h264"));
        assert_eq!(chosen_vcodec(&json!({"vcodec": "none"})), None);
    }

    /// Needs a real ffmpeg with libx265/libx264 (the BtbN build has both).
    #[tokio::test]
    async fn hevc_is_converted_to_h264() {
        let Some(ffmpeg) = std::env::var_os("DM_FFMPEG").map(PathBuf::from) else {
            eprintln!("skipped: set DM_FFMPEG to run");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let hevc = dir.path().join("in.mp4");
        let made = std::process::Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=duration=2:size=320x240",
            ])
            .args([
                "-f",
                "lavfi",
                "-i",
                "sine=duration=2",
                "-c:v",
                "libx265",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(&hevc)
            .status()
            .unwrap();
        assert!(made.success());
        let out = dir.path().join("h264.mp4");
        assert!(to_h264(&ffmpeg, &hevc, &out, &CancellationToken::new())
            .await
            .unwrap());
        let probe = std::process::Command::new(ffmpeg.with_file_name("ffprobe.exe"))
            .args([
                "-v",
                "error",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "csv=p=0",
            ])
            .arg(&out)
            .output()
            .unwrap();
        let codecs = String::from_utf8_lossy(&probe.stdout);
        assert_eq!(codecs.lines().collect::<Vec<_>>(), ["h264", "aac"]);
    }

    #[test]
    fn error_messages() {
        let e = error_from(
            "WARNING: x\nERROR: [youtube] abc123: Video unavailable. This video is private\n",
        );
        assert_eq!(
            e.to_string(),
            "yt-dlp: Video unavailable. This video is private"
        );
        let e = error_from("ERROR: Unsupported URL: https://a.com\n");
        assert_eq!(e.to_string(), "yt-dlp: Unsupported URL: https://a.com");
    }
}
