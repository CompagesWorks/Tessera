use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{DateTime, SecondsFormat, Utc};
use regex::Regex;

static ISO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$").unwrap());

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn iso_of(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn is_iso(value: &str) -> bool {
    ISO.is_match(value) && DateTime::parse_from_rfc3339(&normalize(value)).is_ok()
}

fn normalize(value: &str) -> String {
    if value.len() == 17 {
        format!("{}:00Z", &value[..16])
    } else {
        value.to_string()
    }
}

pub fn millis_of(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(&normalize(value)).ok().map(|t| t.timestamp_millis())
}

pub fn now_millis() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn mtime_ms(time: SystemTime) -> f64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

pub fn stamp_for_file() -> String {
    now_iso().replace([':', '.'], "-")
}
