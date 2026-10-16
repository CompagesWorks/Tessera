use std::cmp::Ordering;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde_json::Value;

use crate::plugins::net::get_json;
use crate::schema::tools::UpdateInfo;

pub const RELEASES_API: &str = "https://api.github.com/repos/CompagesWorks/Tessera/releases/latest";
const RELEASE_PREFIX: &str = "https://github.com/CompagesWorks/Tessera/";
const MAX_NOTES: usize = 2000;
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$").unwrap());

fn parts(version: &str) -> (Vec<i64>, String) {
    let trimmed = version.strip_prefix(['v', 'V']).unwrap_or(version);
    let mut split = trimmed.splitn(2, '-');
    let core = split.next().unwrap_or_default();
    let pre = split.next().unwrap_or_default().to_string();
    let numbers = core.split('.').map(|n| n.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0)).collect();
    (numbers, pre)
}

pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let (left, left_pre) = parts(a);
    let (right, right_pre) = parts(b);
    for i in 0..3 {
        let order = left.get(i).copied().unwrap_or(0).cmp(&right.get(i).copied().unwrap_or(0));
        if order != Ordering::Equal {
            return order;
        }
    }
    match (left_pre.is_empty(), right_pre.is_empty()) {
        _ if left_pre == right_pre => Ordering::Equal,
        (true, _) => Ordering::Greater,
        (_, true) => Ordering::Less,
        _ => left_pre.cmp(&right_pre),
    }
}

fn none(current: &str, error: Option<&'static str>) -> UpdateInfo {
    UpdateInfo { current: current.into(), latest: None, available: false, url: None, notes: String::new(), published_at: None, error }
}

pub fn check_for_update(current: &str) -> UpdateInfo {
    let headers = [("Accept", "application/vnd.github+json"), ("User-Agent", "Tessera-Updater")];
    match get_json(RELEASES_API, &headers, Duration::from_secs(10), true) {
        None => none(current, Some("offline")),
        Some((status, body)) => from_response(current, status, &body),
    }
}

pub fn from_response(current: &str, status: u16, data: &Value) -> UpdateInfo {
    match status {
        404 => return none(current, None),
        403 | 429 => return none(current, Some("rate-limit")),
        200..=299 => {}
        _ => return none(current, Some("failed")),
    }
    let Some(tag) = data.get("tag_name").and_then(Value::as_str).filter(|t| TAG.is_match(t)) else { return none(current, Some("failed")) };
    if data.get("draft") == Some(&Value::Bool(true)) || data.get("prerelease") == Some(&Value::Bool(true)) {
        return none(current, Some("failed"));
    }
    let latest = tag.strip_prefix('v').unwrap_or(tag).to_string();
    UpdateInfo {
        current: current.into(),
        available: compare_versions(current, &latest) == Ordering::Less,
        latest: Some(latest),
        url: data.get("html_url").and_then(Value::as_str).filter(|u| u.starts_with(RELEASE_PREFIX)).map(str::to_string),
        notes: data.get("body").and_then(Value::as_str).map(|b| b.encode_utf16().take(MAX_NOTES).collect::<Vec<u16>>()).map(|u| String::from_utf16_lossy(&u)).unwrap_or_default(),
        published_at: data.get("published_at").and_then(Value::as_str).map(str::to_string),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn compares_versions() {
        assert_eq!(compare_versions("0.1.0", "0.2.0"), Ordering::Less);
        assert_eq!(compare_versions("v1.0.0", "1.0.0"), Ordering::Equal);
        assert_eq!(compare_versions("1.0.0", "1.0.0-beta"), Ordering::Greater);
        assert_eq!(compare_versions("1.0.0-alpha", "1.0.0-beta"), Ordering::Less);
    }

    #[test]
    fn reads_releases() {
        let info = from_response("0.1.0", 200, &json!({ "tag_name": "v0.2.0", "html_url": "https://github.com/CompagesWorks/Tessera/releases/tag/v0.2.0", "body": "notes" }));
        assert!(info.available);
        assert_eq!(info.latest.as_deref(), Some("0.2.0"));
        assert!(info.url.is_some());
        let evil = from_response("0.1.0", 200, &json!({ "tag_name": "v0.2.0", "html_url": "https://evil.com/" }));
        assert_eq!(evil.url, None);
        assert_eq!(from_response("0.1.0", 404, &Value::Null).error, None);
        assert_eq!(from_response("0.1.0", 429, &Value::Null).error, Some("rate-limit"));
        assert_eq!(from_response("0.1.0", 200, &json!({ "tag_name": "nope" })).error, Some("failed"));
    }
}
