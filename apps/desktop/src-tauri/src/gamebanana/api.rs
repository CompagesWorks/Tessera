use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::Serialize;
use serde_json::Value;

use crate::util::{Error, Result};

pub const SMASH_ULTIMATE: u64 = 6498;
const REMIX_RULE: &str = "Modify this Mod and distribute the modified Mod on GameBanana";
static MOD_URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:https?://)?(?:www\.)?gamebanana\.com/mods/(\d{1,9})(?:[/?#].*)?$").unwrap());

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GbFile {
    pub id: u64,
    pub name: String,
    pub size: u64,
    pub md5: String,
    pub url: String,
    pub clean: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
pub struct GbLicense {
    pub yes: Vec<String>,
    pub ask: Vec<String>,
    pub no: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GbCredit {
    pub group: String,
    pub authors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GbMod {
    pub id: u64,
    pub name: String,
    pub url: String,
    pub author: String,
    pub category: String,
    pub images: Vec<String>,
    pub thumbnails: Vec<String>,
    pub files: Vec<GbFile>,
    pub license: GbLicense,
    pub remix: &'static str,
    pub credits: Vec<GbCredit>,
}

pub fn mod_id(input: &str) -> Option<u64> {
    let input = input.trim();
    if !input.is_empty() && input.len() <= 9 && input.bytes().all(|b| b.is_ascii_digit()) {
        return input.parse().ok();
    }
    MOD_URL.captures(input)?.get(1)?.as_str().parse().ok()
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().map(|items| items.iter().filter_map(|i| i.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

pub fn parse_profile(value: &Value) -> Result<GbMod> {
    if let Some(code) = value.get("_sErrorCode").and_then(Value::as_str) {
        return Err(Error::new(format!("gamebanana: {code}")));
    }
    let id = value.get("_idRow").and_then(Value::as_u64).ok_or_else(|| Error::new("gamebanana: invalid answer"))?;
    if value.pointer("/_aGame/_idRow").and_then(Value::as_u64) != Some(SMASH_ULTIMATE) {
        return Err(Error::new("gamebanana: not a Smash Ultimate mod"));
    }
    let images: Vec<&Value> = value.pointer("/_aPreviewMedia/_aImages").and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default();
    let image_url = |image: &Value, key: &str| {
        let base = text(image, "_sBaseUrl");
        let file = text(image, key);
        (base.starts_with("https://images.gamebanana.com/") && !file.is_empty() && !file.contains('/')).then(|| format!("{base}/{file}"))
    };
    let files = value
        .get("_aFiles")
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .filter_map(|file| {
                    Some(GbFile {
                        id: file.get("_idRow")?.as_u64()?,
                        name: text(file, "_sFile"),
                        size: file.get("_nFilesize")?.as_u64()?,
                        md5: text(file, "_sMd5Checksum").to_lowercase(),
                        url: text(file, "_sDownloadUrl"),
                        clean: text(file, "_sAvResult") == "clean",
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let checklist = value.get("_aLicenseChecklist").cloned().unwrap_or(Value::Null);
    let license = GbLicense { yes: strings(&checklist["yes"]), ask: strings(&checklist["ask"]), no: strings(&checklist["no"]) };
    let remix = if license.yes.iter().any(|r| r == REMIX_RULE) {
        "yes"
    } else if license.no.iter().any(|r| r == REMIX_RULE) {
        "no"
    } else if license.ask.iter().any(|r| r == REMIX_RULE) {
        "ask"
    } else {
        "unknown"
    };
    let credits = value
        .get("_aCredits")
        .and_then(Value::as_array)
        .map(|groups| {
            groups
                .iter()
                .map(|group| GbCredit {
                    group: text(group, "_sGroupName"),
                    authors: group.get("_aAuthors").and_then(Value::as_array).map(|a| a.iter().map(|author| text(author, "_sName")).collect()).unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(GbMod {
        id,
        name: text(value, "_sName"),
        url: format!("https://gamebanana.com/mods/{id}"),
        author: value.pointer("/_aSubmitter/_sName").and_then(Value::as_str).unwrap_or_default().to_string(),
        category: value.pointer("/_aCategory/_sName").and_then(Value::as_str).unwrap_or_default().to_string(),
        images: images.iter().filter_map(|i| image_url(i, "_sFile")).collect(),
        thumbnails: images.iter().filter_map(|i| image_url(i, "_sFile530")).collect(),
        files,
        license,
        remix,
        credits,
    })
}

pub fn client(timeout: Duration) -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .user_agent("Tessera")
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && super::download::allowed(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| Error::new(e.to_string()))
}

pub fn lookup(id: u64) -> Result<GbMod> {
    let response = client(Duration::from_secs(20))?
        .get(format!("https://gamebanana.com/apiv11/Mod/{id}/ProfilePage"))
        .send()
        .map_err(|_| Error::new("gamebanana: unreachable"))?;
    let value: Value = response.json().map_err(|_| Error::new("gamebanana: invalid answer"))?;
    parse_profile(&value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_mod_ids_from_links() {
        assert_eq!(mod_id("https://gamebanana.com/mods/728673"), Some(728673));
        assert_eq!(mod_id("gamebanana.com/mods/728673?foo"), Some(728673));
        assert_eq!(mod_id(" 728673 "), Some(728673));
        assert_eq!(mod_id("https://evil.com/mods/1"), None);
        assert_eq!(mod_id("https://gamebanana.com/mods/1x"), None);
    }

    #[test]
    fn parses_a_profile_page() {
        let page = json!({
            "_idRow": 728673, "_sName": "Devil Jin (BETA)",
            "_aGame": { "_idRow": 6498 }, "_aSubmitter": { "_sName": "VIP_User" }, "_aCategory": { "_sName": "Kazuya" },
            "_aPreviewMedia": { "_aImages": [
                { "_sBaseUrl": "https://images.gamebanana.com/img/ss/mods", "_sFile": "a.jpg", "_sFile530": "530-90_a.jpg" },
                { "_sBaseUrl": "https://evil.com/img", "_sFile": "b.jpg" }
            ] },
            "_aFiles": [{ "_idRow": 1851949, "_sFile": "devil.rar", "_nFilesize": 21576681, "_sMd5Checksum": "BAF17F", "_sDownloadUrl": "https://gamebanana.com/dl/1851949", "_sAvResult": "clean" }],
            "_aLicenseChecklist": { "yes": ["Download and install this Mod"], "ask": [REMIX_RULE], "no": [] },
            "_aCredits": [{ "_sGroupName": "Key Authors", "_aAuthors": [{ "_sName": "VIP_User" }] }]
        });
        let parsed = parse_profile(&page).unwrap();
        assert_eq!(parsed.images, vec!["https://images.gamebanana.com/img/ss/mods/a.jpg"]);
        assert_eq!(parsed.thumbnails, vec!["https://images.gamebanana.com/img/ss/mods/530-90_a.jpg"]);
        assert_eq!((parsed.files[0].md5.as_str(), parsed.files[0].clean, parsed.remix), ("baf17f", true, "ask"));
        assert_eq!(parsed.credits[0].authors, vec!["VIP_User"]);
        assert!(parse_profile(&json!({ "_idRow": 1, "_aGame": { "_idRow": 1 } })).is_err());
        assert!(parse_profile(&json!({ "_sErrorCode": "NO_SUCH_ROUTE" })).is_err());
    }
}
