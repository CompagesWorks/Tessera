use std::sync::{Arc, LazyLock};
use std::time::Duration;

use regex::Regex;
use serde_json::Value;

use crate::plugins::net::get_json;
use crate::plugins::secrets::SecretStore;
use crate::schema::requests::AccountKind;
use crate::schema::settings::{GamebananaAccount, GithubAccount};
use crate::util::{Error, Result};

pub const ACCOUNT_OWNER: &str = "tessera-app";
const GITHUB_USER: &str = "https://api.github.com/user";
const GAMEBANANA_MEMBER: &str = "https://gamebanana.com/apiv11/Member";
static TOKEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_]+$").unwrap());
static MEMBER_ID: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d{1,9}$").unwrap());
static MEMBER_URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^https://gamebanana\.com/members/(\d{1,9})(?:[/?#].*)?$").unwrap());

fn account_error(code: &str) -> Error {
    Error::new(format!("account:{code}"))
}

pub fn cookie_header<'a>(set_cookies: impl Iterator<Item = &'a str>) -> String {
    set_cookies.filter_map(|c| c.split(';').next()).map(str::trim).filter(|pair| pair.contains('=') && !pair.ends_with('=')).collect::<Vec<_>>().join("; ")
}

fn id_of(value: &Value, key: &str) -> Option<i64> {
    let v = value.get(key)?;
    v.as_i64().or_else(|| v.as_str()?.parse().ok()).filter(|n| *n > 0)
}

pub fn session_member(login: &Value, session: &Value) -> Option<GamebananaAccount> {
    let member_id = id_of(login, "_idRow")?;
    let name = login.get("_sUsername").and_then(Value::as_str).filter(|n| !n.is_empty())?;
    let logged_in = session.get("_bIsLoggedIn").and_then(Value::as_bool) == Some(true) && id_of(session, "_idMemberRow") == Some(member_id);
    logged_in.then(|| GamebananaAccount { member_id, name: name.chars().take(80).collect() })
}

fn shape(value: &Value) -> String {
    match value {
        Value::Object(map) => format!("{{{}}}", map.iter().map(|(k, v)| match v { Value::Object(_) => format!("{k}{}", shape(v)), Value::Bool(b) => format!("{k}={b}"), _ => k.clone() }).collect::<Vec<_>>().join(",")),
        Value::Bool(b) => b.to_string(),
        _ => "-".into(),
    }
}

pub fn login_refusal(body: &Value) -> Option<String> {
    let fields = body.get("_aErrorData").and_then(Value::as_object);
    let mut reasons: Vec<String> = fields.map(|f| f.values().filter_map(|e| e.get("_sErrorMessage")?.as_str()).map(crate::gamebanana::member::plain_text).collect()).unwrap_or_default();
    if reasons.is_empty() {
        reasons.extend(body.get("_sErrorMessage").and_then(Value::as_str).map(crate::gamebanana::member::plain_text));
    }
    reasons.retain(|r| !r.is_empty());
    (!reasons.is_empty()).then(|| reasons.join(" "))
}

type Fetch = Arc<dyn Fn(&str, &[(&str, &str)]) -> Option<(u16, Value)> + Send + Sync>;

pub fn member_id_of(input: &str) -> Option<i64> {
    let text = input.trim();
    let digits = if MEMBER_ID.is_match(text) { Some(text.to_string()) } else { MEMBER_URL.captures(text).map(|c| c[1].to_string()) };
    digits.and_then(|d| d.parse::<i64>().ok()).filter(|n| *n > 0)
}

pub struct AccountService {
    secrets: Arc<SecretStore>,
    fetch: Fetch,
}

impl AccountService {
    pub fn new(secrets: Arc<SecretStore>) -> Self {
        let fetch: Fetch = Arc::new(|url, headers| {
            let mut all = vec![("Accept", "application/json"), ("User-Agent", "Tessera")];
            all.extend_from_slice(headers);
            get_json(url, &all, Duration::from_secs(10), false)
        });
        AccountService { secrets, fetch }
    }

    #[cfg(test)]
    pub fn with_fetch(secrets: Arc<SecretStore>, fetch: Fetch) -> Self {
        AccountService { secrets, fetch }
    }

    pub fn connect_github(&self, token: &str) -> Result<GithubAccount> {
        if !TOKEN.is_match(token) {
            return Err(account_error("invalid-token"));
        }
        let bearer = format!("Bearer {token}");
        let (status, body) = (self.fetch)(GITHUB_USER, &[("Authorization", &bearer), ("X-GitHub-Api-Version", "2022-11-28")]).ok_or_else(|| account_error("offline"))?;
        if status == 401 || status == 403 {
            return Err(account_error("rejected"));
        }
        let login = body.get("login").and_then(Value::as_str).filter(|l| !l.is_empty());
        let Some(login) = login.filter(|_| status == 200) else { return Err(account_error("failed")) };
        self.secrets.set(ACCOUNT_OWNER, "github", token).map_err(|_| account_error("no-encryption"))?;
        Ok(GithubAccount { login: login.chars().take(60).collect() })
    }

    pub fn connect_gamebanana(&self, input: &str) -> Result<GamebananaAccount> {
        let member_id = member_id_of(input).ok_or_else(|| account_error("invalid-member"))?;
        let (status, body) = (self.fetch)(&format!("{GAMEBANANA_MEMBER}/{member_id}/ProfilePage"), &[]).ok_or_else(|| account_error("offline"))?;
        let name = body.get("_sName").and_then(Value::as_str).filter(|n| !n.is_empty());
        let id_ok = body.get("_idRow").and_then(Value::as_i64) == Some(member_id);
        match name {
            Some(name) if status == 200 && id_ok => Ok(GamebananaAccount { member_id, name: name.chars().take(80).collect() }),
            _ => Err(account_error("not-found")),
        }
    }

    pub fn login_gamebanana(&self, username: &str, password: &str, code: Option<&str>) -> Result<GamebananaAccount> {
        let mut form = serde_json::json!({ "_sUsername": username, "_sPassword": password });
        if let Some(code) = code {
            form["_nTotp"] = Value::from(code);
        }
        let http = crate::gamebanana::api::client(Duration::from_secs(20)).map_err(|_| account_error("offline"))?;
        let response = http
            .post(format!("{GAMEBANANA_MEMBER}/Authenticate"))
            .json(&form)
            .send()
            .map_err(|_| account_error("offline"))?;
        let status = response.status().as_u16();
        let cookies = cookie_header(response.headers().get_all(reqwest::header::SET_COOKIE).iter().filter_map(|v| v.to_str().ok()));
        let body: Value = response.json().unwrap_or(Value::Null);
        match body.pointer("/_aErrorData/_sVerificationMethod").and_then(Value::as_str) {
            Some("2fa") => return Err(account_error(if code.is_some() { "bad-2fa" } else { "needs-2fa" })),
            Some(_) => return Err(account_error("captcha")),
            None => {}
        }
        if let Some(reason) = login_refusal(&body) {
            return Err(Error::new(format!("gamebanana-says: {reason}")));
        }
        if status == 401 || status == 403 {
            return Err(account_error("bad-login"));
        }
        if status != 200 || cookies.is_empty() || body.get("_sErrorCode").is_some() {
            let fields = body.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>().join(", ")).unwrap_or_default();
            return Err(Error::new(format!("gamebanana-says: unexpected answer (HTTP {status}, cookies: {}, fields: {fields})", !cookies.is_empty())));
        }
        let session: Value = http
            .get(format!("{GAMEBANANA_MEMBER}/Session"))
            .header(reqwest::header::COOKIE, &cookies)
            .send()
            .and_then(|r| r.json())
            .map_err(|_| account_error("offline"))?;
        let Some(account) = session_member(&body, &session) else {
            let names: Vec<&str> = cookies.split("; ").filter_map(|c| c.split('=').next()).collect();
            return Err(Error::new(format!("gamebanana-says: unexpected session (cookies: {}, login: {}, session: {})", names.join(","), shape(&body), shape(&session))));
        };
        self.secrets.set(ACCOUNT_OWNER, "gamebanana", &cookies).map_err(|_| account_error("no-encryption"))?;
        Ok(account)
    }

    pub fn disconnect(&self, service: AccountKind) -> Result<()> {
        let key = match service {
            AccountKind::Github => "github",
            AccountKind::Gamebanana => "gamebanana",
        };
        self.secrets.delete(ACCOUNT_OWNER, key)
    }

    pub fn gamebanana_session(&self) -> Result<Option<String>> {
        self.secrets.get(ACCOUNT_OWNER, "gamebanana")
    }

    pub fn github_token(&self) -> Result<Option<String>> {
        self.secrets.get(ACCOUNT_OWNER, "github")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugins::secrets::AesCipher;
    use serde_json::json;

    fn service(dir: &std::path::Path, status: u16, body: Value) -> AccountService {
        let secrets = Arc::new(SecretStore::new(dir.to_path_buf(), Arc::new(AesCipher::new(Some([1u8; 32])))));
        AccountService::with_fetch(secrets, Arc::new(move |_, _| Some((status, body.clone()))))
    }

    #[test]
    fn reads_member_ids() {
        assert_eq!(member_id_of("1234"), Some(1234));
        assert_eq!(member_id_of(" https://gamebanana.com/members/42/posts "), Some(42));
        assert_eq!(member_id_of("https://evil.com/members/42"), None);
        assert_eq!(member_id_of("0"), None);
    }

    #[test]
    fn connects_github_and_stores_token() {
        let dir = tempfile::tempdir().unwrap();
        let accounts = service(dir.path(), 200, json!({ "login": "octo" }));
        assert_eq!(accounts.connect_github("ghp_abcdefghijklmnopqrstuv").unwrap().login, "octo");
        assert_eq!(accounts.github_token().unwrap().as_deref(), Some("ghp_abcdefghijklmnopqrstuv"));
        assert_eq!(accounts.connect_github("bad token!").unwrap_err().0, "account:invalid-token");
        let rejected = service(dir.path(), 401, json!({}));
        assert_eq!(rejected.connect_github("ghp_abcdefghijklmnopqrstuv").unwrap_err().0, "account:rejected");
    }

    #[test]
    fn connects_gamebanana() {
        let dir = tempfile::tempdir().unwrap();
        let accounts = service(dir.path(), 200, json!({ "_idRow": 42, "_sName": "Mario" }));
        assert_eq!(accounts.connect_gamebanana("42").unwrap().name, "Mario");
        assert_eq!(accounts.connect_gamebanana("43").unwrap_err().0, "account:not-found");
    }

    #[test]
    fn reads_gamebanana_sessions() {
        let cookies = ["sess=abc; path=/; HttpOnly", "rd=1; Secure", "empty=; Max-Age=0", "junk"];
        assert_eq!(cookie_header(cookies.into_iter()), "sess=abc; rd=1");
        let login = json!({ "_sStatus": "SUCCESS", "_idRow": 42, "_sUsername": "Mario" });
        let member = session_member(&login, &json!({ "_bIsLoggedIn": true, "_idMemberRow": 42 })).unwrap();
        assert_eq!((member.member_id, member.name.as_str()), (42, "Mario"));
        assert!(session_member(&login, &json!({ "_bIsLoggedIn": true, "_idMemberRow": 7 })).is_none());
        assert!(session_member(&login, &json!({ "_bIsLoggedIn": false })).is_none());
        assert!(session_member(&json!({ "_idRow": "42", "_sUsername": "Mario" }), &json!({ "_bIsLoggedIn": true, "_idMemberRow": "42" })).is_some());
        let refused = json!({ "_sErrorCode": "INPUT_ERRORS", "_aErrorData": { "_sUsername": { "_sErrorCode": "NO_SUCH_RECORD", "_sErrorMessage": "This account <b>doesn't</b> exist" } } });
        assert_eq!(login_refusal(&refused).as_deref(), Some("This account doesn't exist"));
        assert_eq!(login_refusal(&json!({ "_sErrorCode": "X", "_sErrorMessage": "Slow down" })).as_deref(), Some("Slow down"));
        assert_eq!(login_refusal(&json!({ "_bSuccess": true })), None);
        assert_eq!(shape(&json!({ "_bIsLoggedIn": true, "_aMember": { "_idRow": 1, "_sName": "secret" } })), "{_bIsLoggedIn=true,_aMember{_idRow,_sName}}");
    }
}
