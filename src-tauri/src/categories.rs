//! File types and the per-type download folders ("sort by type").
//!
//! The UI asks [`category_dir`] for the folder to show in the add dialog;
//! captures that skip the dialog use [`save_dir_for`] directly. The type lists
//! match `KINDS` in `src/lib/format.ts`.

use crate::state::AppSettings;
use dm_core::DownloadKind;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Type -> extensions. "other" (anything else) stays in the download folder.
pub const KINDS: &[(&str, &[&str])] = &[
    (
        "video",
        &[
            "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "mpg", "mpeg",
        ],
    ),
    (
        "audio",
        &["mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma"],
    ),
    (
        "archive",
        &[
            "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "img", "dmg", "tgz",
        ],
    ),
    (
        "document",
        &[
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "epub", "csv", "odt", "md",
        ],
    ),
    (
        "program",
        &[
            "exe", "msi", "apk", "deb", "rpm", "appimage", "pkg", "msix", "run",
        ],
    ),
    (
        "image",
        &[
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "tiff", "heic", "avif",
        ],
    ),
];

/// Default folder names, inside the download folder.
pub fn default_dirs() -> BTreeMap<String, String> {
    [
        ("video", "Video"),
        ("audio", "Music"),
        ("archive", "Compressed"),
        ("document", "Documents"),
        ("program", "Programs"),
        ("image", "Images"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v.to_string()))
    .collect()
}

/// Lower-case extension of a file name or URL path (query and fragment ignored).
pub fn extension(name: &str) -> Option<String> {
    let path = name.split(['?', '#']).next().unwrap_or(name);
    let last = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let (stem, ext) = last.rsplit_once('.')?;
    (!stem.is_empty() && !ext.is_empty() && ext.len() <= 9).then(|| ext.to_ascii_lowercase())
}

/// The type of a file by its extension, if it has a known one.
pub fn kind_of(name: &str) -> Option<&'static str> {
    let ext = extension(name)?;
    KINDS
        .iter()
        .find(|(_, exts)| exts.contains(&ext.as_str()))
        .map(|(kind, _)| *kind)
}

/// The type of a download: video pages and HLS streams are videos (or audio
/// when only the sound is kept), files go by their extension.
pub fn kind_for(
    name: &str,
    kind: Option<DownloadKind>,
    media_quality: Option<&str>,
) -> Option<&'static str> {
    match kind {
        Some(DownloadKind::Media) if media_quality == Some("audio") => Some("audio"),
        Some(DownloadKind::Media | DownloadKind::Hls) => Some("video"),
        _ => kind_of(name),
    }
}

/// Folder for a download of type `kind` under `base`, when sorting is on.
pub fn dir_for(settings: &AppSettings, base: &Path, kind: Option<&str>) -> PathBuf {
    let Some(kind) = kind.filter(|_| settings.sort_by_type) else {
        return base.to_path_buf();
    };
    let defaults = default_dirs();
    let folder = settings
        .category_dirs
        .get(kind)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .or_else(|| defaults.get(kind).map(String::as_str));
    match folder {
        // An absolute path is used as is; a name goes inside the download folder.
        Some(f) => base.join(f),
        None => base.to_path_buf(),
    }
}

/// Save folder for a capture that skips the add dialog, or `None` for the
/// engine's default folder.
pub fn save_dir_for(
    settings: &AppSettings,
    base: &Path,
    name: &str,
    kind: Option<DownloadKind>,
    media_quality: Option<&str>,
) -> Option<PathBuf> {
    settings
        .sort_by_type
        .then(|| dir_for(settings, base, kind_for(name, kind, media_quality)))
}

/// The folder the add dialog should show for a download (sorting applied).
#[tauri::command]
pub fn category_dir(
    state: tauri::State<'_, crate::state::AppState>,
    file_name: String,
    kind: Option<DownloadKind>,
    media_quality: Option<String>,
) -> String {
    let base = state.engine.settings().download_dir;
    let k = kind_for(&file_name, kind, media_quality.as_deref());
    dir_for(&state.app_settings(), &base, k)
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_from_names_and_urls() {
        assert_eq!(kind_of("movie.MKV"), Some("video"));
        assert_eq!(
            kind_of("https://x.org/a/setup.exe?token=1#x"),
            Some("program")
        );
        assert_eq!(kind_of("archive.tar.gz"), Some("archive"));
        assert_eq!(kind_of("README"), None);
        assert_eq!(kind_of(".bashrc"), None);
        assert_eq!(
            kind_for("watch", Some(DownloadKind::Media), Some("audio")),
            Some("audio")
        );
        assert_eq!(
            kind_for("watch", Some(DownloadKind::Media), Some("1080")),
            Some("video")
        );
        assert_eq!(
            kind_for("index.m3u8", Some(DownloadKind::Hls), None),
            Some("video")
        );
    }

    #[test]
    fn folders() {
        let mut s = AppSettings::default();
        let base = Path::new("/dl");
        assert_eq!(dir_for(&s, base, Some("video")), PathBuf::from("/dl"));
        s.sort_by_type = true;
        assert_eq!(dir_for(&s, base, Some("video")), PathBuf::from("/dl/Video"));
        assert_eq!(dir_for(&s, base, None), PathBuf::from("/dl"));
        s.category_dirs.insert("video".into(), "  ".into());
        assert_eq!(dir_for(&s, base, Some("video")), PathBuf::from("/dl/Video"));
        s.category_dirs.insert("audio".into(), "Nhạc".into());
        assert_eq!(dir_for(&s, base, Some("audio")), PathBuf::from("/dl/Nhạc"));
    }
}
