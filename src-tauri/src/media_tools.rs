//! yt-dlp + ffmpeg for video pages (YouTube, TikTok…).
//!
//! Not bundled: the app downloads them from their GitHub releases into
//! `app_data/tools/` the first time they are needed, verifies the published
//! SHA-256, and keeps yt-dlp updated (sites break old versions within weeks).
//! macOS and Linux get yt-dlp the same way but use the system ffmpeg
//! (Homebrew / the distribution package) when there is one.

use crate::state::AppState;
use dm_core::MediaTools;
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const YTDLP_RELEASE: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
const FFMPEG_RELEASE: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/";
const UPDATED_KEY: &str = "ytdlp_updated_at";
const UPDATE_EVERY_MS: i64 = 24 * 3600 * 1000;

static BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    /// `yt-dlp --version`, when installed.
    pub ytdlp_version: Option<String>,
    pub ffmpeg: bool,
    /// ffmpeg came with the system rather than from the app.
    pub ffmpeg_from_system: bool,
    /// The app can download ffmpeg on this platform (Windows).
    pub can_install_ffmpeg: bool,
    pub busy: bool,
    /// Rough download size of a full install, for the UI.
    pub install_size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    /// "yt-dlp" | "ffmpeg" | "extract" | "update"
    step: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

fn ytdlp_asset() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", _) => Some("yt-dlp.exe"),
        ("macos", _) => Some("yt-dlp_macos"),
        ("linux", "x86_64") => Some("yt-dlp_linux"),
        ("linux", "aarch64") => Some("yt-dlp_linux_aarch64"),
        _ => None,
    }
}

fn ffmpeg_asset() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Some("ffmpeg-master-latest-win64-gpl-shared.zip"),
        ("windows", "aarch64") => Some("ffmpeg-master-latest-winarm64-gpl-shared.zip"),
        _ => None,
    }
}

const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

pub fn tools_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("tools"))
}

fn ytdlp_path(dir: &Path) -> PathBuf {
    dir.join(format!("yt-dlp{EXE}"))
}

fn app_ffmpeg_path(dir: &Path) -> PathBuf {
    dir.join("ffmpeg").join(format!("ffmpeg{EXE}"))
}

fn system_ffmpeg() -> Option<PathBuf> {
    let name = format!("ffmpeg{EXE}");
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    // GUI apps on macOS do not inherit the shell PATH.
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    dirs.into_iter()
        .map(|d| d.join(&name))
        .find(|p| p.is_file())
}

/// What is installed right now.
pub fn detect(app: &AppHandle) -> Option<MediaTools> {
    detect_in(&tools_dir(app)?)
}

/// Same, from the tools folder (before the app state exists).
pub fn detect_in(dir: &Path) -> Option<MediaTools> {
    let ytdlp = ytdlp_path(dir);
    if !ytdlp.is_file() {
        return None;
    }
    let bundled = app_ffmpeg_path(dir);
    let ffmpeg = if bundled.is_file() {
        Some(bundled)
    } else {
        system_ffmpeg()
    };
    Some(MediaTools { ytdlp, ffmpeg })
}

/// Hand the current tools to the engine.
pub fn apply(app: &AppHandle) {
    app.state::<AppState>().engine.set_media_tools(detect(app));
}

fn hidden(cmd: &mut std::process::Command) -> &mut std::process::Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

async fn ytdlp_version(path: PathBuf) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = hidden(&mut std::process::Command::new(path))
            .arg("--version")
            .output()
            .ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
            .filter(|v| !v.is_empty())
    })
    .await
    .ok()
    .flatten()
}

pub async fn status(app: &AppHandle) -> ToolsStatus {
    let tools = detect(app);
    let version = match &tools {
        Some(t) => ytdlp_version(t.ytdlp.clone()).await,
        None => None,
    };
    let bundled = tools_dir(app).map(|d| app_ffmpeg_path(&d));
    let ffmpeg = tools.as_ref().and_then(|t| t.ffmpeg.clone());
    ToolsStatus {
        ytdlp_version: version,
        ffmpeg: ffmpeg.is_some(),
        ffmpeg_from_system: ffmpeg.is_some() && ffmpeg != bundled,
        can_install_ffmpeg: ffmpeg_asset().is_some(),
        busy: BUSY.load(Ordering::SeqCst),
        install_size: if ffmpeg_asset().is_some() {
            116_000_000
        } else {
            40_000_000
        },
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("DownloadManager/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} ({url})", resp.status()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// `sha256  name` lines (sha256sum format) -> the hash for `name`.
fn checksum_for(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|l| {
        let mut it = l.split_whitespace();
        let hash = it.next()?;
        let file = it.next()?.trim_start_matches('*');
        (file == name && hash.len() == 64).then(|| hash.to_ascii_lowercase())
    })
}

/// Download to `dest`, emitting progress and checking the SHA-256.
async fn download(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_sha256: &str,
    step: &'static str,
) -> Result<(), String> {
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {} ({url})", resp.status()));
    }
    let total = resp.content_length();
    let tmp = dest.with_extension("download");
    let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut got = 0u64;
    let mut last_emit = std::time::Instant::now();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(200) {
            last_emit = std::time::Instant::now();
            let _ = app.emit(
                "dm://tools-progress",
                InstallProgress {
                    step,
                    downloaded: got,
                    total,
                },
            );
        }
    }
    drop(file);
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected_sha256 {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("checksum mismatch for {url}"));
    }
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Unpack the `bin/` folder of the ffmpeg build (exe + DLLs) into `dest`.
fn extract_ffmpeg(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(dest);
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut found = false;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // enclosed_name() rejects absolute paths and `..` (zip-slip).
        let Some(path) = entry.enclosed_name() else {
            continue;
        };
        let parts: Vec<_> = path.components().collect();
        let in_bin = parts.len() == 3 && parts[1].as_os_str() == "bin";
        if !in_bin || entry.is_dir() {
            continue;
        }
        let name = parts[2].as_os_str();
        if name.to_string_lossy().starts_with("ffplay") {
            continue; // the player is not needed
        }
        let mut out = std::fs::File::create(dest.join(name)).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        found |= name.to_string_lossy().starts_with("ffmpeg");
    }
    if found {
        Ok(())
    } else {
        Err("ffmpeg not found in the archive".into())
    }
}

/// Download yt-dlp (and ffmpeg where the app provides it).
pub async fn install(app: &AppHandle) -> Result<ToolsStatus, String> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("Đang cài đặt, hãy chờ một chút.".into());
    }
    let result = install_inner(app).await;
    BUSY.store(false, Ordering::SeqCst);
    apply(app);
    result?;
    Ok(status(app).await)
}

async fn install_inner(app: &AppHandle) -> Result<(), String> {
    let asset = ytdlp_asset().ok_or("Hệ điều hành này chưa được hỗ trợ.")?;
    let dir = tools_dir(app).ok_or("no app data folder")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let client = client()?;

    let sums = fetch_text(&client, &format!("{YTDLP_RELEASE}SHA2-256SUMS")).await?;
    let sha = checksum_for(&sums, asset).ok_or("no checksum published for yt-dlp")?;
    let ytdlp = ytdlp_path(&dir);
    download(
        app,
        &client,
        &format!("{YTDLP_RELEASE}{asset}"),
        &ytdlp,
        &sha,
        "yt-dlp",
    )
    .await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ytdlp, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    remember_update(app);

    if let Some(zip) = ffmpeg_asset() {
        if !app_ffmpeg_path(&dir).is_file() {
            let sums = fetch_text(&client, &format!("{FFMPEG_RELEASE}checksums.sha256")).await?;
            let sha = checksum_for(&sums, zip).ok_or("no checksum published for ffmpeg")?;
            let zip_path = dir.join("ffmpeg.zip");
            download(
                app,
                &client,
                &format!("{FFMPEG_RELEASE}{zip}"),
                &zip_path,
                &sha,
                "ffmpeg",
            )
            .await?;
            let _ = app.emit(
                "dm://tools-progress",
                InstallProgress {
                    step: "extract",
                    downloaded: 0,
                    total: None,
                },
            );
            let dest = dir.join("ffmpeg");
            let zp = zip_path.clone();
            tauri::async_runtime::spawn_blocking(move || extract_ffmpeg(&zp, &dest))
                .await
                .map_err(|e| e.to_string())??;
            let _ = std::fs::remove_file(zip_path);
        }
    }
    Ok(())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn remember_update(app: &AppHandle) {
    let _ = app
        .state::<AppState>()
        .engine
        .set_kv(UPDATED_KEY, &now_ms().to_string());
}

/// `yt-dlp -U`: the standalone binary replaces itself with the latest release.
pub async fn update(app: &AppHandle) -> Result<ToolsStatus, String> {
    let tools = detect(app).ok_or("yt-dlp chưa được cài.")?;
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err("Đang cài đặt, hãy chờ một chút.".into());
    }
    let _ = app.emit(
        "dm://tools-progress",
        InstallProgress {
            step: "update",
            downloaded: 0,
            total: None,
        },
    );
    let path = tools.ytdlp.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        hidden(&mut std::process::Command::new(path))
            .arg("-U")
            .output()
    })
    .await;
    BUSY.store(false, Ordering::SeqCst);
    match out {
        Ok(Ok(o)) if o.status.success() => {
            remember_update(app);
            Ok(status(app).await)
        }
        Ok(Ok(o)) => Err(format!(
            "yt-dlp -U: {}",
            String::from_utf8_lossy(&o.stderr)
                .lines()
                .last()
                .unwrap_or("failed")
        )),
        Ok(Err(e)) => Err(e.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn remove(app: &AppHandle) -> Result<(), String> {
    if BUSY.load(Ordering::SeqCst) {
        return Err("Đang cài đặt, hãy chờ một chút.".into());
    }
    if let Some(dir) = tools_dir(app) {
        let _ = std::fs::remove_dir_all(dir);
    }
    apply(app);
    Ok(())
}

/// At startup: keep yt-dlp updated (checked hourly, updated once a day).
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let last: i64 = app
                .state::<AppState>()
                .engine
                .get_kv(UPDATED_KEY)
                .ok()
                .flatten()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            if detect(&app).is_some() && now_ms() - last > UPDATE_EVERY_MS {
                if let Err(e) = update(&app).await {
                    tracing::warn!(error = %e, "yt-dlp self-update failed");
                }
            }
            tokio::time::sleep(Duration::from_secs(3600)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `FF_ZIP=<ffmpeg build zip> cargo test -p download-manager extracts_ffmpeg`
    #[test]
    fn extracts_ffmpeg() {
        let Some(zip) = std::env::var_os("FF_ZIP") else {
            return;
        };
        let dest = std::env::temp_dir().join(format!("dm-ffmpeg-test-{}", std::process::id()));
        extract_ffmpeg(Path::new(&zip), &dest).unwrap();
        let names: Vec<String> = std::fs::read_dir(&dest)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().any(|n| n.starts_with("ffmpeg")), "{names:?}");
        assert!(names.iter().any(|n| n.starts_with("ffprobe")));
        assert!(!names.iter().any(|n| n.starts_with("ffplay")));
        let _ = std::fs::remove_dir_all(dest);
    }

    #[test]
    fn checksums() {
        let sums = "aaa  other\n4fb1006aa64be61134adeb305c2b5b01dbbc8581f3c27db8a300c4e876e50231  yt-dlp.exe\n\
                    1111111111111111111111111111111111111111111111111111111111111111 *yt-dlp_macos\n";
        assert_eq!(
            checksum_for(sums, "yt-dlp.exe").as_deref(),
            Some("4fb1006aa64be61134adeb305c2b5b01dbbc8581f3c27db8a300c4e876e50231")
        );
        assert!(checksum_for(sums, "yt-dlp_macos").is_some());
        assert_eq!(checksum_for(sums, "other"), None, "not a sha256");
        assert_eq!(checksum_for(sums, "yt-dlp"), None);
    }
}
