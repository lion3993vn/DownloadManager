//! File name helpers: derive, sanitize and de-duplicate names.

use percent_encoding::percent_decode_str;
use std::path::{Path, PathBuf};

const FALLBACK_NAME: &str = "download";

/// Last path segment of the URL, percent-decoded and sanitized.
pub fn name_from_url(url: &str) -> String {
    let name = reqwest::Url::parse(url)
        .ok()
        .and_then(|u| {
            u.path_segments()
                .and_then(|mut s| s.next_back().map(str::to_owned))
        })
        .map(|seg| percent_decode_str(&seg).decode_utf8_lossy().into_owned())
        .unwrap_or_default();
    sanitize(&name)
}

/// Parse the file name out of a `Content-Disposition` header value.
/// Prefers RFC 5987 `filename*=UTF-8''...` over plain `filename=`.
pub fn name_from_content_disposition(value: &str) -> Option<String> {
    let mut plain = None;
    let mut extended = None;
    for part in split_params(value) {
        let Some((key, val)) = part.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let val = val.trim();
        if key == "filename*" {
            // charset'lang'percent-encoded
            let encoded = val.splitn(3, '\'').nth(2).unwrap_or(val);
            extended = Some(
                percent_decode_str(encoded.trim_matches('"'))
                    .decode_utf8_lossy()
                    .into_owned(),
            );
        } else if key == "filename" {
            let unquoted = val.trim_matches('"').replace("\\\"", "\"");
            plain = Some(
                percent_decode_str(&unquoted)
                    .decode_utf8_lossy()
                    .into_owned(),
            );
        }
    }
    extended
        .or(plain)
        .filter(|n| !n.trim().is_empty())
        .map(|n| sanitize(&n))
}

/// Split on `;` while respecting double-quoted strings.
fn split_params(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for c in value.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                current.push(c);
            }
            ';' if !in_quotes => parts.push(std::mem::take(&mut current)),
            _ => current.push(c),
        }
    }
    parts.push(current);
    parts
}

/// Make a name safe on every OS (Windows is the strictest).
pub fn sanitize(name: &str) -> String {
    // Strip any directory components a server might sneak in.
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let mut out: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    out = out.trim().trim_end_matches(['.', ' ']).to_string();
    if out.is_empty() || out == "." || out == ".." {
        return FALLBACK_NAME.to_string();
    }
    let stem = out.split('.').next().unwrap_or("").to_ascii_uppercase();
    const RESERVED: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if RESERVED.contains(&stem.as_str()) {
        out.insert(0, '_');
    }
    // Keep well under the 255-byte limit of most file systems.
    if out.len() > 200 {
        let (stem, ext) = split_ext(&out);
        let mut cut = 200usize.saturating_sub(ext.len());
        while !stem.is_char_boundary(cut.min(stem.len())) {
            cut -= 1;
        }
        out = format!("{}{}", &stem[..cut.min(stem.len())], ext);
    }
    out
}

/// `"a.tar.gz"` -> `("a.tar", ".gz")`, `"README"` -> `("README", "")`.
fn split_ext(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    }
}

/// Return `name` or `name (1).ext`, `name (2).ext`, ... so that `taken` is false
/// and no file exists at that path in `dir`.
pub fn unique_name(dir: &Path, name: &str, taken: impl Fn(&str) -> bool) -> String {
    let free = |candidate: &str| !taken(candidate) && !dir.join(candidate).exists();
    if free(name) {
        return name.to_string();
    }
    let (stem, ext) = split_ext(name);
    (1..)
        .map(|i| format!("{stem} ({i}){ext}"))
        .find(|c| free(c))
        .expect("infinite iterator")
}

pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(unique_name(dir, name, |_| false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_names() {
        assert_eq!(
            name_from_url("https://x.com/a/b/file%20one.zip?x=1"),
            "file one.zip"
        );
        assert_eq!(name_from_url("https://x.com/"), "download");
        assert_eq!(name_from_url("https://x.com"), "download");
    }

    #[test]
    fn content_disposition() {
        assert_eq!(
            name_from_content_disposition("attachment; filename=\"report;v2.pdf\"").as_deref(),
            Some("report;v2.pdf")
        );
        assert_eq!(
            name_from_content_disposition(
                "attachment; filename=a.txt; filename*=UTF-8''t%C3%A0i%20li%E1%BB%87u.txt"
            )
            .as_deref(),
            Some("tài liệu.txt")
        );
        assert_eq!(name_from_content_disposition("inline"), None);
    }

    #[test]
    fn sanitizing() {
        assert_eq!(sanitize("../../etc/passwd"), "passwd");
        assert_eq!(sanitize("a<b>:c?.txt"), "a_b__c_.txt");
        assert_eq!(sanitize("con.txt"), "_con.txt");
        assert_eq!(sanitize("name. "), "name");
        assert_eq!(sanitize(""), "download");
    }

    #[test]
    fn unique() {
        let dir = std::env::temp_dir();
        let taken = |n: &str| n == "x.zip" || n == "x (1).zip";
        assert_eq!(unique_name(&dir, "x.zip", taken), "x (2).zip");
    }
}
