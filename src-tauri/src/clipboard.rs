//! Clipboard monitor: a link to a file (or, if enabled, a video page) copied
//! anywhere opens the add dialog, like a browser capture with confirmation.
//!
//! The clipboard is read once a second on its own thread (clipboard handles
//! are not `Send` everywhere). Text that was already there at startup, the
//! same text twice, copies made inside the app, and links already in the list
//! are ignored.

use crate::categories;
use crate::state::{AppState, Capture};
use crate::window::show_main_window;
use dm_core::{DownloadKind, Status};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const INTERVAL: Duration = Duration::from_secs(1);

pub fn start(app: &AppHandle) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("clipboard-monitor".into())
        .spawn(move || run(app));
    if let Err(e) = spawned {
        tracing::warn!(error = %e, "clipboard monitor not started");
    }
}

fn run(app: AppHandle) {
    let mut clipboard = None;
    // `None` until the first read: whatever is there at startup is not new.
    let mut last: Option<String> = None;
    loop {
        std::thread::sleep(INTERVAL);
        let Some(state) = app.try_state::<AppState>() else {
            continue;
        };
        let settings = state.app_settings();
        if !settings.clipboard_monitor {
            last = None;
            continue;
        }
        if clipboard.is_none() {
            clipboard = arboard::Clipboard::new().ok();
        }
        let Some(cb) = clipboard.as_mut() else {
            continue;
        };
        // Images and other formats are errors here: treat them as "no text".
        let text = cb.get_text().unwrap_or_default();
        let first = last.is_none();
        if last.as_deref() == Some(text.as_str()) {
            continue;
        }
        last = Some(text.clone());
        if first {
            continue;
        }
        if let Some((url, kind)) = downloadable(&text, settings.clipboard_media) {
            offer(&app, &state, url, kind);
        }
    }
}

/// A single http(s) URL worth downloading: a known file type (not an image),
/// an HLS playlist, or a video page when `media` is on.
pub fn downloadable(text: &str, media: bool) -> Option<(String, Option<DownloadKind>)> {
    let text = text.trim();
    if text.len() > 4096 || text.chars().any(char::is_whitespace) {
        return None;
    }
    let url = reqwest::Url::parse(text).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    if dm_core::is_media_site(text) {
        return media.then(|| (text.to_string(), Some(DownloadKind::Media)));
    }
    let ext = categories::extension(url.path())?;
    if ext == "m3u8" {
        return Some((text.to_string(), Some(DownloadKind::Hls)));
    }
    match categories::kind_of(url.path()) {
        Some(kind) if kind != "image" => Some((text.to_string(), None)),
        _ => None,
    }
}

fn offer(app: &AppHandle, state: &AppState, url: String, kind: Option<DownloadKind>) {
    // Copied inside the app (e.g. "Copy link"): not a request to download.
    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if focused {
        return;
    }
    let known = state
        .engine
        .list()
        .iter()
        .any(|d| d.url == url && !matches!(d.status, Status::Failed | Status::Canceled));
    if known || state.captures.lock().unwrap().iter().any(|c| c.url == url) {
        return;
    }
    let capture = Capture {
        id: state.next_id(),
        url,
        file_name: None,
        file_size: None,
        mime: None,
        kind,
        headers: Default::default(),
        source: Some("clipboard".into()),
    };
    state.captures.lock().unwrap().push(capture);
    let _ = app.emit("dm://capture", ());
    show_main_window(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_download_links() {
        let d = |t: &str| downloadable(t, false);
        assert_eq!(
            d("https://x.org/a/setup.exe"),
            Some(("https://x.org/a/setup.exe".into(), None))
        );
        assert_eq!(
            d("  https://x.org/f.zip?sig=1  ").map(|x| x.0),
            Some("https://x.org/f.zip?sig=1".into())
        );
        assert_eq!(
            d("https://x.org/live/index.m3u8").map(|x| x.1),
            Some(Some(DownloadKind::Hls))
        );
        assert_eq!(d("https://x.org/photo.jpg"), None);
        assert_eq!(d("https://example.com"), None);
        assert_eq!(d("https://x.org/page.html"), None);
        assert_eq!(d("see https://x.org/f.zip"), None);
        assert_eq!(d("ftp://x.org/f.zip"), None);
        assert_eq!(d("https://www.youtube.com/watch?v=abc"), None);
        assert_eq!(
            downloadable("https://www.youtube.com/watch?v=abc", true).map(|x| x.1),
            Some(Some(DownloadKind::Media))
        );
    }
}
