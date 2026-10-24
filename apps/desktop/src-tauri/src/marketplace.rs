use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::plugins::package::{hash_file, MAX_PACKAGE_BYTES};
use crate::schema::check;
use crate::util::{json, Error, Result};

pub const OFFICIAL: &str = "https://github.com/CompagesWorks/Tessera-Marketplace";
pub const SOURCES_FILE: &str = "marketplaces.json";
const INDEX_FILE: &str = "marketplace.json";
const MAX_SOURCES: usize = 32;
const MAX_ENTRIES: usize = 500;
const MAX_INDEX_BYTES: u64 = 2 * 1024 * 1024;
static GITHUB: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:https://github\.com/)?([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?/?$").unwrap());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub url: String,
    pub official: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    pub download: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub url: String,
    pub official: bool,
    pub name: Option<String>,
    pub plugins: Vec<Entry>,
    pub error: Option<String>,
}

pub fn normalize(raw: &str) -> Result<String> {
    let raw = raw.trim();
    if let Some(c) = GITHUB.captures(raw) {
        return Ok(format!("https://github.com/{}/{}", &c[1], &c[2]));
    }
    let url = check::https_url("url", raw, 500)?;
    if !url.path().ends_with(".json") {
        return Err(Error::new("marketplace: give a GitHub repository or a link to a marketplace .json file"));
    }
    Ok(url.to_string())
}

fn index_url(source: &str) -> String {
    match GITHUB.captures(source) {
        Some(c) => format!("https://raw.githubusercontent.com/{}/{}/HEAD/{INDEX_FILE}", &c[1], &c[2]),
        None => source.to_string(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Link {
    pub url: String,
    pub plugin: Option<String>,
}

pub fn parse_link(link: &url::Url) -> Option<Link> {
    if link.scheme() != "tessera" || link.host_str() != Some("marketplace") {
        return None;
    }
    let query = |names: &[&str]| link.query_pairs().find(|(k, _)| names.contains(&k.as_ref())).map(|(_, v)| v.into_owned());
    let url = normalize(&query(&["url", "repo"])?).ok()?;
    match link.path().trim_end_matches('/') {
        "/add" => Some(Link { url, plugin: None }),
        "/install" => query(&["id", "plugin"]).filter(|id| check::plugin_id("id", id).is_ok()).map(|id| Link { url, plugin: Some(id) }),
        _ => None,
    }
}

pub fn lookup(source: &str, id: &str) -> Result<Entry> {
    let (_, entries) = fetch_one(&normalize(source)?)?;
    entries.into_iter().find(|e| e.id == id).ok_or_else(|| Error::new(format!("marketplace: {id} is not in this marketplace")))
}

pub fn sources(file: &Path) -> Vec<Source> {
    let custom: Vec<String> = json::read_value(file).and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
    std::iter::once(Source { url: OFFICIAL.into(), official: true })
        .chain(custom.into_iter().filter_map(|u| normalize(&u).ok()).filter(|u| u != OFFICIAL).map(|url| Source { url, official: false }))
        .collect()
}

fn save(file: &Path, list: &[Source]) -> Result<Vec<Source>> {
    let custom: Vec<&str> = list.iter().filter(|s| !s.official).map(|s| s.url.as_str()).collect();
    json::write(file, &custom)?;
    Ok(sources(file))
}

pub fn add_source(file: &Path, raw: &str) -> Result<Vec<Source>> {
    let url = normalize(raw)?;
    let mut list = sources(file);
    if list.iter().any(|s| s.url == url) {
        return Ok(list);
    }
    if list.len() > MAX_SOURCES {
        return Err(Error::new("marketplace: too many sources"));
    }
    list.push(Source { url, official: false });
    save(file, &list)
}

pub fn remove_source(file: &Path, url: &str) -> Result<Vec<Source>> {
    let list: Vec<Source> = sources(file).into_iter().filter(|s| s.official || s.url != url).collect();
    save(file, &list)
}

fn client(timeout: Duration) -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent("Tessera")
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && attempt.url().scheme() == "https" {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| Error::new(e.to_string()))
}

fn valid(entry: &Entry) -> bool {
    check::plugin_id("id", &entry.id).is_ok()
        && check::text("name", &entry.name, 1, 80).is_ok()
        && check::text("version", &entry.version, 1, 40).is_ok()
        && check::https_url("download", &entry.download, 2000).is_ok()
        && check::SHA256.is_match(&entry.sha256)
}

pub fn parse_index(data: &Value) -> Result<(Option<String>, Vec<Entry>)> {
    let plugins = data.get("plugins").and_then(Value::as_array).ok_or_else(|| Error::new("marketplace: no plugins list"))?;
    let name = data.get("name").and_then(Value::as_str).map(|n| n.chars().take(80).collect());
    let entries = plugins
        .iter()
        .take(MAX_ENTRIES)
        .filter_map(|p| serde_json::from_value::<Entry>(p.clone()).ok())
        .filter(valid)
        .map(|mut e| {
            e.description = e.description.chars().take(500).collect();
            e.author = e.author.chars().take(80).collect();
            e
        })
        .collect();
    Ok((name, entries))
}

fn fetch_one(source: &str) -> Result<(Option<String>, Vec<Entry>)> {
    let response = client(Duration::from_secs(15))?.get(index_url(source)).send().map_err(|_| Error::new("marketplace: unreachable"))?;
    match response.status().as_u16() {
        200..=299 => {}
        404 => return Err(Error::new(format!("marketplace: {INDEX_FILE} not found"))),
        code => return Err(Error::new(format!("marketplace: failed ({code})"))),
    }
    let mut bytes = vec![];
    response.take(MAX_INDEX_BYTES + 1).read_to_end(&mut bytes).map_err(|_| Error::new("marketplace: unreachable"))?;
    if bytes.len() as u64 > MAX_INDEX_BYTES {
        return Err(Error::new("marketplace: index too large"));
    }
    let data: Value = serde_json::from_slice(&bytes).map_err(|_| Error::new(format!("marketplace: invalid {INDEX_FILE}")))?;
    parse_index(&data)
}

pub fn fetch(file: &Path) -> Vec<Listing> {
    std::thread::scope(|scope| {
        let jobs: Vec<_> = sources(file).into_iter().map(|s| {
                let url = s.url.clone();
                (scope.spawn(move || fetch_one(&url)), s)
            }).collect();
        jobs.into_iter()
            .map(|(job, s)| match job.join().unwrap_or_else(|_| Err(Error::new("marketplace: failed"))) {
                Ok((name, plugins)) => Listing { url: s.url, official: s.official, name, plugins, error: None },
                Err(e) => Listing { url: s.url, official: s.official, name: None, plugins: vec![], error: Some(e.0) },
            })
            .collect()
    })
}

pub fn download(url: &str, sha256: &str, destination: &Path) -> Result<()> {
    let url = check::https_url("url", url, 2000)?;
    if !check::SHA256.is_match(sha256) {
        return Err(Error::new("marketplace: invalid checksum"));
    }
    let mut response = client(Duration::from_secs(10 * 60))?.get(url).send().map_err(|_| Error::new("marketplace: download failed"))?;
    if !response.status().is_success() {
        return Err(Error::new(format!("marketplace: download failed ({})", response.status().as_u16())));
    }
    let mut out = File::create(destination)?;
    let mut buffer = vec![0u8; 256 * 1024];
    let mut received = 0u64;
    loop {
        let n = response.read(&mut buffer).map_err(|_| Error::new("marketplace: download interrupted"))?;
        if n == 0 {
            break;
        }
        received += n as u64;
        if received > MAX_PACKAGE_BYTES {
            return Err(Error::new("marketplace: package too large"));
        }
        out.write_all(&buffer[..n])?;
    }
    out.flush()?;
    if hash_file(destination)? != sha256 {
        return Err(Error::new("marketplace: checksum mismatch, the download is corrupted or was changed"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn normalizes_sources() {
        assert_eq!(normalize("CompagesWorks/Tessera-Marketplace").unwrap(), OFFICIAL);
        assert_eq!(normalize("https://github.com/a/b.git").unwrap(), "https://github.com/a/b");
        assert_eq!(index_url("https://github.com/a/b"), "https://raw.githubusercontent.com/a/b/HEAD/marketplace.json");
        assert_eq!(normalize("https://example.com/m.json").unwrap(), "https://example.com/m.json");
        assert!(normalize("http://example.com/m.json").is_err());
        assert!(normalize("https://example.com/page").is_err());
    }

    #[test]
    fn reads_add_links() {
        let link = |s: &str| parse_link(&url::Url::parse(s).unwrap());
        let market = "https://github.com/me/market".to_string();
        assert_eq!(link("tessera://marketplace/add?repo=me/market"), Some(Link { url: market.clone(), plugin: None }));
        assert_eq!(link("tessera://marketplace/add/?url=https%3A%2F%2Fgithub.com%2Fme%2Fmarket"), Some(Link { url: market.clone(), plugin: None }));
        assert_eq!(link("tessera://marketplace/install?repo=me/market&id=me.tool"), Some(Link { url: market, plugin: Some("me.tool".into()) }));
        assert_eq!(link("tessera://marketplace/install?repo=me/market&id=../x"), None);
        assert_eq!(link("tessera://marketplace/install?repo=me/market"), None);
        assert_eq!(link("tessera://marketplace/remove?repo=me/market"), None);
        assert_eq!(link("tessera://marketplace/add?repo=http://evil.dev/x.json"), None);
    }

    #[test]
    fn keeps_official_and_custom_sources() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(SOURCES_FILE);
        assert_eq!(sources(&file).len(), 1);
        add_source(&file, "me/my-market").unwrap();
        add_source(&file, "me/my-market").unwrap();
        assert_eq!(sources(&file).len(), 2);
        remove_source(&file, OFFICIAL).unwrap();
        remove_source(&file, "https://github.com/me/my-market").unwrap();
        assert_eq!(sources(&file).iter().map(|s| s.official).collect::<Vec<_>>(), vec![true]);
    }

    #[test]
    fn skips_invalid_entries() {
        let hash = "a".repeat(64);
        let data = json!({ "name": "M", "plugins": [
            { "id": "com.me.good", "name": "Good", "version": "1.0.0", "download": "https://x.dev/p.tessera-plugin", "sha256": hash },
            { "id": "com.me.http", "name": "Http", "version": "1.0.0", "download": "http://x.dev/p.tessera-plugin", "sha256": hash },
            { "id": "com.me.nohash", "name": "NoHash", "version": "1.0.0", "download": "https://x.dev/p.tessera-plugin", "sha256": "x" }
        ]});
        let (name, entries) = parse_index(&data).unwrap();
        assert_eq!(name.as_deref(), Some("M"));
        assert_eq!(entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec!["com.me.good"]);
    }
}
