//! Shared application state and app-level (non-engine) settings.

use dm_core::{DownloadKind, Engine, RequestHeaders};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, RwLock};
use tokio::sync::oneshot;

const APP_SETTINGS_KEY: &str = "app_settings";
const EXTENSIONS_KEY: &str = "connected_extensions";
pub const DEFAULT_BRIDGE_PORT: u16 = 47890;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    /// Shared secret the browser extension sends in `X-DM-Token`.
    pub bridge_token: String,
    pub bridge_port: u16,
    /// Show a confirmation dialog for downloads captured from the browser.
    pub confirm_captures: bool,
    /// Closing the window keeps the app running in the system tray.
    pub close_to_tray: bool,
    /// UI language: "auto" (follow the OS), "vi" or "en".
    pub language: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            bridge_token: new_token(),
            bridge_port: DEFAULT_BRIDGE_PORT,
            confirm_captures: true,
            close_to_tray: true,
            language: "auto".into(),
        }
    }
}

pub fn new_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

impl AppSettings {
    pub fn load(engine: &Engine) -> Self {
        let loaded = engine
            .get_kv(APP_SETTINGS_KEY)
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str::<AppSettings>(&s).ok());
        let settings = loaded.unwrap_or_default();
        // Persist so the generated token stays stable across restarts.
        settings.save(engine);
        settings
    }

    pub fn save(&self, engine: &Engine) {
        if let Err(e) = engine.set_kv(
            APP_SETTINGS_KEY,
            &serde_json::to_string(self).expect("serializable"),
        ) {
            tracing::error!(error = %e, "failed to save app settings");
        }
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub running: bool,
    pub port: u16,
    pub error: Option<String>,
}

/// A download handed over by the browser extension, waiting for confirmation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    #[serde(default)]
    pub id: u64,
    pub url: String,
    pub file_name: Option<String>,
    pub file_size: Option<u64>,
    pub mime: Option<String>,
    /// `hls` for a video stream the extension found on the page.
    #[serde(default)]
    pub kind: Option<DownloadKind>,
    #[serde(flatten)]
    pub headers: RequestHeaders,
}

/// A browser extension asking for the bridge token.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairRequest {
    pub id: u64,
    pub origin: String,
    pub browser: String,
}

pub struct AppState {
    pub engine: Engine,
    pub settings: RwLock<AppSettings>,
    pub bridge: RwLock<BridgeStatus>,
    pub captures: Mutex<Vec<Capture>>,
    pub pair_requests: Mutex<HashMap<u64, (PairRequest, oneshot::Sender<bool>)>>,
    /// Browser extensions that have talked to us with a valid token.
    pub extensions: Mutex<Vec<ConnectedExtension>>,
    next_id: AtomicU64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedExtension {
    pub origin: String,
    pub browser: String,
    /// Unix epoch milliseconds.
    pub last_seen: i64,
    /// `X-DM-Version` of the extension. `None`: an extension released before
    /// version reporting was added, so it is outdated.
    #[serde(default)]
    pub version: Option<String>,
}

/// What [`AppState::record_extension`] changed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExtensionChange {
    /// Seen very recently, nothing to store (pings are frequent).
    Unchanged,
    /// `last_seen` / browser name refreshed: store it, nothing to announce.
    Touched,
    /// First time this extension talked to us.
    New(ConnectedExtension),
    /// Known extension, now running another version (the user updated it).
    Version(ConnectedExtension),
}

/// Merge a request from `origin` into the known extensions.
fn merge_extension(
    list: &mut Vec<ConnectedExtension>,
    origin: &str,
    browser: &str,
    version: Option<&str>,
    now: i64,
) -> ExtensionChange {
    let version = version
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned);
    let Some(e) = list.iter_mut().find(|e| e.origin == origin) else {
        let browser = match browser.trim() {
            "" => "Trình duyệt",
            b => b,
        };
        let ext = ConnectedExtension {
            origin: origin.to_string(),
            browser: browser.to_string(),
            last_seen: now,
            version,
        };
        list.push(ext.clone());
        return ExtensionChange::New(ext);
    };
    // A request without the browser header must not erase a known name.
    let browser = match browser.trim() {
        "" => e.browser.clone(),
        b => b.to_string(),
    };
    let version_changed = e.version != version;
    if !version_changed && now - e.last_seen < 60_000 && e.browser == browser {
        return ExtensionChange::Unchanged;
    }
    e.last_seen = now;
    e.browser = browser;
    e.version = version;
    if version_changed {
        ExtensionChange::Version(e.clone())
    } else {
        ExtensionChange::Touched
    }
}

impl AppState {
    pub fn new(engine: Engine) -> Self {
        let settings = AppSettings::load(&engine);
        let extensions = engine
            .get_kv(EXTENSIONS_KEY)
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self {
            engine,
            settings: RwLock::new(settings),
            bridge: RwLock::new(BridgeStatus::default()),
            captures: Mutex::new(Vec::new()),
            pair_requests: Mutex::new(HashMap::new()),
            extensions: Mutex::new(extensions),
            next_id: AtomicU64::new(1),
        }
    }

    /// Remember an extension that talked to us and its version.
    pub fn record_extension(
        &self,
        origin: &str,
        browser: &str,
        version: Option<&str>,
    ) -> ExtensionChange {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mut list = self.extensions.lock().unwrap();
        let change = merge_extension(&mut list, origin, browser, version, now);
        if change != ExtensionChange::Unchanged {
            let _ = self.engine.set_kv(
                EXTENSIONS_KEY,
                &serde_json::to_string(&*list).expect("serializable"),
            );
        }
        change
    }

    pub fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn app_settings(&self) -> AppSettings {
        self.settings.read().unwrap().clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_kind_is_optional() {
        let old: Capture = serde_json::from_str(r#"{"url":"https://a.com/x.zip","fileName":null,"fileSize":null,"mime":null,"referrer":null}"#).unwrap();
        assert_eq!(old.kind, None);
        let hls: Capture =
            serde_json::from_str(r#"{"url":"https://a.com/v.m3u8","kind":"hls","cookies":"a=1"}"#)
                .unwrap();
        assert_eq!(hls.kind, Some(DownloadKind::Hls));
        assert_eq!(hls.headers.cookies.as_deref(), Some("a=1"));
    }

    #[test]
    fn extensions_saved_before_versions_load_as_unversioned() {
        let old: Vec<ConnectedExtension> = serde_json::from_str(
            r#"[{"origin":"chrome-extension://a","browser":"Google Chrome","lastSeen":1}]"#,
        )
        .unwrap();
        assert_eq!(old[0].version, None);
    }

    #[test]
    fn merging_extensions() {
        const O: &str = "chrome-extension://abc";
        let mut list = Vec::new();

        // Extensions from before version reporting send none.
        let c = merge_extension(&mut list, O, "Google Chrome", None, 0);
        assert!(matches!(c, ExtensionChange::New(ref e) if e.version.is_none()));

        // Frequent pings are not stored again...
        assert_eq!(
            merge_extension(&mut list, O, "Google Chrome", None, 10_000),
            ExtensionChange::Unchanged
        );
        // ...except once a minute, silently.
        assert_eq!(
            merge_extension(&mut list, O, "", None, 70_000),
            ExtensionChange::Touched
        );
        assert_eq!(
            list[0].browser, "Google Chrome",
            "empty name keeps the known one"
        );

        // The user reloaded the extension: announced right away.
        let c = merge_extension(&mut list, O, "Google Chrome", Some("0.3.2"), 71_000);
        assert!(
            matches!(c, ExtensionChange::Version(ref e) if e.version.as_deref() == Some("0.3.2"))
        );
        assert_eq!(list.len(), 1);

        // Blank header counts as no version.
        let c = merge_extension(&mut list, "moz-extension://x", "", Some("  "), 0);
        assert!(
            matches!(c, ExtensionChange::New(ref e) if e.version.is_none() && e.browser == "Trình duyệt")
        );
    }
}
