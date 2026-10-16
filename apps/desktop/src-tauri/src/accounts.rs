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

    pub fn disconnect(&self, service: AccountKind) -> Result<()> {
        if service == AccountKind::Github {
            self.secrets.delete(ACCOUNT_OWNER, "github")?;
        }
        Ok(())
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
}
