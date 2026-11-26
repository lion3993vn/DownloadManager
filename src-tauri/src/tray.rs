//! System tray icon: quick actions and a running-downloads tooltip.

use crate::i18n::tr;
use crate::state::AppState;
use crate::window::show_main_window;
use dm_core::{DownloadInfo, Status};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

const TRAY_ID: &str = "main-tray";

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let show = MenuItem::with_id(
        app,
        "show",
        tr!("Mở DownloadManager", "Open DownloadManager"),
        true,
        None::<&str>,
    )?;
    let pause = MenuItem::with_id(
        app,
        "pause_all",
        tr!("Tạm dừng tất cả", "Pause all"),
        true,
        None::<&str>,
    )?;
    let resume = MenuItem::with_id(
        app,
        "resume_all",
        tr!("Tiếp tục tất cả", "Resume all"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", tr!("Thoát", "Quit"), true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    Menu::with_items(app, &[&show, &sep, &pause, &resume, &sep, &quit])
}

/// Rebuild the menu and tooltip after a language change.
pub fn refresh_menu(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Ok(menu) = build_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
    update_tooltip(app);
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("DownloadManager")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "pause_all" => app.state::<AppState>().engine.pause_all(),
            "resume_all" => app.state::<AppState>().engine.resume_all(),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Keep the tray tooltip in sync with the number of active downloads.
pub fn on_download_updated(app: &AppHandle, _changed: &DownloadInfo) {
    update_tooltip(app);
}

fn update_tooltip(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    // Events can arrive before the state is registered during startup.
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let active = state
        .engine
        .list()
        .iter()
        .filter(|d| d.status == Status::Downloading)
        .count();
    let tip = if active == 0 {
        "DownloadManager".to_string()
    } else {
        tr!(
            "DownloadManager — đang tải {active} tệp",
            "DownloadManager — downloading {active} file(s)"
        )
    };
    let _ = tray.set_tooltip(Some(tip));
}
