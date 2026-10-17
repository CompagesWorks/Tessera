use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::Serialize;
use serde_json::Value;

use super::api::{client, SMASH_ULTIMATE};
use crate::util::{Error, Result};

const API: &str = "https://gamebanana.com/apiv11";
const COMMENTED_MODS: usize = 8;
const MAX_COMMENTS: usize = 30;
static TAG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<[^>]*>").unwrap());
static SPACE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GbOwnMod {
    pub id: u64,
    pub name: String,
    pub url: String,
    pub category: String,
    pub thumbnail: Option<String>,
    pub likes: u64,
    pub views: u64,
    pub comments: u64,
    pub added: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GbStamp {
    pub title: String,
    pub category: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GbStampOption {
    pub id: u64,
    pub title: String,
    pub category: String,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GbStampChoice {
    pub available: Vec<GbStampOption>,
    pub mine: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GbPost {
    pub id: u64,
    pub author: String,
    pub author_id: i64,
    pub avatar: Option<String>,
    pub submitter: bool,
    pub text: String,
    pub date: i64,
    pub replies: u64,
    pub stamps: Vec<GbStamp>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GbComment {
    #[serde(flatten)]
    pub post: GbPost,
    pub mod_id: u64,
    pub mod_name: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct GbMember {
    pub mods: Vec<GbOwnMod>,
    pub comments: Vec<GbComment>,
    pub session: bool,
}

fn text(value: &Value, pointer: &str) -> String {
    value.pointer(pointer).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn number(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn records(value: &Value) -> Result<&Vec<Value>> {
    if let Some(code) = value.get("_sErrorCode").and_then(Value::as_str) {
        return Err(Error::new(format!("gamebanana: {code}")));
    }
    value.get("_aRecords").and_then(Value::as_array).ok_or_else(|| Error::new("gamebanana: invalid answer"))
}

pub fn plain_text(html: &str) -> String {
    let stripped = TAG.replace_all(html, " ");
    let decoded = stripped.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&#039;", "'").replace("&#39;", "'").replace("&nbsp;", " ").replace("&amp;", "&");
    SPACE.replace_all(decoded.trim(), " ").chars().take(2000).collect()
}

pub fn parse_mods(value: &Value) -> Result<Vec<GbOwnMod>> {
    Ok(records(value)?
        .iter()
        .filter(|r| r.pointer("/_aGame/_idRow").and_then(Value::as_u64) == Some(SMASH_ULTIMATE))
        .filter_map(|r| {
            let id = r.get("_idRow")?.as_u64()?;
            let image = r.pointer("/_aPreviewMedia/_aImages/0").cloned().unwrap_or(Value::Null);
            let base = text(&image, "/_sBaseUrl");
            let file = text(&image, "/_sFile220");
            let thumbnail = (base.starts_with("https://images.gamebanana.com/") && !file.is_empty() && !file.contains('/')).then(|| format!("{base}/{file}"));
            Some(GbOwnMod {
                id,
                name: text(r, "/_sName"),
                url: format!("https://gamebanana.com/mods/{id}"),
                category: text(r, "/_aSubCategory/_sName"),
                thumbnail,
                likes: number(r, "_nLikeCount"),
                views: number(r, "_nViewCount"),
                comments: number(r, "_nPostCount"),
                added: r.get("_tsDateAdded").and_then(Value::as_i64).unwrap_or(0),
            })
        })
        .collect())
}

pub fn parse_posts(value: &Value) -> Result<Vec<GbPost>> {
    Ok(records(value)?
        .iter()
        .filter_map(|r| {
            let avatar = text(r, "/_aPoster/_sAvatarUrl");
            let stamps = r.get("_aStamps").map(parse_stamps).unwrap_or_default();
            Some(GbPost {
                id: r.get("_idRow")?.as_u64()?,
                author: text(r, "/_aPoster/_sName"),
                author_id: r.pointer("/_aPoster/_idRow")?.as_i64()?,
                avatar: avatar.starts_with("https://images.gamebanana.com/").then_some(avatar),
                submitter: r.get("_aLabels").and_then(Value::as_array).is_some_and(|l| l.iter().any(|l| l == "Submitter")),
                text: plain_text(r.get("_sText")?.as_str()?),
                date: r.get("_tsDateAdded").and_then(Value::as_i64).unwrap_or(0),
                replies: number(r, "_nReplyCount"),
                stamps,
            })
        })
        .collect())
}

pub fn parse_comments(value: &Value, owner: &GbOwnMod, member_id: i64) -> Result<Vec<GbComment>> {
    Ok(parse_posts(value)?
        .into_iter()
        .filter(|post| post.author_id != member_id)
        .map(|post| GbComment { post, mod_id: owner.id, mod_name: owner.name.clone(), url: format!("{}#PostsListModule", owner.url) })
        .collect())
}

fn parse_stamps(value: &Value) -> Vec<GbStamp> {
    value.as_array().map(|a| a.iter().map(|s| GbStamp { title: text(s, "/_sTitle"), category: text(s, "/_sCategory"), count: number(s, "_nCount") }).collect()).unwrap_or_default()
}

fn stamp_id(value: &Value) -> Option<u64> {
    let v = value.get("_idRow").unwrap_or(value);
    v.as_u64().or_else(|| v.as_str()?.parse().ok())
}

pub fn parse_stamp_options(value: &Value, ui_config: &Value) -> Vec<GbStampOption> {
    let unlocked: Vec<&str> = ui_config.get("_aEnabledUnlocks").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    value
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    let unlock = text(s, "/_sUnlockName");
                    Some(GbStampOption { id: stamp_id(s)?, title: text(s, "/_sTitle"), category: text(s, "/_sCategory"), locked: !unlock.is_empty() && !unlocked.contains(&unlock.as_str()) })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_stamp_ids(value: &Value) -> Vec<u64> {
    let list = value.get("_aStampIds").or_else(|| value.get("_aStamps")).unwrap_or(value);
    list.as_array().map(|a| a.iter().filter_map(stamp_id).collect()).unwrap_or_default()
}

pub fn reply_html(text: &str) -> String {
    let escaped = text.trim().replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;");
    format!("<p>{}</p>", escaped.replace("\r\n", "\n").replace('\n', "<br>"))
}

fn get(http: &reqwest::blocking::Client, session: Option<&str>, path: &str) -> Result<Value> {
    let mut request = http.get(format!("{API}/{path}"));
    if let Some(cookies) = session {
        request = request.header(reqwest::header::COOKIE, cookies);
    }
    request.send().and_then(|r| r.json()).map_err(|_| Error::new("gamebanana: unreachable"))
}

pub fn member(member_id: i64, session: Option<&str>) -> Result<GbMember> {
    let http = client(Duration::from_secs(20))?;
    let mods = parse_mods(&get(&http, session, &format!("Mod/Index?_nPerpage=50&_sSort=Generic_Newest&_aFilters%5BGeneric_Game%5D={SMASH_ULTIMATE}&_aFilters%5BGeneric_Submitter%5D={member_id}"))?)?;
    let commented: Vec<&GbOwnMod> = mods.iter().filter(|m| m.comments > 0).take(COMMENTED_MODS).collect();
    let mut comments: Vec<GbComment> = std::thread::scope(|scope| {
        let jobs: Vec<_> = commented.iter().map(|m| scope.spawn(|| get(&http, session, &format!("Mod/{}/Posts?_nPage=1&_nPerpage=10&_sSort=newest", m.id)).and_then(|v| parse_comments(&v, m, member_id)))).collect();
        jobs.into_iter().filter_map(|job| job.join().ok()?.ok()).flatten().collect()
    });
    comments.sort_by_key(|c| std::cmp::Reverse(c.post.date));
    comments.truncate(MAX_COMMENTS);
    Ok(GbMember { mods, comments, session: session.is_some() })
}

pub fn posts(of: &str, id: u64, session: Option<&str>) -> Result<Vec<GbPost>> {
    let http = client(Duration::from_secs(20))?;
    parse_posts(&get(&http, session, &format!("{of}/{id}/Posts?_nPage=1&_nPerpage=50&_sSort=newest"))?)
}

pub fn stamp_choice(post_id: u64, session: &str) -> Result<GbStampChoice> {
    let http = client(Duration::from_secs(20))?;
    let ui_config = get(&http, Some(session), "Member/UiConfig")?;
    let available = parse_stamp_options(&get(&http, None, "Util/Config/Stamps")?, &ui_config);
    let mine = parse_stamp_ids(&get(&http, Some(session), &format!("Post/{post_id}/AccessorStamps"))?);
    Ok(GbStampChoice { available, mine })
}

pub fn set_stamps(post_id: u64, ids: &[u64], session: &str) -> Result<Vec<GbStamp>> {
    let ids: Vec<String> = ids.iter().map(u64::to_string).collect();
    let response = client(Duration::from_secs(20))?
        .patch(format!("{API}/Post/{post_id}/Stamp"))
        .header(reqwest::header::COOKIE, session)
        .json(&serde_json::json!({ "_aStampIds": ids }))
        .send()
        .map_err(|_| Error::new("gamebanana: unreachable"))?;
    let status = response.status();
    let body: Value = response.json().unwrap_or(Value::Null);
    if let Some(reason) = crate::accounts::login_refusal(&body) {
        return Err(Error::new(format!("gamebanana-says: {reason}")));
    }
    if !status.is_success() {
        return Err(Error::new(format!("gamebanana-says: HTTP {}", status.as_u16())));
    }
    Ok(body.get("_aStamps").map(parse_stamps).unwrap_or_default())
}

pub fn reply(post_id: u64, text: &str, session: &str) -> Result<()> {
    let response = client(Duration::from_secs(20))?
        .post(format!("{API}/Post/{post_id}"))
        .header(reqwest::header::COOKIE, session)
        .json(&serde_json::json!({ "_sText": reply_html(text) }))
        .send()
        .map_err(|_| Error::new("gamebanana: unreachable"))?;
    let status = response.status();
    let body: Value = response.json().unwrap_or(Value::Null);
    if let Some(reason) = crate::accounts::login_refusal(&body) {
        return Err(Error::new(format!("gamebanana-says: {reason}")));
    }
    if !status.is_success() {
        return Err(Error::new(format!("gamebanana-says: HTTP {}", status.as_u16())));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_stamp_config() {
        let config = json!([
            { "_idRow": 0, "_sTitle": "Funny", "_sCategory": "positive" },
            { "_idRow": "8", "_sTitle": "Rude", "_sCategory": "negative" },
            { "_idRow": 9, "_sTitle": "Gold", "_sCategory": "positive", "_sUnlockName": "gold" }
        ]);
        let options = parse_stamp_options(&config, &json!({ "_aEnabledUnlocks": [] }));
        assert_eq!(options.iter().map(|s| (s.id, s.locked)).collect::<Vec<_>>(), vec![(0, false), (8, false), (9, true)]);
        assert!(!parse_stamp_options(&config, &json!({ "_aEnabledUnlocks": ["gold"] }))[2].locked);
        assert_eq!(parse_stamp_ids(&json!(["2", 7])), vec![2, 7]);
        assert_eq!(parse_stamp_ids(&json!({ "_aStampIds": ["3"] })), vec![3]);
        assert_eq!(parse_stamp_ids(&json!([{ "_idRow": 4 }])), vec![4]);
    }

    #[test]
    fn escapes_replies() {
        assert_eq!(reply_html(" <b>hi</b> & \"bye\"\r\nok "), "<p>&lt;b&gt;hi&lt;/b&gt; &amp; &quot;bye&quot;<br>ok</p>");
    }

    #[test]
    fn strips_comment_html() {
        assert_eq!(plain_text("<p>Nice&amp;clean</p><br><script>x</script>  &lt;3"), "Nice&clean x <3");
        assert_eq!(plain_text("&amp;lt;b&amp;gt;"), "&lt;b&gt;");
    }

    #[test]
    fn parses_mods_and_comments() {
        let index = json!({ "_aRecords": [
            { "_idRow": 7, "_sName": "Devil Jin", "_aGame": { "_idRow": 6498 }, "_aSubCategory": { "_sName": "Kazuya" }, "_nLikeCount": 8, "_nViewCount": 141, "_nPostCount": 2, "_tsDateAdded": 5,
              "_aPreviewMedia": { "_aImages": [{ "_sBaseUrl": "https://images.gamebanana.com/img/ss/mods", "_sFile220": "220-90_a.jpg" }] } },
            { "_idRow": 8, "_aGame": { "_idRow": 1 } },
            { "_idRow": 9, "_aGame": { "_idRow": 6498 }, "_aPreviewMedia": { "_aImages": [{ "_sBaseUrl": "https://evil.com", "_sFile220": "a.jpg" }] } }
        ] });
        let mods = parse_mods(&index).unwrap();
        assert_eq!(mods.iter().map(|m| m.id).collect::<Vec<_>>(), vec![7, 9]);
        assert_eq!(mods[0].thumbnail.as_deref(), Some("https://images.gamebanana.com/img/ss/mods/220-90_a.jpg"));
        assert_eq!(mods[1].thumbnail, None);
        let posts = json!({ "_aRecords": [
            { "_idRow": 1, "_sText": "<p>YES</p>", "_tsDateAdded": 10, "_nReplyCount": 2, "_aLabels": ["Submitter"],
              "_aStamps": [{ "_sTitle": "Interesting", "_sCategory": "positive", "_nCount": 3 }],
              "_aPoster": { "_idRow": 3, "_sName": "X9!", "_sAvatarUrl": "https://images.gamebanana.com/img/av/a.png" } },
            { "_idRow": 2, "_sText": "thanks", "_aPoster": { "_idRow": 42 } },
            { "_idRow": 3, "_sText": "[trashed]" }
        ] });
        let comments = parse_comments(&posts, &mods[0], 42).unwrap();
        assert_eq!(comments.len(), 1);
        let first = &comments[0];
        assert_eq!((first.post.text.as_str(), first.post.author.as_str(), first.mod_id), ("YES", "X9!", 7));
        assert_eq!((first.post.replies, first.post.submitter, first.post.avatar.as_deref()), (2, true, Some("https://images.gamebanana.com/img/av/a.png")));
        assert_eq!(first.post.stamps, vec![GbStamp { title: "Interesting".into(), category: "positive".into(), count: 3 }]);
        assert_eq!(parse_posts(&json!({ "_aRecords": [{ "_idRow": 1, "_sText": "x", "_aPoster": { "_idRow": 2, "_sAvatarUrl": "https://evil.com/a.png" } }] })).unwrap()[0].avatar, None);
        assert!(parse_mods(&json!({ "_sErrorCode": "NO_SUCH_ROUTE" })).is_err());
    }
}
