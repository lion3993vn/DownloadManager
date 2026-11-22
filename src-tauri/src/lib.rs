mod bridge;
mod commands;
mod extension_setup;
mod media_tools;
mod state;
mod tray;
mod updater;
mod window;

use dm_core::{Engine, EngineEvent};
use state::AppState;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tokio::sync::broadcast::error::RecvError;

pub fn run() {
    let app = tauri::Builder::default()
        // A second launch just focuses the running instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let db_path = data.join("downloads.db");
            let tools = media_tools::detect_in(&data.join("tools"));
            let engine = tauri::async_runtime::block_on(async {
                Engine::open_with_media_tools(&db_path, tools)
            })?;
            forward_events(app.handle().clone(), engine.clone());
            app.manage(AppState::new(engine));
            // Refresh the unpacked extension (new version + current pairing token).
            if let Err(e) = extension_setup::prepare(app.handle()) {
                tracing::warn!(error = %e, "could not prepare browser extension");
            }
            bridge::start(app.handle().clone());
            tray::setup(app.handle())?;
            updater::spawn_periodic_check(app.handle().clone());
            media_tools::start(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.app_settings().close_to_tray {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_downloads,
            commands::add_download,
            commands::probe_url,
            commands::pause_download,
            commands::resume_download,
            commands::cancel_download,
            commands::remove_download,
            commands::pause_all,
            commands::resume_all,
            commands::open_file,
            commands::show_in_folder,
            commands::get_settings,
            commands::save_settings,
            commands::regenerate_token,
            commands::bridge_status,
            commands::take_captures,
            commands::pending_pair_requests,
            commands::answer_pair_request,
            commands::extension_setup_info,
            commands::connected_extensions,
            commands::extension_version,
            commands::media_tools_status,
            commands::install_media_tools,
            commands::update_media_tools,
            commands::remove_media_tools,
            commands::open_browser_extensions,
            commands::reveal_extension_folder,
            commands::check_update,
            commands::install_update,
            commands::list_releases,
            commands::open_url,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the application");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            // Checkpoint running downloads so they resume on next launch.
            let engine = app.state::<AppState>().engine.clone();
            tauri::async_runtime::block_on(engine.shutdown());
        }
    });
}

/// Relay engine events to the UI as `dm://event`.
fn forward_events(app: tauri::AppHandle, engine: Engine) {
    let mut rx = engine.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let EngineEvent::Updated { download } = &event {
                        tray::on_download_updated(&app, download);
                    }
                    let _ = app.emit("dm://event", &event);
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            }
        }
    });
}
