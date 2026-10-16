use std::collections::BTreeMap;
use std::io::Read;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use base64::Engine;
use regex::Regex;
use reqwest::blocking::Client;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use url::{Host, Url};

use crate::schema::check;
use crate::schema::plugins::domain_allowed;
use crate::util::{Error, Result};

const MAX_REDIRECTS: usize = 5;
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
const BLOCKED_HEADERS: [&str; 8] = ["cookie", "host", "origin", "referer", "connection", "content-length", "transfer-encoding", "proxy-authorization"];
static TEXT_TYPES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(text/|application/(json|xml|javascript|[a-z.+-]*\+(json|xml)))").unwrap());
static HEADER_NAME: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9-]{1,64}$").unwrap());

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FetchParams {
    pub url: String,
    #[serde(default = "get")]
    pub method: String,
    #[serde(default)]
    pub headers: Map<String, Value>,
    pub body: Option<String>,
    pub response_type: Option<String>,
}

fn get() -> String {
    "GET".into()
}

impl FetchParams {
    pub fn parse(value: Value) -> Result<FetchParams> {
        let params: FetchParams = serde_json::from_value(value)?;
        check::https_url("url", &params.url, 2000)?;
        if !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].contains(&params.method.as_str()) {
            return Err(Error::new("invalid method"));
        }
        for (name, value) in &params.headers {
            let ok = HEADER_NAME.is_match(name) && value.as_str().is_some_and(|v| check::len(v) <= 4000);
            if !ok {
                return Err(Error::new("invalid header"));
            }
        }
        if params.body.as_ref().is_some_and(|b| check::len(b) > MAX_BODY_BYTES) {
            return Err(Error::new("body too large"));
        }
        if params.response_type.as_ref().is_some_and(|t| t != "text" && t != "base64") {
            return Err(Error::new("invalid responseType"));
        }
        Ok(params)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetResponse {
    pub url: String,
    pub status: u16,
    pub status_text: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    pub encoding: String,
}

pub fn check_url(domains: &[String], raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| Error::new("invalid url"))?;
    if url.scheme() != "https" {
        return Err(Error::new("only https is allowed"));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(Error::new("credentials in URL are not allowed"));
    }
    let host = match url.host() {
        Some(Host::Domain(domain)) => domain.to_string(),
        Some(Host::Ipv4(_)) | Some(Host::Ipv6(_)) => return Err(Error::new("IP addresses are not allowed")),
        None => return Err(Error::new("invalid url")),
    };
    if !domain_allowed(domains, &host) {
        return Err(Error::new(format!("domain not declared: {host}")));
    }
    Ok(url)
}

fn client() -> Result<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .user_agent("Tessera")
        .build()
        .map_err(|e| Error::new(e.to_string()))
}

pub fn plugin_fetch(domains: &[String], params: &FetchParams) -> Result<NetResponse> {
    let client = client()?;
    let started = Instant::now();
    let mut url = check_url(domains, &params.url)?;
    let mut method = params.method.clone();
    let mut body = params.body.clone();
    let headers: Vec<(String, String)> = params
        .headers
        .iter()
        .filter(|(name, _)| !BLOCKED_HEADERS.contains(&name.to_lowercase().as_str()))
        .map(|(name, value)| (name.clone(), value.as_str().unwrap_or_default().to_string()))
        .collect();

    for hop in 0.. {
        let remaining = TIMEOUT.checked_sub(started.elapsed()).ok_or_else(|| Error::new("The operation was aborted due to timeout"))?;
        let mut request = client.request(Method::from_bytes(method.as_bytes()).map_err(|_| Error::new("invalid method"))?, url.clone()).timeout(remaining);
        for (name, value) in &headers {
            request = request.header(name, value);
        }
        if let Some(body) = &body {
            request = request.body(body.clone());
        }
        let response = request.send().map_err(|e| Error::new(format!("fetch failed: {e}")))?;
        let status = response.status();
        let location = response.headers().get("location").and_then(|v| v.to_str().ok()).map(str::to_string);
        if status.is_redirection() {
            if let Some(location) = location {
                if hop >= MAX_REDIRECTS {
                    return Err(Error::new("too many redirects"));
                }
                let next = url.join(&location).map_err(|_| Error::new("invalid redirect"))?;
                url = check_url(domains, next.as_str())?;
                if status.as_u16() == 303 || ((status.as_u16() == 301 || status.as_u16() == 302) && method == "POST") {
                    method = "GET".into();
                    body = None;
                }
                continue;
            }
        }
        let content_type = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or_default().to_string();
        let mut response_headers = BTreeMap::new();
        for (name, value) in response.headers() {
            if name.as_str() == "set-cookie" {
                continue;
            }
            let value = value.to_str().unwrap_or_default().to_string();
            response_headers.entry(name.as_str().to_string()).and_modify(|v: &mut String| v.push_str(&format!(", {value}"))).or_insert(value);
        }
        let status_text = status.canonical_reason().unwrap_or_default().to_string();
        let mut data = Vec::new();
        let read = response.take((MAX_RESPONSE_BYTES + 1) as u64).read_to_end(&mut data).map_err(|e| Error::new(e.to_string()))?;
        if read > MAX_RESPONSE_BYTES {
            return Err(Error::new("response too large"));
        }
        let encoding = params.response_type.clone().unwrap_or_else(|| if content_type.is_empty() || TEXT_TYPES.is_match(&content_type) { "text".into() } else { "base64".into() });
        let body = if encoding == "text" { String::from_utf8_lossy(&data).into_owned() } else { base64::engine::general_purpose::STANDARD.encode(&data) };
        return Ok(NetResponse { url: url.to_string(), status: status.as_u16(), status_text, headers: response_headers, body, encoding });
    }
    unreachable!()
}

pub fn get_json(url: &str, headers: &[(&str, &str)], timeout: Duration, follow: bool) -> Option<(u16, Value)> {
    let client = Client::builder()
        .redirect(if follow { reqwest::redirect::Policy::limited(10) } else { reqwest::redirect::Policy::none() })
        .timeout(timeout)
        .build()
        .ok()?;
    let mut request = client.get(url);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let response = request.send().ok()?;
    let status = response.status();
    if !follow && status.is_redirection() {
        return None;
    }
    let body = response.json::<Value>().unwrap_or(Value::Null);
    Some((status.as_u16(), body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_urls() {
        let domains = vec!["api.github.com".to_string()];
        assert!(check_url(&domains, "https://api.github.com/x").is_ok());
        assert_eq!(check_url(&domains, "http://api.github.com/").unwrap_err().0, "only https is allowed");
        assert_eq!(check_url(&domains, "https://u:p@api.github.com/").unwrap_err().0, "credentials in URL are not allowed");
        assert_eq!(check_url(&domains, "https://1.2.3.4/").unwrap_err().0, "IP addresses are not allowed");
        assert_eq!(check_url(&domains, "https://[::1]/").unwrap_err().0, "IP addresses are not allowed");
        assert_eq!(check_url(&domains, "https://example.com/").unwrap_err().0, "domain not declared: example.com");
    }
}
