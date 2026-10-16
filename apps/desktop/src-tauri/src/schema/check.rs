use std::sync::LazyLock;

use regex::Regex;

use crate::util::{Error, Result};

macro_rules! pattern {
    ($name:ident, $re:expr) => {
        pub static $name: LazyLock<Regex> = LazyLock::new(|| Regex::new($re).unwrap());
    };
}

pattern!(UUID, r"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$");
pattern!(NODE_ID, r"^[a-z0-9-]{1,40}$");
pattern!(ICON, r"^[a-z0-9-]{1,40}$");
pattern!(ICON_IMAGE, r"(?i)\.(png|svg|webp|jpe?g|gif)$");
pattern!(WIDGET_TYPE, r"^[a-z0-9-]+(\.[a-z0-9-]+)*/[a-z0-9-]+$");
pattern!(PLUGIN_ID, r"^[a-z0-9-]+(\.[a-z0-9-]+)+$");
pattern!(RESERVED_ID, r"^(core|tessera)(\.|$)");
pattern!(DOMAIN, r"^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$");
pattern!(SHA256, r"^[a-f0-9]{64}$");
pattern!(PROGRAM_NAME, r"^[a-z0-9-]{1,40}$");
pattern!(COMMAND_ID, r"^[a-z0-9.-]{1,60}$");
pattern!(SHORTCUT, r"^((Mod|Ctrl|Meta|Alt|Shift)\+)*([A-Z0-9]|F\d{1,2}|[,.;/\-=`\[\]\\']|Enter|Space|Tab|Backspace|Delete|Home|End|PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$");
pattern!(ACCENT, r"^#[0-9a-f]{6}$");
pattern!(COLOR, r"^#[0-9a-fA-F]{6}$");
pattern!(SETTING_KEY, r"^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$");
pattern!(TOKEN_NAME, r"^--atrium-[a-z0-9-]{1,60}$");
pattern!(TOKEN_VALUE, r#"^[A-Za-z0-9#%(),.\-+ /'"]+$"#);
pattern!(TOKEN_FORBIDDEN, r"(?i)url\s*\(|expression|image-set|@import");
pattern!(RELATIVE_PATH, r"^[A-Za-z0-9._\-/]+$");
pattern!(VERSION, r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$");
pattern!(FORBIDDEN_NAME, r#"[<>:"/\\|?*\x00-\x1f]"#);
pattern!(DOTS_ONLY, r"^\.+$");
pattern!(SECRET_KEY, r"^[A-Za-z0-9._-]{1,64}$");
pattern!(BACKUP_ID, r"^\d{1,6}$");
pattern!(ARC_VERSION, r"^(latest|\d{1,2}\.\d{1,3}(\.\d{1,3})?)$");
pattern!(DISCORD_CLIENT, r"^\d{17,20}$");

pub fn len(text: &str) -> usize {
    text.encode_utf16().count()
}

pub fn js_trim(text: &str) -> String {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}').to_string()
}

pub fn fail<T>(path: &str, message: &str) -> Result<T> {
    Err(Error::new(if path.is_empty() { message.to_string() } else { format!("{path}: {message}") }))
}

pub fn text(path: &str, value: &str, min: usize, max: usize) -> Result<()> {
    let n = len(value);
    if n < min {
        return fail(path, "too short");
    }
    if n > max {
        return fail(path, "too long");
    }
    Ok(())
}

pub fn trimmed(path: &str, value: &mut String, min: usize, max: usize) -> Result<()> {
    *value = js_trim(value);
    text(path, value, min, max)
}

pub fn matches(path: &str, re: &Regex, value: &str) -> Result<()> {
    if re.is_match(value) {
        Ok(())
    } else {
        fail(path, "invalid format")
    }
}

pub fn uuid(path: &str, value: &str) -> Result<()> {
    matches(path, &UUID, value)
}

pub fn is_uuid(value: &str) -> bool {
    UUID.is_match(value)
}

pub fn plugin_id(path: &str, value: &str) -> Result<()> {
    matches(path, &PLUGIN_ID, value)?;
    if len(value) > 64 {
        return fail(path, "too long");
    }
    if RESERVED_ID.is_match(value) {
        return fail(path, "reserved id");
    }
    Ok(())
}

pub fn is_plugin_id(value: &str) -> bool {
    plugin_id("", value).is_ok()
}

pub fn relative_path(path: &str, value: &str) -> Result<()> {
    text(path, value, 1, 200)?;
    matches(path, &RELATIVE_PATH, value)?;
    if value.starts_with('/') || value.split('/').any(|part| part == ".." || part.is_empty()) {
        return fail(path, "invalid path");
    }
    Ok(())
}

pub fn icon(path: &str, value: &str) -> Result<()> {
    if ICON_IMAGE.is_match(value) {
        relative_path(path, value)
    } else {
        matches(path, &ICON, value)
    }
}

pub fn plugin_path(path: &str, value: &str, min: usize) -> Result<()> {
    text(path, value, min, 400)?;
    if crate::util::paths::has_parent_segment(value) {
        return fail(path, "no parent segments");
    }
    Ok(())
}

pub fn project_name(path: &str, value: &mut String) -> Result<()> {
    trimmed(path, value, 1, 80)?;
    if FORBIDDEN_NAME.is_match(value) {
        return fail(path, "invalid characters");
    }
    Ok(())
}

pub fn note_name(path: &str, value: &mut String) -> Result<()> {
    trimmed(path, value, 1, 60)?;
    if FORBIDDEN_NAME.is_match(value) || DOTS_ONLY.is_match(value) {
        return fail(path, "invalid note name");
    }
    Ok(())
}

pub fn https_url(path: &str, value: &str, max: usize) -> Result<url::Url> {
    if len(value) > max {
        return fail(path, "too long");
    }
    match url::Url::parse(value) {
        Ok(parsed) if parsed.scheme() == "https" && parsed.host_str().is_some_and(|h| !h.is_empty()) => Ok(parsed),
        _ => fail(path, "invalid url"),
    }
}

pub fn base64(path: &str, value: &str, max: usize) -> Result<()> {
    if len(value) > max {
        return fail(path, "too long");
    }
    let ok = value.len().is_multiple_of(4) && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=');
    if ok {
        Ok(())
    } else {
        fail(path, "invalid base64")
    }
}
