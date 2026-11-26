//! After downloads finish: unpack `.zip` files (setting `extract_zip`) and,
//! once the queue is done, sleep / shut down / quit (`AppState::when_done`).
//!
//! The "when done" choice lives in memory only, so a forgotten "shut down"
//! never survives a restart. When the last download ends, the UI shows a
//! 60-second countdown that can be canceled; the action runs from here, so it
//! also works with the window hidden in the tray.

use crate::i18n::tr;
use crate::state::AppState;
use crate::window::show_main_window;
use dm_core::{DownloadId, DownloadInfo, DownloadKind, Status};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

pub const COUNTDOWN_SECS: u64 = 60;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WhenDone {
    #[default]
    Nothing,
    Sleep,
    Shutdown,
    Quit,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Countdown {
    action: WhenDone,
    seconds: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Extracted {
    file_name: String,
    /// Folder the files went to, on success.
    dir: Option<String>,
    error: Option<String>,
}

/// A countdown is running (at most one).
static PENDING: AtomicBool = AtomicBool::new(false);
/// Downloads already unpacked during this run (events can repeat).
static EXTRACTED: Mutex<Option<HashSet<DownloadId>>> = Mutex::new(None);

/// Called for every `Updated` engine event (lib.rs).
pub fn on_download_updated(app: &AppHandle, d: &DownloadInfo) {
    match d.status {
        Status::Completed => {
            maybe_extract(app, d);
            check_queue_done(app);
        }
        Status::Failed => check_queue_done(app),
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// When the queue is done
// ---------------------------------------------------------------------------

fn queue_busy(state: &AppState) -> bool {
    state
        .engine
        .list()
        .iter()
        .any(|d| matches!(d.status, Status::Downloading | Status::Queued))
}

fn check_queue_done(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let action = *state.when_done.lock().unwrap();
    if action == WhenDone::Nothing || queue_busy(&state) || PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let generation = state.when_done_generation.load(Ordering::SeqCst);
    let _ = app.emit(
        "dm://when-done",
        Countdown {
            action,
            seconds: COUNTDOWN_SECS,
        },
    );
    show_main_window(app);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(COUNTDOWN_SECS)).await;
        let state = app.state::<AppState>();
        // Canceled, or "do it now" already ran.
        if state.when_done_generation.load(Ordering::SeqCst) != generation {
            return;
        }
        PENDING.store(false, Ordering::SeqCst);
        // Something new started meanwhile: wait for it instead.
        if queue_busy(&state) {
            let _ = app.emit("dm://when-done-canceled", ());
            return;
        }
        run_action(&app, action);
    });
}

/// Reset the choice and do it.
fn run_action(app: &AppHandle, action: WhenDone) {
    let state = app.state::<AppState>();
    *state.when_done.lock().unwrap() = WhenDone::Nothing;
    let _ = app.emit("dm://when-done-changed", WhenDone::Nothing);
    match action {
        WhenDone::Nothing => {}
        // RunEvent::Exit checkpoints the engine.
        WhenDone::Quit => app.exit(0),
        WhenDone::Sleep | WhenDone::Shutdown => {
            if let Err(e) = power(action) {
                tracing::error!(error = %e, ?action, "power action failed");
                let _ = app.emit("dm://when-done-failed", e);
            }
        }
    }
}

#[cfg(windows)]
fn command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    let mut c = std::process::Command::new(program);
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}

#[cfg(not(windows))]
fn command(program: &str) -> std::process::Command {
    std::process::Command::new(program)
}

/// Sleep or shut down the computer.
fn power(action: WhenDone) -> Result<(), String> {
    let shutdown = action == WhenDone::Shutdown;
    let mut c = if cfg!(windows) {
        if shutdown {
            let mut c = command("shutdown");
            c.args(["/s", "/t", "0"]);
            c
        } else {
            // SetSuspendState through .NET sleeps even when hibernation is on
            // (rundll32 powrprof.dll would hibernate then).
            let mut c = command("powershell");
            c.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; \
                 [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)",
            ]);
            c
        }
    } else if cfg!(target_os = "macos") {
        if shutdown {
            let mut c = command("osascript");
            c.args(["-e", "tell application \"System Events\" to shut down"]);
            c
        } else {
            let mut c = command("pmset");
            c.arg("sleepnow");
            c
        }
    } else {
        let mut c = command("systemctl");
        c.arg(if shutdown { "poweroff" } else { "suspend" });
        c
    };
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_when_done(state: State<'_, AppState>) -> WhenDone {
    *state.when_done.lock().unwrap()
}

#[tauri::command]
pub fn set_when_done(app: AppHandle, state: State<'_, AppState>, action: WhenDone) {
    *state.when_done.lock().unwrap() = action;
    let _ = app.emit("dm://when-done-changed", action);
}

/// Stop the countdown; the choice goes back to "nothing".
#[tauri::command]
pub fn cancel_when_done(app: AppHandle, state: State<'_, AppState>) {
    state.when_done_generation.fetch_add(1, Ordering::SeqCst);
    PENDING.store(false, Ordering::SeqCst);
    *state.when_done.lock().unwrap() = WhenDone::Nothing;
    let _ = app.emit("dm://when-done-changed", WhenDone::Nothing);
}

/// Skip the rest of the countdown.
#[tauri::command]
pub fn when_done_now(app: AppHandle, state: State<'_, AppState>) {
    let action = *state.when_done.lock().unwrap();
    state.when_done_generation.fetch_add(1, Ordering::SeqCst);
    PENDING.store(false, Ordering::SeqCst);
    run_action(&app, action);
}

// ---------------------------------------------------------------------------
// Unpacking .zip files
// ---------------------------------------------------------------------------

fn maybe_extract(app: &AppHandle, d: &DownloadInfo) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    if !state.app_settings().extract_zip
        || d.kind != DownloadKind::File
        || !d.file_name.to_ascii_lowercase().ends_with(".zip")
    {
        return;
    }
    if !EXTRACTED
        .lock()
        .unwrap()
        .get_or_insert_with(HashSet::new)
        .insert(d.id)
    {
        return;
    }
    let path = d.file_path();
    let file_name = d.file_name.clone();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = extract_zip(&path);
        if let Err(e) = &result {
            tracing::warn!(error = %e, file = %path.display(), "unzip failed");
        }
        let _ = app.emit(
            "dm://extracted",
            Extracted {
                file_name,
                dir: result
                    .as_ref()
                    .ok()
                    .map(|d| d.to_string_lossy().into_owned()),
                error: result.err(),
            },
        );
    });
}

/// `<dir>/<name>.zip` -> `<dir>/<name>/` (or `<name> (2)` if taken).
fn target_dir(zip: &Path) -> PathBuf {
    let parent = zip.parent().unwrap_or(Path::new("."));
    let stem = zip
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive".into());
    let mut dir = parent.join(&stem);
    let mut n = 2;
    while dir.exists() {
        dir = parent.join(format!("{stem} ({n})"));
        n += 1;
    }
    dir
}

/// Unpack `zip_path` into a new folder next to it; returns that folder.
pub fn extract_zip(zip_path: &Path) -> Result<PathBuf, String> {
    let file = std::fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let dest = target_dir(zip_path);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        // Rejects absolute paths and `..` (zip slip).
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        let out = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let name = entry.name().to_string();
        let mut f = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut f).map_err(|e| {
            tr!(
                "Không giải nén được {name}: {e}",
                "Could not unpack {name}: {e}"
            )
        })?;
    }
    Ok(dest)
}

/// Open a folder made by [`extract_zip`] in the file manager.
#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).is_dir() {
        return Err(tr!("Không tìm thấy thư mục", "Folder not found"));
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn unzips_next_to_the_archive_and_blocks_zip_slip() {
        let dir = std::env::temp_dir().join(format!("dm-unzip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("pack.zip");
        {
            let mut w = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            let opts = zip::write::SimpleFileOptions::default();
            w.start_file("a.txt", opts).unwrap();
            w.write_all(b"hello").unwrap();
            w.start_file("sub/b.txt", opts).unwrap();
            w.write_all(b"world").unwrap();
            w.start_file("../evil.txt", opts).unwrap();
            w.write_all(b"nope").unwrap();
            w.finish().unwrap();
        }
        let out = extract_zip(&zip_path).unwrap();
        assert_eq!(out, dir.join("pack"));
        assert_eq!(std::fs::read_to_string(out.join("a.txt")).unwrap(), "hello");
        assert_eq!(
            std::fs::read_to_string(out.join("sub").join("b.txt")).unwrap(),
            "world"
        );
        assert!(!dir.join("evil.txt").exists());
        // A second run does not overwrite the first folder.
        assert_eq!(extract_zip(&zip_path).unwrap(), dir.join("pack (2)"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
