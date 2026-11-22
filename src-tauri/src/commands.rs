//! Commands invoked from the React UI.

use crate::extension_setup::{self, ExtensionSetupInfo};
use crate::state::{
    new_token, AppSettings, AppState, BridgeStatus, Capture, ConnectedExtension, PairRequest,
};
use dm_core::{
    DownloadId, DownloadInfo, EngineSettings, NewDownload, ProbeResult, RequestHeaders, Status,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[tauri::command]
pub fn list_downloads(state: State<'_, AppState>) -> Vec<DownloadInfo> {
    state.engine.list()
}

#[tauri::command]
pub fn add_download(state: State<'_, AppState>, request: NewDownload) -> CmdResult<DownloadInfo> {
    state.engine.add(request).map_err(err)
}

#[tauri::command]
pub async fn probe_url(
    state: State<'_, AppState>,
    url: String,
    headers: Option<RequestHeaders>,
) -> CmdResult<ProbeResult> {
    let engine = state.engine.clone();
    engine
        .probe(url.trim(), &headers.unwrap_or_default())
        .await
        .map_err(err)
}

#[tauri::command]
pub fn pause_download(state: State<'_, AppState>, id: DownloadId) -> CmdResult<()> {
    state.engine.pause(id).map_err(err)
}

#[tauri::command]
pub fn resume_download(state: State<'_, AppState>, id: DownloadId) -> CmdResult<()> {
    state.engine.resume(id).map_err(err)
}

#[tauri::command]
pub fn cancel_download(state: State<'_, AppState>, id: DownloadId) -> CmdResult<()> {
    state.engine.cancel(id).map_err(err)
}

#[tauri::command]
pub fn remove_download(
    state: State<'_, AppState>,
    id: DownloadId,
    delete_file: bool,
) -> CmdResult<()> {
    state.engine.remove(id, delete_file).map_err(err)
}

#[tauri::command]
pub fn pause_all(state: State<'_, AppState>) {
    state.engine.pause_all();
}

#[tauri::command]
pub fn resume_all(state: State<'_, AppState>) {
    state.engine.resume_all();
}

#[tauri::command]
pub fn open_file(app: AppHandle, state: State<'_, AppState>, id: DownloadId) -> CmdResult<()> {
    let d = state.engine.get(id).ok_or("download not found")?;
    if d.status != Status::Completed {
        return Err("Tệp chưa tải xong".into());
    }
    app.opener()
        .open_path(d.file_path().to_string_lossy(), None::<&str>)
        .map_err(err)
}

#[tauri::command]
pub fn show_in_folder(app: AppHandle, state: State<'_, AppState>, id: DownloadId) -> CmdResult<()> {
    let d = state.engine.get(id).ok_or("download not found")?;
    let target = [d.file_path(), d.part_path()]
        .into_iter()
        .find(|p| p.exists());
    match target {
        Some(path) => app.opener().reveal_item_in_dir(path).map_err(err),
        None => app
            .opener()
            .open_path(d.save_dir.to_string_lossy(), None::<&str>)
            .map_err(err),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsDto {
    pub engine: EngineSettings,
    pub app: AppSettings,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> SettingsDto {
    SettingsDto {
        engine: state.engine.settings(),
        app: state.app_settings(),
    }
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: SettingsDto) -> CmdResult<SettingsDto> {
    state.engine.update_settings(settings.engine).map_err(err)?;
    {
        let mut app = state.settings.write().unwrap();
        // The token and port are managed separately.
        app.confirm_captures = settings.app.confirm_captures;
        app.close_to_tray = settings.app.close_to_tray;
        app.save(&state.engine);
    }
    Ok(get_settings(state))
}

#[tauri::command]
pub fn regenerate_token(handle: AppHandle, state: State<'_, AppState>) -> String {
    let token = {
        let mut app = state.settings.write().unwrap();
        app.bridge_token = new_token();
        app.save(&state.engine);
        app.bridge_token.clone()
    };
    // Old pairings become invalid; the bundled extension re-reads this file.
    state.extensions.lock().unwrap().clear();
    let _ = state.engine.set_kv("connected_extensions", "[]");
    let _ = extension_setup::write_pairing(&handle);
    token
}

#[tauri::command]
pub fn extension_setup_info(app: AppHandle) -> CmdResult<ExtensionSetupInfo> {
    extension_setup::info(&app)
}

/// Version of the extension bundled with the app.
#[tauri::command]
pub fn extension_version(app: AppHandle) -> Option<String> {
    crate::extension_setup::bundled_version(&app)
}

#[tauri::command]
pub fn connected_extensions(state: State<'_, AppState>) -> Vec<ConnectedExtension> {
    state.extensions.lock().unwrap().clone()
}

#[tauri::command]
pub fn open_browser_extensions(browser_id: String) -> CmdResult<()> {
    extension_setup::open_extensions_page(&browser_id)
}

#[tauri::command]
pub fn reveal_extension_folder(app: AppHandle) -> CmdResult<()> {
    let info = extension_setup::info(&app)?;
    app.opener()
        .reveal_item_in_dir(info.manifest_path)
        .map_err(err)
}

#[tauri::command]
pub fn bridge_status(state: State<'_, AppState>) -> BridgeStatus {
    state.bridge.read().unwrap().clone()
}

/// Captured downloads waiting for the user's confirmation (drains the queue).
#[tauri::command]
pub fn take_captures(state: State<'_, AppState>) -> Vec<Capture> {
    std::mem::take(&mut *state.captures.lock().unwrap())
}

#[tauri::command]
pub fn pending_pair_requests(state: State<'_, AppState>) -> Vec<PairRequest> {
    state
        .pair_requests
        .lock()
        .unwrap()
        .values()
        .map(|(r, _)| r.clone())
        .collect()
}

#[tauri::command]
pub fn answer_pair_request(state: State<'_, AppState>, id: u64, approve: bool) {
    if let Some((_, tx)) = state.pair_requests.lock().unwrap().remove(&id) {
        let _ = tx.send(approve);
    }
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> CmdResult<crate::updater::UpdateStatus> {
    crate::updater::check(&app).await
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> CmdResult<()> {
    crate::updater::install(app).await
}

#[tauri::command]
pub async fn list_releases() -> CmdResult<Vec<crate::updater::ReleaseInfo>> {
    crate::updater::releases().await
}

/// Open a web link (from release notes) in the default browser.
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> CmdResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Chỉ mở được liên kết http(s)".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(err)
}
