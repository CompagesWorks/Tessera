use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

use super::check::{self, fail};
use super::layout::{ProjectLayout, MAX_LAYOUT_BYTES, MAX_NOTE_BYTES};
use super::plugins::{Permission, PluginMode};
use crate::util::{Error, Result};

pub fn parse<T: DeserializeOwned>(request: Option<Value>) -> Result<T> {
    serde_json::from_value(request.unwrap_or(Value::Null)).map_err(|e| Error::new(format!("invalid request ({e})")))
}

pub fn none(request: &Option<Value>) -> Result<()> {
    match request {
        None | Some(Value::Null) => Ok(()),
        _ => Err(Error::new("invalid request (expected nothing)")),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IdRef {
    pub id: String,
}

impl IdRef {
    pub fn uuid(request: Option<Value>) -> Result<String> {
        let r: IdRef = parse(request)?;
        check::uuid("id", &r.id)?;
        Ok(r.id)
    }

    pub fn plugin(request: Option<Value>) -> Result<String> {
        let r: IdRef = parse(request)?;
        check::plugin_id("id", &r.id)?;
        Ok(r.id)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenExternal {
    pub url: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Restart {
    pub safe_mode: bool,
    pub reason: Option<SafeReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SafeReason {
    Flag,
    Shift,
    Crash,
}

impl SafeReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            SafeReason::Flag => "flag",
            SafeReason::Shift => "shift",
            SafeReason::Crash => "crash",
        }
    }

    pub fn parse(text: &str) -> Option<SafeReason> {
        match text {
            "flag" => Some(SafeReason::Flag),
            "shift" => Some(SafeReason::Shift),
            "crash" => Some(SafeReason::Crash),
            _ => None,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SafeApply {
    pub disable: Vec<String>,
    pub reset_layouts: bool,
    pub reset_look: bool,
    pub clear_cache: bool,
}

impl SafeApply {
    pub fn validate(&self) -> Result<()> {
        if self.disable.len() > 200 || self.disable.iter().any(|d| check::len(d) > 64) {
            return fail("disable", "invalid list");
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BackupRef {
    pub id: String,
    pub backup: String,
}

impl BackupRef {
    pub fn validate(&self) -> Result<()> {
        check::uuid("id", &self.id)?;
        check::matches("backup", &check::BACKUP_ID, &self.backup)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ManualOrAuto {
    Manual,
    Auto,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateBackup {
    pub id: String,
    pub reason: ManualOrAuto,
    #[serde(default)]
    pub note: String,
}

impl CreateBackup {
    pub fn validate(&mut self) -> Result<()> {
        check::uuid("id", &self.id)?;
        check::trimmed("note", &mut self.note, 0, 120)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveLayout {
    pub id: String,
    pub layout: Value,
}

impl SaveLayout {
    pub fn into_parts(self) -> Result<(String, ProjectLayout)> {
        check::uuid("id", &self.id)?;
        let layout = ProjectLayout::parse(self.layout)?;
        if serde_json::to_string(&layout)?.len() > MAX_LAYOUT_BYTES {
            return fail("layout", "layout too large");
        }
        Ok((self.id, layout))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectPath {
    pub id: String,
    pub path: String,
}

impl ProjectPath {
    pub fn validate(&self, min: usize) -> Result<()> {
        check::uuid("id", &self.id)?;
        check::text("path", &self.path, min, 400)?;
        if crate::util::paths::has_parent_segment(&self.path) {
            return fail("path", "no parent segments");
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectRename {
    pub id: String,
    pub from: String,
    pub to: String,
}

impl ProjectRename {
    pub fn validate(&self) -> Result<()> {
        ProjectPath { id: self.id.clone(), path: self.from.clone() }.validate(1)?;
        ProjectPath { id: self.id.clone(), path: self.to.clone() }.validate(1)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectBytes {
    pub id: String,
    pub path: String,
    pub data: String,
}

impl ProjectBytes {
    pub fn validate(&self) -> Result<()> {
        ProjectPath { id: self.id.clone(), path: self.path.clone() }.validate(1)?;
        check::base64("data", &self.data, (super::plugins::MAX_BINARY_BYTES as usize).div_ceil(3) * 4)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NoteRef {
    pub id: String,
    pub name: String,
    pub content: Option<String>,
}

impl NoteRef {
    pub fn validate(&mut self, content: Content) -> Result<()> {
        check::uuid("id", &self.id)?;
        check::note_name("name", &mut self.name)?;
        match (content, &self.content) {
            (Content::Forbidden, Some(_)) => return fail("content", "unexpected"),
            (Content::Required, None) => return fail("content", "required"),
            (_, Some(text)) if check::len(text) > MAX_NOTE_BYTES => return fail("content", "too long"),
            _ => {}
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
pub enum Content {
    Forbidden,
    Optional,
    Required,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InspectLocal {
    pub path: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstallPackage {
    pub token: String,
    pub granted: Vec<Permission>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InstallLocal {
    pub path: String,
    pub granted: Vec<Permission>,
    pub mode: PluginMode,
}

impl InstallLocal {
    pub fn validate(&self) -> Result<()> {
        check::text("path", &self.path, 1, 500)?;
        if self.mode == PluginMode::Builtin {
            return fail("mode", "invalid mode");
        }
        if self.granted.len() > 16 {
            return fail("granted", "too many");
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetEnabled {
    pub id: String,
    pub enabled: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetGrants {
    pub id: String,
    pub granted: Vec<Permission>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetExternal {
    pub id: String,
    pub pick: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmAnswer {
    pub id: u64,
    pub decision: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PickProgram {
    pub id: String,
    pub name: String,
    pub pick: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetPluginSetting {
    pub id: String,
    pub key: String,
    pub value: Value,
}

impl SetPluginSetting {
    pub fn validate(&self) -> Result<()> {
        check::plugin_id("id", &self.id)?;
        check::matches("key", &check::SETTING_KEY, &self.key)?;
        let ok = match &self.value {
            Value::Bool(_) => true,
            Value::String(text) => check::len(text) <= 500,
            Value::Number(n) => n.as_f64().is_some_and(f64::is_finite),
            _ => false,
        };
        if !ok {
            return fail("value", "invalid value");
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResetPluginSetting {
    pub id: String,
    pub key: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PluginCall {
    pub plugin_id: String,
    pub project_id: Option<String>,
    pub method: String,
    #[serde(default)]
    pub params: Option<Value>,
}

impl PluginCall {
    pub fn validate(&self) -> Result<()> {
        check::plugin_id("pluginId", &self.plugin_id)?;
        if let Some(project) = &self.project_id {
            check::uuid("projectId", project)?;
        }
        check::text("method", &self.method, 1, 60)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PluginWatch {
    pub plugin_id: String,
    pub project_id: String,
    pub watching: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PickFolder {
    pub title: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PickFile {
    pub extensions: Vec<String>,
}

#[derive(Deserialize)]
#[serde(tag = "service", rename_all = "lowercase", deny_unknown_fields)]
pub enum ConnectAccount {
    Github { token: String },
    Gamebanana { member: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Github,
    Gamebanana,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisconnectAccount {
    pub service: AccountKind,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AuditQuery {
    pub plugin_id: Option<String>,
    pub allowed: Option<bool>,
    pub text: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    300
}

impl AuditQuery {
    pub fn parse(request: Option<Value>) -> Result<AuditQuery> {
        let query: AuditQuery = match request {
            None | Some(Value::Null) => AuditQuery { plugin_id: None, allowed: None, text: None, limit: 300 },
            some => parse(some)?,
        };
        if let Some(id) = &query.plugin_id {
            check::plugin_id("pluginId", id)?;
        }
        if let Some(text) = &query.text {
            check::text("text", text, 0, 100)?;
        }
        if !(1..=2000).contains(&query.limit) {
            return fail("limit", "out of range");
        }
        Ok(query)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuditFormat {
    Json,
    Csv,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuditExport {
    pub format: AuditFormat,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Search {
    pub id: String,
    pub query: String,
    #[serde(default = "yes")]
    pub content: bool,
    #[serde(default = "default_search_limit")]
    pub limit: i64,
}

fn yes() -> bool {
    true
}
fn default_search_limit() -> i64 {
    120
}

impl Search {
    pub fn validate(&mut self) -> Result<()> {
        check::uuid("id", &self.id)?;
        check::trimmed("query", &mut self.query, 1, 120)?;
        if !(1..=300).contains(&self.limit) {
            return fail("limit", "out of range");
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ExportProfile {
    pub layout_from: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplyProfile {
    pub token: String,
    pub settings: bool,
    pub plugins: bool,
    pub layout: bool,
}
