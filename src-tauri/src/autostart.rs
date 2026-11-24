//! "Start with the system": registers the app to launch at login.
//!
//! The OS registration is the source of truth (the user can also turn it off
//! in Task Manager), so nothing is stored in the settings table.
//!
//! - Windows: `HKCU\…\CurrentVersion\Run\DownloadManager` (current user only,
//!   never HKLM). The NSIS uninstaller removes it (`installer/hooks.nsh`).
//! - macOS: a LaunchAgent plist. Linux: an XDG autostart `.desktop` file.
//!
//! The entry passes [`AUTOSTART_ARG`], so a launch at login starts hidden in
//! the tray instead of opening the window.

use auto_launch::{AutoLaunch, AutoLaunchBuilder};

/// Argument added to the login entry.
pub const AUTOSTART_ARG: &str = "--autostart";
/// Registry value / agent name. Keep in sync with `installer/hooks.nsh`.
const ENTRY_NAME: &str = "DownloadManager";

/// True when this process was started by the login entry.
pub fn launched_at_login() -> bool {
    std::env::args().any(|a| a == AUTOSTART_ARG)
}

fn launcher() -> Result<AutoLaunch, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    #[allow(unused_mut)]
    let mut path = exe.display().to_string();
    // An AppImage runs from a temporary mount: register the image itself.
    #[cfg(target_os = "linux")]
    if let Some(image) = std::env::var_os("APPIMAGE") {
        path = image.to_string_lossy().into_owned();
    }
    // auto-launch writes `<path> <args>` unquoted; a path with spaces would
    // then be split by Windows (or by the desktop file's Exec parser).
    #[cfg(not(target_os = "macos"))]
    if path.contains(' ') {
        path = format!("\"{path}\"");
    }
    AutoLaunchBuilder::new()
        .set_app_name(ENTRY_NAME)
        .set_app_path(&path)
        .set_args(&[AUTOSTART_ARG])
        .set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser)
        .set_macos_launch_mode(auto_launch::MacOSLaunchMode::LaunchAgent)
        .build()
        .map_err(|e| e.to_string())
}

pub fn is_enabled() -> bool {
    launcher()
        .and_then(|l| l.is_enabled().map_err(|e| e.to_string()))
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "could not read autostart state");
            false
        })
}

pub fn set_enabled(enabled: bool) -> Result<(), String> {
    let l = launcher()?;
    let result = if enabled { l.enable() } else { l.disable() };
    result.map_err(|e| format!("Không thể đổi chế độ khởi động cùng hệ thống: {e}"))
}
