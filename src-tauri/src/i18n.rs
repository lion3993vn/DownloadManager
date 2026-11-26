//! Language of the strings the Rust side shows: the tray menu and the errors
//! commands return to the UI. Follows `AppSettings.language` ("vi", "en", or
//! "auto" = the OS language). The UI has its own tables in `src/i18n/`.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

/// Apply a language preference ("vi" | "en" | "auto").
pub fn set_preference(pref: &str) {
    let english = match pref {
        "vi" => false,
        "en" => true,
        _ => !system_is_vietnamese(),
    };
    ENGLISH.store(english, Ordering::Relaxed);
}

pub fn english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// The current language as a code: `"en"` or `"vi"`.
pub fn code() -> &'static str {
    if english() {
        "en"
    } else {
        "vi"
    }
}

fn system_is_vietnamese() -> bool {
    sys_locale::get_locale().is_some_and(|l| l.to_ascii_lowercase().starts_with("vi"))
}

/// `tr!("Vietnamese {x}", "English {x}")`: a `String` in the current
/// language. Both arguments are `format!` strings (inline captures work).
macro_rules! tr {
    ($vi:literal, $en:literal $(,)?) => {
        if $crate::i18n::english() {
            format!($en)
        } else {
            format!($vi)
        }
    };
}
pub(crate) use tr;
