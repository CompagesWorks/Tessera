use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::check::{self, fail, matches};
use super::layout::ProjectLayout;
use crate::util::Result;

pub const UI_SCALE_MIN: i64 = 80;
pub const UI_SCALE_MAX: i64 = 130;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Fr,
    En,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeMode {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Motion {
    Full,
    Reduced,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExecPolicy {
    Ask,
    Session,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AutoBackup {
    #[serde(rename = "off")]
    Off,
    #[serde(rename = "15")]
    Quarter,
    #[serde(rename = "60")]
    Hour,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackupSettings {
    pub auto: AutoBackup,
    pub keep: i64,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSettings {
    pub ryujinx: Option<String>,
    pub launch_after_deploy: bool,
    pub sd_mods: Option<String>,
    pub arc_version: String,
    pub mosaic_mods: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdateSettings {
    pub auto: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GithubAccount {
    pub login: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GamebananaAccount {
    pub member_id: i64,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Accounts {
    pub github: Option<GithubAccount>,
    pub gamebanana: Option<GamebananaAccount>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub format_version: u8,
    pub language: Language,
    pub theme: ThemeMode,
    pub motion: Motion,
    #[serde(default)]
    pub plugin_theme: Option<String>,
    #[serde(default)]
    pub ui_provider: Option<String>,
    #[serde(default)]
    pub accent: Option<String>,
    #[serde(default = "default_ui_scale")]
    pub ui_scale: i64,
    #[serde(default = "yes")]
    pub show_splash: bool,
    #[serde(default = "yes")]
    pub splash_delay: bool,
    #[serde(default)]
    pub reopen_last_project: bool,
    #[serde(default)]
    pub projects_folder: Option<String>,
    #[serde(default = "default_exec_policy")]
    pub exec_policy: ExecPolicy,
    #[serde(default)]
    pub shortcuts: Map<String, Value>,
    #[serde(default = "default_backups")]
    pub backups: BackupSettings,
    #[serde(default = "default_game")]
    pub game: GameSettings,
    #[serde(default)]
    pub developer_mode: bool,
    #[serde(default = "default_updates")]
    pub updates: UpdateSettings,
    #[serde(default)]
    pub layout_template: Option<ProjectLayout>,
    #[serde(default = "default_accounts")]
    pub accounts: Accounts,
}

fn default_ui_scale() -> i64 {
    100
}
fn yes() -> bool {
    true
}
fn default_exec_policy() -> ExecPolicy {
    ExecPolicy::Session
}
pub fn default_backups() -> BackupSettings {
    BackupSettings { auto: AutoBackup::Off, keep: 20, folder: None }
}
fn default_game() -> GameSettings {
    GameSettings { ryujinx: None, launch_after_deploy: false, sd_mods: None, arc_version: "latest".into(), mosaic_mods: None }
}
fn default_updates() -> UpdateSettings {
    UpdateSettings { auto: true }
}
fn default_accounts() -> Accounts {
    Accounts { github: None, gamebanana: None }
}

pub const PATCH_FIELDS: &[&str] = &[
    "language",
    "theme",
    "motion",
    "pluginTheme",
    "uiProvider",
    "accent",
    "uiScale",
    "showSplash",
    "splashDelay",
    "reopenLastProject",
    "projectsFolder",
    "execPolicy",
    "shortcuts",
    "backups",
    "game",
    "developerMode",
    "updates",
    "layoutTemplate",
];

impl Default for Settings {
    fn default() -> Self {
        Settings {
            format_version: 1,
            language: Language::Fr,
            theme: ThemeMode::Dark,
            motion: Motion::Full,
            plugin_theme: None,
            ui_provider: None,
            accent: None,
            ui_scale: 100,
            show_splash: true,
            splash_delay: true,
            reopen_last_project: false,
            projects_folder: None,
            exec_policy: ExecPolicy::Session,
            shortcuts: Map::new(),
            backups: default_backups(),
            game: default_game(),
            developer_mode: false,
            updates: default_updates(),
            layout_template: None,
            accounts: default_accounts(),
        }
    }
}

fn path_field(name: &str, value: &Option<String>) -> Result<()> {
    if let Some(value) = value {
        check::text(name, value, 1, 500)?;
    }
    Ok(())
}

pub fn validate_shortcuts(path: &str, shortcuts: &Map<String, Value>) -> Result<()> {
    if shortcuts.len() > 200 {
        return fail(path, "too many shortcuts");
    }
    for (id, value) in shortcuts {
        matches(path, &check::COMMAND_ID, id)?;
        match value {
            Value::Null => {}
            Value::String(s) if check::len(s) <= 40 && check::SHORTCUT.is_match(s) => {}
            _ => return fail(&format!("{path}.{id}"), "invalid shortcut"),
        }
    }
    Ok(())
}

pub fn validate_backups(backups: &BackupSettings) -> Result<()> {
    if !(0..=500).contains(&backups.keep) {
        return fail("backups.keep", "out of range");
    }
    path_field("backups.folder", &backups.folder)
}

impl Settings {
    pub fn parse(value: Value) -> Result<Self> {
        let mut settings: Settings = serde_json::from_value(value)?;
        settings.validate()?;
        Ok(settings)
    }

    pub fn validate(&mut self) -> Result<()> {
        if self.format_version != 1 {
            return fail("formatVersion", "invalid version");
        }
        if let Some(theme) = &self.plugin_theme {
            check::text("pluginTheme", theme, 0, 110)?;
        }
        if let Some(id) = &self.ui_provider {
            check::plugin_id("uiProvider", id)?;
        }
        if let Some(accent) = &self.accent {
            matches("accent", &check::ACCENT, accent)?;
        }
        if !(UI_SCALE_MIN..=UI_SCALE_MAX).contains(&self.ui_scale) {
            return fail("uiScale", "out of range");
        }
        path_field("projectsFolder", &self.projects_folder)?;
        validate_shortcuts("shortcuts", &self.shortcuts)?;
        validate_backups(&self.backups)?;
        path_field("game.ryujinx", &self.game.ryujinx)?;
        path_field("game.sdMods", &self.game.sd_mods)?;
        path_field("game.mosaicMods", &self.game.mosaic_mods)?;
        matches("game.arcVersion", &check::ARC_VERSION, &self.game.arc_version)?;
        if let Some(layout) = &mut self.layout_template {
            layout.validate()?;
        }
        if let Some(github) = &self.accounts.github {
            check::text("accounts.github.login", &github.login, 1, 60)?;
        }
        if let Some(gb) = &self.accounts.gamebanana {
            if gb.member_id <= 0 {
                return fail("accounts.gamebanana.memberId", "invalid");
            }
            check::text("accounts.gamebanana.name", &gb.name, 1, 80)?;
        }
        Ok(())
    }

    pub fn apply_patch(&self, patch: &Map<String, Value>) -> Result<Settings> {
        let mut value = serde_json::to_value(self)?;
        let object = value.as_object_mut().expect("settings object");
        for (key, item) in patch {
            object.insert(key.clone(), item.clone());
        }
        Settings::parse(value)
    }
}

pub fn validate_patch(value: Value) -> Result<Map<String, Value>> {
    let Value::Object(map) = value else {
        return fail("", "expected an object");
    };
    for key in map.keys() {
        if !PATCH_FIELDS.contains(&key.as_str()) {
            return fail(key, "unknown field");
        }
    }
    let probe = Settings::default().apply_patch(&map)?;
    let _ = probe;
    Ok(map)
}
