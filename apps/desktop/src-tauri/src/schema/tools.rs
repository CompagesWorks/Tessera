use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::check::{self, fail};
use super::layout::ProjectLayout;
use super::settings::{validate_shortcuts, AutoBackup, ExecPolicy, Language, Motion, ThemeMode, UpdateSettings, UI_SCALE_MAX, UI_SCALE_MIN};
use crate::util::Result;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: Option<String>,
    pub available: bool,
    pub url: Option<String>,
    pub notes: String,
    pub published_at: Option<String>,
    pub error: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuditList {
    pub entries: Vec<super::plugins::AuditEntry>,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    pub line: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub kind: &'static str,
    pub size: u64,
    pub name_hit: bool,
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub scanned: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HistoryKind {
    #[serde(rename = "note.write")]
    NoteWrite,
    #[serde(rename = "note.create")]
    NoteCreate,
    #[serde(rename = "note.delete")]
    NoteDelete,
    #[serde(rename = "file.write")]
    FileWrite,
    #[serde(rename = "file.remove")]
    FileRemove,
    #[serde(rename = "file.rename")]
    FileRename,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HistoryItem {
    pub kind: HistoryKind,
    pub target: String,
    pub source: Option<String>,
    pub time: String,
    pub files: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryState {
    pub undo: Vec<HistoryItem>,
    pub redo: Vec<HistoryItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileIndex {
    pub files: Vec<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileBackups {
    pub auto: AutoBackup,
    pub keep: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<Language>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<ThemeMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion: Option<Motion>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "super::projects::double_option")]
    pub plugin_theme: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "super::projects::double_option")]
    pub ui_provider: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "super::projects::double_option")]
    pub accent: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ui_scale: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_splash: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reopen_last_project: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exec_policy: Option<ExecPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcuts: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backups: Option<ProfileBackups>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updates: Option<UpdateSettings>,
}

impl ProfileSettings {
    pub fn keys(&self) -> Vec<&'static str> {
        let value = serde_json::to_value(self).unwrap_or(Value::Null);
        let names = [
            "language",
            "theme",
            "motion",
            "pluginTheme",
            "uiProvider",
            "accent",
            "uiScale",
            "showSplash",
            "reopenLastProject",
            "execPolicy",
            "shortcuts",
            "backups",
            "updates",
        ];
        names.into_iter().filter(|name| value.get(*name).is_some()).collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfilePlugin {
    pub id: String,
    pub version: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub format_version: u8,
    pub kind: String,
    pub created_at: String,
    pub app_version: String,
    pub settings: ProfileSettings,
    pub plugins: Vec<ProfilePlugin>,
    #[serde(default)]
    pub plugin_settings: Map<String, Value>,
    #[serde(default)]
    pub layout: Option<ProjectLayout>,
}

impl Profile {
    pub fn parse(value: Value) -> Result<Profile> {
        let mut profile: Profile = serde_json::from_value(value)?;
        if profile.format_version != 1 || profile.kind != "tessera-profile" {
            return fail("kind", "not a profile");
        }
        if !crate::util::time::is_iso(&profile.created_at) {
            return fail("createdAt", "invalid date");
        }
        check::text("appVersion", &profile.app_version, 0, 40)?;
        let s = &profile.settings;
        if let Some(Some(theme)) = &s.plugin_theme {
            check::text("settings.pluginTheme", theme, 0, 110)?;
        }
        if let Some(Some(id)) = &s.ui_provider {
            check::plugin_id("settings.uiProvider", id)?;
        }
        if let Some(Some(accent)) = &s.accent {
            check::matches("settings.accent", &check::ACCENT, accent)?;
        }
        if let Some(scale) = s.ui_scale {
            if !(UI_SCALE_MIN..=UI_SCALE_MAX).contains(&scale) {
                return fail("settings.uiScale", "out of range");
            }
        }
        if let Some(shortcuts) = &s.shortcuts {
            validate_shortcuts("settings.shortcuts", shortcuts)?;
        }
        if let Some(backups) = &s.backups {
            if !(0..=500).contains(&backups.keep) {
                return fail("settings.backups.keep", "out of range");
            }
        }
        if profile.plugins.len() > 200 {
            return fail("plugins", "too many plugins");
        }
        for plugin in &profile.plugins {
            check::plugin_id("plugins.id", &plugin.id)?;
            check::text("plugins.version", &plugin.version, 0, 40)?;
        }
        for (id, values) in &profile.plugin_settings {
            check::plugin_id("pluginSettings", id)?;
            let Value::Object(values) = values else { return fail("pluginSettings", "invalid") };
            for (key, value) in values {
                check::text("pluginSettings", key, 0, 40)?;
                let ok = match value {
                    Value::Bool(_) => true,
                    Value::String(text) => check::len(text) <= 500,
                    Value::Number(n) => n.as_f64().is_some_and(f64::is_finite),
                    _ => false,
                };
                if !ok {
                    return fail("pluginSettings", "invalid value");
                }
            }
        }
        if let Some(layout) = &mut profile.layout {
            layout.validate()?;
        }
        Ok(profile)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePluginPreview {
    pub id: String,
    pub name: Option<String>,
    pub version: String,
    pub installed_version: Option<String>,
    pub enabled: bool,
    pub state: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilePreview {
    pub token: String,
    pub created_at: String,
    pub app_version: String,
    pub setting_keys: Vec<&'static str>,
    pub shortcuts: usize,
    pub plugins: Vec<ProfilePluginPreview>,
    pub plugin_settings: usize,
    pub has_layout: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileApplied {
    pub settings: usize,
    pub plugins: usize,
    pub skipped: Vec<String>,
}
