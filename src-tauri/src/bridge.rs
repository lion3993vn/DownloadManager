//! Local HTTP endpoint the browser extension talks to.
//!
//! Bound to 127.0.0.1 only. Requests from web pages are rejected by the
//! `Origin` check (browsers always send it cross-origin and pages cannot fake
//! an extension origin); captures additionally require the pairing token.

use crate::state::{AppState, Capture, ExtensionChange, PairRequest};
use crate::window::show_main_window;
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use dm_core::NewDownload;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tower_http::cors::{AllowOrigin, CorsLayer};

const TOKEN_HEADER: &str = "x-dm-token";
const BROWSER_HEADER: &str = "x-dm-browser";
/// The extension's own origin. Chromium omits `Origin` on GET requests made
/// by extensions with host permissions, so the ping carries it explicitly.
const EXTENSION_HEADER: &str = "x-dm-extension";
/// Version of the extension (`manifest.json`). Older extensions do not send it.
const VERSION_HEADER: &str = "x-dm-version";

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let port = state.app_settings().bridge_port;
        let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(l) => l,
            Err(e) => {
                tracing::error!(port, error = %e, "browser bridge could not start");
                *state.bridge.write().unwrap() = crate::state::BridgeStatus {
                    running: false,
                    port,
                    error: Some(crate::i18n::tr!(
                        "Không mở được cổng {port}: {e}",
                        "Could not open port {port}: {e}"
                    )),
                };
                return;
            }
        };
        *state.bridge.write().unwrap() = crate::state::BridgeStatus {
            running: true,
            port,
            error: None,
        };
        tracing::info!(port, "browser bridge listening");
        if let Err(e) = axum::serve(listener, router(app.clone())).await {
            tracing::error!(error = %e, "browser bridge stopped");
            let mut b = state.bridge.write().unwrap();
            b.running = false;
            b.error = Some(e.to_string());
        }
    });
}

fn router(app: AppHandle) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin, _| {
            is_extension_origin(origin)
        }))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([
            header::CONTENT_TYPE,
            HeaderName::from_static(TOKEN_HEADER),
            HeaderName::from_static(BROWSER_HEADER),
            HeaderName::from_static(EXTENSION_HEADER),
            HeaderName::from_static(VERSION_HEADER),
        ]);
    Router::new()
        .route("/api/ping", get(ping))
        .route("/api/pair", post(pair))
        .route("/api/capture", post(capture))
        .layer(cors)
        .with_state(app)
}

fn is_extension_origin(origin: &HeaderValue) -> bool {
    origin.to_str().is_ok_and(|o| {
        o.starts_with("chrome-extension://")
            || o.starts_with("moz-extension://")
            || o.starts_with("safari-web-extension://")
    })
}

/// Requests without an Origin come from local tools (curl, scripts) and still
/// need the token; requests with a non-extension Origin are web pages.
fn origin_allowed(headers: &HeaderMap) -> bool {
    headers.get(header::ORIGIN).is_none_or(is_extension_origin)
}

fn token_valid(app: &AppHandle, headers: &HeaderMap) -> bool {
    let expected = app.state::<AppState>().app_settings().bridge_token;
    let given = headers
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    constant_time_eq(given.as_bytes(), expected.as_bytes())
}

/// Remember which browser extension is connected and tell the UI about new ones.
/// Origin of the calling extension: the `Origin` header when the browser
/// sends one, otherwise the extension's self-reported `X-DM-Extension`.
/// Only used for requests that already passed the token check.
fn extension_origin(headers: &HeaderMap) -> Option<&str> {
    [header::ORIGIN.as_str(), EXTENSION_HEADER]
        .into_iter()
        .filter_map(|name| headers.get(name))
        .find(|v| is_extension_origin(v))
        .and_then(|v| v.to_str().ok())
}

fn note_extension(app: &AppHandle, headers: &HeaderMap) {
    let Some(origin) = extension_origin(headers) else {
        return;
    };
    let browser = headers
        .get(BROWSER_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let version = headers.get(VERSION_HEADER).and_then(|v| v.to_str().ok());
    match app
        .state::<AppState>()
        .record_extension(origin, browser, version)
    {
        ExtensionChange::New(ext) => {
            let _ = app.emit("dm://extension-connected", &ext);
        }
        ExtensionChange::Version(ext) => {
            let _ = app.emit("dm://extension-updated", &ext);
        }
        ExtensionChange::Unchanged | ExtensionChange::Touched => {}
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn error(status: StatusCode, msg: &str) -> Response {
    (status, Json(json!({ "ok": false, "error": msg }))).into_response()
}

async fn ping(State(app): State<AppHandle>, headers: HeaderMap) -> Response {
    if !origin_allowed(&headers) {
        return error(StatusCode::FORBIDDEN, "origin not allowed");
    }
    let paired = token_valid(&app, &headers);
    if paired {
        note_extension(&app, &headers);
    }
    Json(json!({
        "app": "DownloadManager",
        "version": env!("CARGO_PKG_VERSION"),
        "paired": paired,
        // Lets the extension notice it is older than the one bundled with the app.
        "extensionVersion": crate::extension_setup::bundled_version(&app),
        // The extension shows its text in the app's language, not the browser's.
        "language": crate::i18n::code(),
    }))
    .into_response()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PairBody {
    #[serde(default)]
    browser: String,
}

/// The extension asks for the token; the user approves in the app.
async fn pair(
    State(app): State<AppHandle>,
    headers: HeaderMap,
    Json(body): Json<PairBody>,
) -> Response {
    let Some(origin) = headers
        .get(header::ORIGIN)
        .filter(|o| is_extension_origin(o))
        .and_then(|o| o.to_str().ok())
        .map(str::to_owned)
    else {
        return error(
            StatusCode::FORBIDDEN,
            "pairing is only available to browser extensions",
        );
    };
    let state = app.state::<AppState>();
    let (tx, rx) = tokio::sync::oneshot::channel();
    let request = PairRequest {
        id: state.next_id(),
        origin,
        browser: body.browser,
    };
    let id = request.id;
    state
        .pair_requests
        .lock()
        .unwrap()
        .insert(id, (request.clone(), tx));
    let _ = app.emit("dm://pair-request", &request);
    show_main_window(&app);

    let approved = tokio::time::timeout(Duration::from_secs(120), rx).await;
    state.pair_requests.lock().unwrap().remove(&id);
    match approved {
        Ok(Ok(true)) => {
            Json(json!({ "ok": true, "token": state.app_settings().bridge_token })).into_response()
        }
        _ => error(StatusCode::FORBIDDEN, "pairing was declined"),
    }
}

async fn capture(
    State(app): State<AppHandle>,
    headers: HeaderMap,
    Json(mut c): Json<Capture>,
) -> Response {
    if !origin_allowed(&headers) {
        return error(StatusCode::FORBIDDEN, "origin not allowed");
    }
    if !token_valid(&app, &headers) {
        return error(StatusCode::UNAUTHORIZED, "invalid token");
    }
    note_extension(&app, &headers);
    if !(c.url.starts_with("http://") || c.url.starts_with("https://")) {
        return error(StatusCode::BAD_REQUEST, "only http(s) URLs are supported");
    }
    let state = app.state::<AppState>();
    // Without yt-dlp a video page cannot start; the dialog offers to install it.
    let needs_tools =
        c.kind == Some(dm_core::DownloadKind::Media) && state.engine.media_tools().is_none();
    if state.app_settings().confirm_captures || needs_tools {
        c.id = state.next_id();
        state.captures.lock().unwrap().push(c);
        let _ = app.emit("dm://capture", ());
        show_main_window(&app);
    } else if let Err(e) = state.engine.add(NewDownload {
        url: c.url,
        file_name: c.file_name,
        headers: c.headers,
        kind: c.kind,
        ..Default::default()
    }) {
        return error(StatusCode::BAD_REQUEST, &e.to_string());
    }
    Json(json!({ "ok": true })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.insert(
                HeaderName::from_bytes(k.as_bytes()).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    }

    #[test]
    fn origin_header_wins() {
        let h = headers(&[
            ("origin", "chrome-extension://aaa"),
            (EXTENSION_HEADER, "chrome-extension://bbb"),
        ]);
        assert_eq!(extension_origin(&h), Some("chrome-extension://aaa"));
    }

    #[test]
    fn falls_back_to_extension_header_without_origin() {
        // Chromium GET from an extension with host permissions: no Origin.
        let h = headers(&[(EXTENSION_HEADER, "chrome-extension://bbb")]);
        assert_eq!(extension_origin(&h), Some("chrome-extension://bbb"));
    }

    #[test]
    fn ignores_non_extension_values() {
        let h = headers(&[
            ("origin", "https://evil.example"),
            (EXTENSION_HEADER, "https://evil.example"),
        ]);
        assert_eq!(extension_origin(&h), None);
        assert_eq!(extension_origin(&HeaderMap::new()), None);
    }
}
