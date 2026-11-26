//! In-app updates and changelog, both backed by GitHub Releases.
//!
//! - The changelog comes from the public GitHub REST API (release notes).
//! - Updates use `tauri-plugin-updater` with the signed `latest.json` that
//!   CI attaches to every release (see `plugins.updater` in tauri.conf.json).

use crate::i18n::tr;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

/// `owner/name` of the GitHub repository that publishes releases.
pub const REPO: &str = "lion3993vn/DownloadManager";
const RECHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

static INSTALLING: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    pub version: String,
    pub date: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub current_version: String,
    pub available: Option<AvailableUpdate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    pub version: String,
    pub name: String,
    pub notes: String,
    pub published_at: Option<String>,
    pub url: String,
    pub prerelease: bool,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    prerelease: bool,
    draft: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    downloaded: u64,
    total: Option<u64>,
}

fn friendly(e: tauri_plugin_updater::Error) -> String {
    let raw = e.to_string();
    if raw.contains("valid release JSON") || raw.contains("404") {
        tr!(
            "Chưa có bản phát hành hỗ trợ tự cập nhật trên GitHub.",
            "There is no release with auto-update support on GitHub yet."
        )
    } else if raw.contains("signature") {
        tr!(
            "Chữ ký bản cập nhật không hợp lệ, đã hủy để an toàn ({raw}).",
            "The update signature is invalid; the update was canceled for safety ({raw})."
        )
    } else {
        tr!(
            "Không kiểm tra được cập nhật: {raw}",
            "Could not check for updates: {raw}"
        )
    }
}

pub async fn check(app: &AppHandle) -> Result<UpdateStatus, String> {
    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(friendly)?
        .check()
        .await
        .map_err(friendly)?;
    Ok(UpdateStatus {
        current_version,
        available: update.map(|u| AvailableUpdate {
            version: u.version.clone(),
            date: u.date.map(|d| d.to_string()),
            notes: u.body.clone(),
        }),
    })
}

/// Download, verify (minisign), install and relaunch. On Windows the NSIS
/// installer runs in passive mode and the app exits while it replaces files.
pub async fn install(app: AppHandle) -> Result<(), String> {
    if INSTALLING.swap(true, Ordering::SeqCst) {
        return Err(tr!("Đang cập nhật…", "Updating…"));
    }
    let result = install_inner(&app).await;
    INSTALLING.store(false, Ordering::SeqCst);
    result
}

async fn install_inner(app: &AppHandle) -> Result<(), String> {
    let update = app
        .updater()
        .map_err(friendly)?
        .check()
        .await
        .map_err(friendly)?
        .ok_or_else(|| {
            tr!(
                "Bạn đang dùng phiên bản mới nhất.",
                "You are on the latest version."
            )
        })?;

    let mut downloaded = 0u64;
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                if last_emit.elapsed() >= Duration::from_millis(120) {
                    last_emit = Instant::now();
                    let _ = app.emit(
                        "dm://update-progress",
                        DownloadProgress { downloaded, total },
                    );
                }
            },
            || {
                let _ = app.emit("dm://update-installing", ());
            },
        )
        .await
        .map_err(friendly)?;

    // Dev aid: verify download + signature without replacing the installed app.
    if cfg!(debug_assertions) && std::env::var_os("DM_UPDATE_DRY_RUN").is_some() {
        tracing::info!(
            bytes = bytes.len(),
            "update dry run: downloaded and verified"
        );
        return Err(format!(
            "[dev] Dry run: downloaded {} bytes and verified the v{} signature; skipping the install.",
            bytes.len(),
            update.version
        ));
    }

    // Checkpoint running downloads: they resume after the restart.
    let engine = app.state::<AppState>().engine.clone();
    engine.shutdown().await;
    if let Err(e) = update.install(bytes) {
        engine.restart_after_shutdown();
        return Err(tr!(
            "Cài bản cập nhật thất bại: {e}",
            "Installing the update failed: {e}"
        ));
    }
    app.restart();
}

/// Release history for the changelog, newest first.
pub async fn releases() -> Result<Vec<ReleaseInfo>, String> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("DownloadManager/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(format!(
            "https://api.github.com/repos/{REPO}/releases?per_page=30"
        ))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| {
            tr!(
                "Không kết nối được GitHub: {e}",
                "Could not connect to GitHub: {e}"
            )
        })?;
    match resp.status().as_u16() {
        200 => {}
        403 | 429 => {
            return Err(tr!(
                "GitHub tạm giới hạn số lần truy vấn, thử lại sau ít phút.",
                "GitHub is rate-limiting requests; try again in a few minutes."
            ))
        }
        s => {
            return Err(tr!(
                "GitHub trả về lỗi HTTP {s}.",
                "GitHub returned HTTP error {s}."
            ))
        }
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let list: Vec<GhRelease> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(list
        .into_iter()
        .filter(|r| !r.draft)
        .map(|r| ReleaseInfo {
            version: r.tag_name.trim_start_matches('v').to_string(),
            name: r
                .name
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| r.tag_name.clone()),
            notes: r.body.unwrap_or_default(),
            published_at: r.published_at,
            url: r.html_url,
            prerelease: r.prerelease,
        })
        .collect())
}

/// Re-check periodically while the app runs (the UI checks at startup).
pub fn spawn_periodic_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut notified: Option<String> = None;
        loop {
            tokio::time::sleep(RECHECK_INTERVAL).await;
            if let Ok(UpdateStatus {
                available: Some(u), ..
            }) = check(&app).await
            {
                if notified.as_deref() != Some(u.version.as_str()) {
                    notified = Some(u.version.clone());
                    let _ = app.emit("dm://update-available", &u);
                }
            }
        }
    });
}
