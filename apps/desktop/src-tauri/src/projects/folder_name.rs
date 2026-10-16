use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use unicode_normalization::UnicodeNormalization;

use crate::util::{Error, Result};

static RESERVED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(con|prn|aux|nul|com\d|lpt\d)$").unwrap());
static FORBIDDEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"[<>:"/\\|?*\x00-\x1f]"#).unwrap());
static SPACES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static DASHES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"-+").unwrap());
static EDGES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[-.]+|[-.]+$").unwrap());

pub fn folder_name(name: &str) -> String {
    let stripped: String = name.nfkd().filter(|c| !('\u{0300}'..='\u{036f}').contains(c)).collect();
    let cleaned = FORBIDDEN.replace_all(&stripped, "");
    let cleaned = SPACES.replace_all(&cleaned, "-");
    let cleaned = DASHES.replace_all(&cleaned, "-");
    let cleaned = EDGES.replace_all(&cleaned, "").to_lowercase();
    let cleaned: String = {
        let units: Vec<u16> = cleaned.encode_utf16().take(60).collect();
        String::from_utf16_lossy(&units)
    };
    if cleaned.is_empty() || RESERVED.is_match(&cleaned) {
        return "projet".into();
    }
    cleaned
}

pub fn unique_folder(parent: &Path, base: &str) -> Result<PathBuf> {
    for i in 1..1000 {
        let candidate = parent.join(if i == 1 { base.to_string() } else { format!("{base}-{i}") });
        if std::fs::symlink_metadata(&candidate).is_err() {
            return Ok(candidate);
        }
    }
    Err(Error::new("No free folder name"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_safe_folder_names() {
        assert_eq!(folder_name("Mario Classic"), "mario-classic");
        assert_eq!(folder_name("Évolution: <test>"), "evolution-test");
        assert_eq!(folder_name("CON"), "projet");
        assert_eq!(folder_name("..."), "projet");
    }
}
