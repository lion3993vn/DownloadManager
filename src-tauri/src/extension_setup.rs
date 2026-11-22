//! Installing the browser extension from inside the app.
//!
//! Browsers do not let third-party programs silently install extensions that
//! are not published in their stores, so the app does everything else:
//! it unpacks the bundled extension to a stable folder, writes the pairing
//! token into it (the extension pairs itself on load), detects the installed
//! browsers and opens their extension page so the user only has to click
//! "Load unpacked" and paste the path.

use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
    pub id: &'static str,
    pub name: &'static str,
    /// "chromium" or "firefox": decides which install steps to show.
    pub engine: &'static str,
    pub extensions_url: &'static str,
    #[serde(skip)]
    pub exe: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSetupInfo {
    pub folder: String,
    pub manifest_path: String,
    pub browsers: Vec<BrowserInfo>,
}

pub fn extension_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("browser-extension"))
}

/// `version` of the extension bundled with this app (its `manifest.json`).
/// Connected extensions reporting an older version are outdated.
pub fn bundled_version(app: &AppHandle) -> Option<String> {
    static VERSION: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    VERSION
        .get_or_init(|| {
            let manifest = app
                .path()
                .resolve("extension/manifest.json", BaseDirectory::Resource)
                .ok()?;
            manifest_version(&std::fs::read_to_string(manifest).ok()?)
        })
        .clone()
}

fn manifest_version(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("version")?.as_str().map(str::to_owned)
}

/// Copy the bundled extension into the app data folder and write the pairing file.
pub fn prepare(app: &AppHandle) -> Result<PathBuf, String> {
    let src = app
        .path()
        .resolve("extension", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    let dst = extension_dir(app).map_err(|e| e.to_string())?;
    if !src.join("manifest.json").exists() {
        return Err(format!("bundled extension not found at {}", src.display()));
    }
    // Start clean so files removed in a new version do not linger.
    let _ = std::fs::remove_dir_all(&dst);
    copy_dir(&src, &dst).map_err(|e| format!("copy extension: {e}"))?;
    write_pairing(app)?;
    Ok(dst)
}

/// `pairing.json` lets the unpacked extension pair itself without user input.
/// Rewritten whenever the token changes.
pub fn write_pairing(app: &AppHandle) -> Result<(), String> {
    let dir = extension_dir(app).map_err(|e| e.to_string())?;
    if !dir.exists() {
        return Ok(());
    }
    let s = app.state::<AppState>().app_settings();
    let body = serde_json::json!({ "token": s.bridge_token, "port": s.bridge_port });
    std::fs::write(dir.join("pairing.json"), body.to_string()).map_err(|e| e.to_string())
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if entry.file_name() != "pairing.json" {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

pub fn info(app: &AppHandle) -> Result<ExtensionSetupInfo, String> {
    let mut dir = extension_dir(app).map_err(|e| e.to_string())?;
    if !dir.join("manifest.json").exists() {
        dir = prepare(app)?;
    }
    Ok(ExtensionSetupInfo {
        folder: dir.to_string_lossy().into_owned(),
        manifest_path: dir.join("manifest.json").to_string_lossy().into_owned(),
        browsers: detect_browsers(),
    })
}

/// Bring up the browser so the user can open its extension page.
///
/// Chromium browsers refuse `chrome://` URLs passed on the command line (a
/// security measure), so for them we only open a new window and the UI puts
/// the address on the clipboard. Firefox accepts `about:debugging` directly.
pub fn open_extensions_page(browser_id: &str) -> Result<(), String> {
    let b = detect_browsers()
        .into_iter()
        .find(|b| b.id == browser_id)
        .ok_or("Không tìm thấy trình duyệt này")?;
    let args: Vec<String> = if b.engine == "firefox" {
        vec![b.extensions_url.to_string()]
    } else {
        // Open the last used profile directly; otherwise users with several
        // profiles get the profile picker first.
        let mut a = vec!["--new-window".to_string()];
        if let Some(profile) = last_used_profile(b.id) {
            a.push(format!("--profile-directory={profile}"));
        }
        a
    };
    launch(&b.exe, &args).map_err(|e| format!("Không mở được {}: {e}", b.name))
}

#[cfg(target_os = "macos")]
fn launch(app_bundle: &Path, args: &[String]) -> std::io::Result<()> {
    let mut cmd = std::process::Command::new("open");
    cmd.arg("-a").arg(app_bundle);
    if args.iter().any(|a| a.starts_with("--")) {
        // -n: new instance so the flags are honoured even if already running.
        cmd.arg("-n").arg("--args");
    }
    cmd.args(args).spawn().map(drop)
}

#[cfg(not(target_os = "macos"))]
fn launch(exe: &Path, args: &[String]) -> std::io::Result<()> {
    std::process::Command::new(exe).args(args).spawn().map(drop)
}

/// Chromium "User Data" directory for a browser id.
fn user_data_dir(id: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    let (base, rel) = (
        PathBuf::from(std::env::var_os("LOCALAPPDATA")?),
        match id {
            "chrome" => r"Google\Chrome\User Data",
            "edge" => r"Microsoft\Edge\User Data",
            "coccoc" => r"CocCoc\Browser\User Data",
            "brave" => r"BraveSoftware\Brave-Browser\User Data",
            "vivaldi" => r"Vivaldi\User Data",
            _ => return None,
        },
    );
    #[cfg(target_os = "macos")]
    let (base, rel) = (
        PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support"),
        match id {
            "chrome" => "Google/Chrome",
            "edge" => "Microsoft Edge",
            "coccoc" => "Coccoc",
            "brave" => "BraveSoftware/Brave-Browser",
            "vivaldi" => "Vivaldi",
            _ => return None,
        },
    );
    #[cfg(all(unix, not(target_os = "macos")))]
    let (base, rel) = (
        PathBuf::from(std::env::var_os("HOME")?).join(".config"),
        match id {
            "chrome" => "google-chrome",
            "chromium" => "chromium",
            "edge" => "microsoft-edge",
            "brave" => "BraveSoftware/Brave-Browser",
            "vivaldi" => "vivaldi",
            _ => return None,
        },
    );
    Some(base.join(rel))
}

/// `profile.last_used` from the browser's `Local State` file.
fn last_used_profile(id: &str) -> Option<String> {
    let dir = user_data_dir(id)?;
    let text = std::fs::read_to_string(dir.join("Local State")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    let profile = json.get("profile")?.get("last_used")?.as_str()?.to_string();
    dir.join(&profile).is_dir().then_some(profile)
}

struct Candidate {
    id: &'static str,
    name: &'static str,
    engine: &'static str,
    extensions_url: &'static str,
    #[allow(dead_code)]
    paths: &'static [&'static str],
}

const FIREFOX_URL: &str = "about:debugging#/runtime/this-firefox";

#[cfg(windows)]
const CANDIDATES: &[Candidate] = &[
    Candidate {
        id: "chrome",
        name: "Google Chrome",
        engine: "chromium",
        extensions_url: "chrome://extensions",
        paths: &[
            r"%ProgramFiles%\Google\Chrome\Application\chrome.exe",
            r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe",
            r"%LocalAppData%\Google\Chrome\Application\chrome.exe",
        ],
    },
    Candidate {
        id: "edge",
        name: "Microsoft Edge",
        engine: "chromium",
        extensions_url: "edge://extensions",
        paths: &[
            r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe",
            r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe",
        ],
    },
    Candidate {
        id: "coccoc",
        name: "Cốc Cốc",
        engine: "chromium",
        extensions_url: "chrome://extensions",
        paths: &[
            r"%LocalAppData%\CocCoc\Browser\Application\browser.exe",
            r"%ProgramFiles%\CocCoc\Browser\Application\browser.exe",
            r"%ProgramFiles(x86)%\CocCoc\Browser\Application\browser.exe",
        ],
    },
    Candidate {
        id: "brave",
        name: "Brave",
        engine: "chromium",
        extensions_url: "brave://extensions",
        paths: &[
            r"%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe",
            r"%LocalAppData%\BraveSoftware\Brave-Browser\Application\brave.exe",
        ],
    },
    Candidate {
        id: "opera",
        name: "Opera",
        engine: "chromium",
        extensions_url: "opera://extensions",
        paths: &[
            r"%LocalAppData%\Programs\Opera\opera.exe",
            r"%LocalAppData%\Programs\Opera GX\opera.exe",
        ],
    },
    Candidate {
        id: "vivaldi",
        name: "Vivaldi",
        engine: "chromium",
        extensions_url: "vivaldi://extensions",
        paths: &[
            r"%LocalAppData%\Vivaldi\Application\vivaldi.exe",
            r"%ProgramFiles%\Vivaldi\Application\vivaldi.exe",
        ],
    },
    Candidate {
        id: "firefox",
        name: "Firefox",
        engine: "firefox",
        extensions_url: FIREFOX_URL,
        paths: &[
            r"%ProgramFiles%\Mozilla Firefox\firefox.exe",
            r"%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe",
        ],
    },
];

#[cfg(target_os = "macos")]
const CANDIDATES: &[Candidate] = &[
    Candidate {
        id: "chrome",
        name: "Google Chrome",
        engine: "chromium",
        extensions_url: "chrome://extensions",
        paths: &["/Applications/Google Chrome.app"],
    },
    Candidate {
        id: "edge",
        name: "Microsoft Edge",
        engine: "chromium",
        extensions_url: "edge://extensions",
        paths: &["/Applications/Microsoft Edge.app"],
    },
    Candidate {
        id: "coccoc",
        name: "Cốc Cốc",
        engine: "chromium",
        extensions_url: "chrome://extensions",
        paths: &["/Applications/CocCoc.app"],
    },
    Candidate {
        id: "brave",
        name: "Brave",
        engine: "chromium",
        extensions_url: "brave://extensions",
        paths: &["/Applications/Brave Browser.app"],
    },
    Candidate {
        id: "opera",
        name: "Opera",
        engine: "chromium",
        extensions_url: "opera://extensions",
        paths: &["/Applications/Opera.app"],
    },
    Candidate {
        id: "vivaldi",
        name: "Vivaldi",
        engine: "chromium",
        extensions_url: "vivaldi://extensions",
        paths: &["/Applications/Vivaldi.app"],
    },
    Candidate {
        id: "firefox",
        name: "Firefox",
        engine: "firefox",
        extensions_url: FIREFOX_URL,
        paths: &["/Applications/Firefox.app"],
    },
];

#[cfg(all(unix, not(target_os = "macos")))]
const CANDIDATES: &[Candidate] = &[
    Candidate {
        id: "chrome",
        name: "Google Chrome",
        engine: "chromium",
        extensions_url: "chrome://extensions",
        paths: &["google-chrome-stable", "google-chrome"],
    },
    Candidate {
        id: "chromium",
        name: "Chromium",
        engine: "chromium",
        extensions_url: "chrome://extensions",
        paths: &["chromium", "chromium-browser"],
    },
    Candidate {
        id: "edge",
        name: "Microsoft Edge",
        engine: "chromium",
        extensions_url: "edge://extensions",
        paths: &["microsoft-edge-stable", "microsoft-edge"],
    },
    Candidate {
        id: "brave",
        name: "Brave",
        engine: "chromium",
        extensions_url: "brave://extensions",
        paths: &["brave-browser", "brave"],
    },
    Candidate {
        id: "opera",
        name: "Opera",
        engine: "chromium",
        extensions_url: "opera://extensions",
        paths: &["opera"],
    },
    Candidate {
        id: "vivaldi",
        name: "Vivaldi",
        engine: "chromium",
        extensions_url: "vivaldi://extensions",
        paths: &["vivaldi-stable", "vivaldi"],
    },
    Candidate {
        id: "firefox",
        name: "Firefox",
        engine: "firefox",
        extensions_url: FIREFOX_URL,
        paths: &["firefox"],
    },
];

pub fn detect_browsers() -> Vec<BrowserInfo> {
    CANDIDATES
        .iter()
        .filter_map(|c| {
            c.paths
                .iter()
                .find_map(|p| resolve(p))
                .map(|exe| BrowserInfo {
                    id: c.id,
                    name: c.name,
                    engine: c.engine,
                    extensions_url: c.extensions_url,
                    exe,
                })
        })
        .collect()
}

#[cfg(windows)]
fn resolve(pattern: &str) -> Option<PathBuf> {
    // Expand %VAR% segments.
    let mut out = String::new();
    let mut rest = pattern;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let end = after.find('%')?;
        out.push_str(&std::env::var(&after[..end]).ok()?);
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    let p = PathBuf::from(out);
    p.is_file().then_some(p)
}

#[cfg(target_os = "macos")]
fn resolve(path: &str) -> Option<PathBuf> {
    let p = PathBuf::from(path);
    if p.exists() {
        return Some(p);
    }
    // Per-user installs.
    let home = std::env::var_os("HOME")?;
    let user = PathBuf::from(home).join(path.trim_start_matches('/'));
    user.exists().then_some(user)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn resolve(binary: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|dir| dir.join(binary))
        .find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_bundled_manifest_version() {
        let manifest = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../extension/manifest.json"
        ))
        .unwrap();
        assert_eq!(
            manifest_version(&manifest).as_deref(),
            Some(env!("CARGO_PKG_VERSION")),
            "extension/manifest.json and the app must have the same version"
        );
        assert_eq!(manifest_version("{}"), None);
        assert_eq!(manifest_version("not json"), None);
    }
}
