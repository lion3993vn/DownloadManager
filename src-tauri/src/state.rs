//! Shared application state and app-level (non-engine) settings.

use dm_core::{Engine, RequestHeaders};
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
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            bridge_token: new_token(),
            bridge_port: DEFAULT_BRIDGE_PORT,
            confirm_captures: true,
            close_to_tray: true,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedExtension {
    pub origin: String,
    pub browser: String,
    /// Unix epoch milliseconds.
    pub last_seen: i64,
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

    /// Remember an extension; returns it if it was not known before.
    pub fn record_extension(&self, origin: &str, browser: &str) -> Option<ConnectedExtension> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let mut list = self.extensions.lock().unwrap();
        let existing = list
            .iter()
            .find(|e| e.origin == origin)
            .map(|e| e.browser.clone());
        // A request without the browser header must not erase a known name.
        let browser = match (browser.trim(), existing) {
            ("", Some(known)) => known,
            ("", None) => "Trình duyệt".to_string(),
            (b, _) => b.to_string(),
        };
        let browser = browser.as_str();
        let is_new = match list.iter_mut().find(|e| e.origin == origin) {
            Some(e) => {
                // Avoid a database write on every ping.
                if now - e.last_seen < 60_000 && e.browser == browser {
                    return None;
                }
                e.last_seen = now;
                e.browser = browser.to_string();
                false
            }
            None => {
                list.push(ConnectedExtension {
                    origin: origin.to_string(),
                    browser: browser.to_string(),
                    last_seen: now,
                });
                true
            }
        };
        let _ = self.engine.set_kv(
            EXTENSIONS_KEY,
            &serde_json::to_string(&*list).expect("serializable"),
        );
        is_new.then(|| list.last().cloned()).flatten()
    }

    pub fn next_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }

    pub fn app_settings(&self) -> AppSettings {
        self.settings.read().unwrap().clone()
    }
}
