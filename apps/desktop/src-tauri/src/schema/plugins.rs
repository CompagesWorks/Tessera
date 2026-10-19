use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::check::{self, fail, matches};
use crate::util::{Error, Result};

pub const MAX_TEXT_READ: u64 = 1024 * 1024;
pub const MAX_TEXT_WRITE: usize = 5 * 1024 * 1024;
pub const MAX_BINARY_BYTES: u64 = 20 * 1024 * 1024;
pub const PLUGIN_SCHEME: &str = "tessera-plugin";
pub const PROVIDER_SCHEME: &str = "tessera-provider";
pub const COVER_SCHEME: &str = "tessera-cover";
pub const MEDIA_SCHEME: &str = "tessera-media";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Permission {
    #[serde(rename = "fs.project.read")]
    FsProjectRead,
    #[serde(rename = "fs.project.write")]
    FsProjectWrite,
    #[serde(rename = "fs.external")]
    FsExternal,
    #[serde(rename = "net")]
    Net,
    #[serde(rename = "secrets")]
    Secrets,
    #[serde(rename = "ui.theme")]
    UiTheme,
    #[serde(rename = "ui.provider")]
    UiProvider,
    #[serde(rename = "ui.menus")]
    UiMenus,
    #[serde(rename = "exec")]
    Exec,
    #[serde(rename = "exec.system")]
    ExecSystem,
    #[serde(rename = "discord.rpc")]
    DiscordRpc,
    #[serde(rename = "clipboard.write")]
    ClipboardWrite,
    #[serde(rename = "notify.system")]
    NotifySystem,
    #[serde(rename = "open.external")]
    OpenExternal,
    #[serde(rename = "projects.list")]
    ProjectsList,
}

impl Permission {
    pub const ALL: [Permission; 15] = [
        Permission::FsProjectRead,
        Permission::FsProjectWrite,
        Permission::FsExternal,
        Permission::Net,
        Permission::Secrets,
        Permission::UiTheme,
        Permission::UiProvider,
        Permission::UiMenus,
        Permission::Exec,
        Permission::ExecSystem,
        Permission::DiscordRpc,
        Permission::ClipboardWrite,
        Permission::NotifySystem,
        Permission::OpenExternal,
        Permission::ProjectsList,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            Permission::FsProjectRead => "fs.project.read",
            Permission::FsProjectWrite => "fs.project.write",
            Permission::FsExternal => "fs.external",
            Permission::Net => "net",
            Permission::Secrets => "secrets",
            Permission::UiTheme => "ui.theme",
            Permission::UiProvider => "ui.provider",
            Permission::UiMenus => "ui.menus",
            Permission::Exec => "exec",
            Permission::ExecSystem => "exec.system",
            Permission::DiscordRpc => "discord.rpc",
            Permission::ClipboardWrite => "clipboard.write",
            Permission::NotifySystem => "notify.system",
            Permission::OpenExternal => "open.external",
            Permission::ProjectsList => "projects.list",
        }
    }

    pub fn parse(text: &str) -> Option<Permission> {
        Permission::ALL.into_iter().find(|p| p.as_str() == text)
    }

    fn simple(&self) -> bool {
        !matches!(self, Permission::Net | Permission::Exec | Permission::ExecSystem | Permission::DiscordRpc)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WidgetCategory {
    Project,
    Files,
    Editing,
    Media,
    Publishing,
    Tools,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginWidget {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "puzzle")]
    pub icon: String,
    #[serde(default = "other_category")]
    pub category: WidgetCategory,
    pub entry: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TitlebarButton {
    pub id: String,
    pub title: String,
    #[serde(default = "puzzle")]
    pub icon: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileAction {
    pub id: String,
    pub title: String,
    #[serde(default = "puzzle")]
    pub icon: String,
    pub extensions: Vec<String>,
    #[serde(default)]
    pub default: bool,
}

fn puzzle() -> String {
    "puzzle".into()
}
fn other_category() -> WidgetCategory {
    WidgetCategory::Other
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemeBase {
    Dark,
    Light,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PluginTheme {
    pub id: String,
    pub name: String,
    pub base: ThemeBase,
    pub tokens: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UiProviderEntry {
    pub entry: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectOption {
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum PluginSetting {
    Boolean {
        id: String,
        title: String,
        #[serde(default)]
        description: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        group: Option<String>,
        default: bool,
    },
    String {
        id: String,
        title: String,
        #[serde(default)]
        description: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        group: Option<String>,
        default: String,
        #[serde(default = "default_max_length", rename = "maxLength")]
        max_length: i64,
        #[serde(default)]
        placeholder: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        browse: Vec<String>,
    },
    Number {
        id: String,
        title: String,
        #[serde(default)]
        description: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        group: Option<String>,
        default: f64,
        #[serde(default)]
        min: f64,
        #[serde(default = "default_max")]
        max: f64,
        #[serde(default = "default_step")]
        step: f64,
    },
    Select {
        id: String,
        title: String,
        #[serde(default)]
        description: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        group: Option<String>,
        default: String,
        options: Vec<SelectOption>,
    },
}

fn default_max_length() -> i64 {
    200
}
fn default_max() -> f64 {
    100.0
}
fn default_step() -> f64 {
    1.0
}

impl PluginSetting {
    pub fn id(&self) -> &str {
        match self {
            PluginSetting::Boolean { id, .. } | PluginSetting::String { id, .. } | PluginSetting::Number { id, .. } | PluginSetting::Select { id, .. } => id,
        }
    }

    pub fn default_value(&self) -> Value {
        match self {
            PluginSetting::Boolean { default, .. } => Value::Bool(*default),
            PluginSetting::String { default, .. } | PluginSetting::Select { default, .. } => Value::String(default.clone()),
            PluginSetting::Number { default, .. } => number(*default),
        }
    }

    pub fn coerce(&self, value: &Value) -> Option<Value> {
        match (self, value) {
            (PluginSetting::Boolean { .. }, Value::Bool(_)) => Some(value.clone()),
            (PluginSetting::String { max_length, .. }, Value::String(s)) if check::len(s) as i64 <= *max_length => Some(value.clone()),
            (PluginSetting::Number { min, max, .. }, Value::Number(n)) => {
                let v = n.as_f64()?;
                (v.is_finite() && v >= *min && v <= *max).then(|| value.clone())
            }
            (PluginSetting::Select { options, .. }, Value::String(s)) if options.iter().any(|o| &o.value == s) => Some(value.clone()),
            _ => None,
        }
    }

    fn validate(&mut self, path: &str) -> Result<()> {
        let (id, title, description, group) = match self {
            PluginSetting::Boolean { id, title, description, group, .. }
            | PluginSetting::String { id, title, description, group, .. }
            | PluginSetting::Number { id, title, description, group, .. }
            | PluginSetting::Select { id, title, description, group, .. } => (id, title, description, group),
        };
        matches(&format!("{path}.id"), &check::SETTING_KEY, id)?;
        check::trimmed(&format!("{path}.title"), title, 1, 60)?;
        check::trimmed(&format!("{path}.description"), description, 0, 200)?;
        if let Some(group) = group {
            check::trimmed(&format!("{path}.group"), group, 1, 40)?;
        }
        match self {
            PluginSetting::Boolean { .. } => {}
            PluginSetting::String { default, max_length, placeholder, browse, .. } => {
                check::text(&format!("{path}.default"), default, 0, 500)?;
                if browse.len() > 8 {
                    return fail(&format!("{path}.browse"), "too many extensions");
                }
                for extension in browse.iter() {
                    matches(&format!("{path}.browse"), &check::ICON, extension)?;
                }
                if !(1..=500).contains(max_length) {
                    return fail(&format!("{path}.maxLength"), "out of range");
                }
                check::text(&format!("{path}.placeholder"), placeholder, 0, 80)?;
            }
            PluginSetting::Number { default, min, max, step, .. } => {
                if !default.is_finite() || !min.is_finite() || !max.is_finite() || !step.is_finite() || *step <= 0.0 {
                    return fail(path, "invalid number");
                }
            }
            PluginSetting::Select { default, options, .. } => {
                check::text(&format!("{path}.default"), default, 0, 60)?;
                if !(1..=32).contains(&options.len()) {
                    return fail(&format!("{path}.options"), "invalid count");
                }
                for (index, option) in options.iter_mut().enumerate() {
                    check::text(&format!("{path}.options.{index}.value"), &option.value, 1, 60)?;
                    check::trimmed(&format!("{path}.options.{index}.label"), &mut option.label, 1, 60)?;
                }
            }
        }
        Ok(())
    }
}

pub fn number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9.0e15 {
        Value::from(value as i64)
    } else {
        serde_json::Number::from_f64(value).map(Value::Number).unwrap_or(Value::Null)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Engines {
    pub tessera: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
pub struct Contributes {
    #[serde(default)]
    pub widgets: Vec<PluginWidget>,
    #[serde(default)]
    pub themes: Vec<PluginTheme>,
    #[serde(default)]
    pub ui_provider: Option<UiProviderEntry>,
    #[serde(default)]
    pub settings: Vec<PluginSetting>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub titlebar: Vec<TitlebarButton>,
    #[serde(default)]
    pub file_actions: Vec<FileAction>,
}


#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecProgram {
    pub program: String,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: String,
    pub icon: String,
    pub engines: Engines,
    pub contributes: Contributes,
    pub permissions: Vec<Permission>,
    pub network: Vec<String>,
    pub exec: Option<ExecProgram>,
    pub system_programs: Vec<String>,
    pub discord_client_id: Option<String>,
}

#[derive(Deserialize)]
struct RawManifest {
    id: String,
    name: String,
    version: String,
    author: String,
    #[serde(default)]
    description: String,
    #[serde(default = "puzzle")]
    icon: String,
    engines: Engines,
    #[serde(default)]
    permissions: Vec<Value>,
    #[serde(default)]
    contributes: Contributes,
}

enum Entry {
    Simple(Permission),
    Net(Vec<String>),
    Exec(ExecProgram),
    System(Vec<String>),
    Discord(String),
}

impl Entry {
    fn id(&self) -> Permission {
        match self {
            Entry::Simple(p) => *p,
            Entry::Net(_) => Permission::Net,
            Entry::Exec(_) => Permission::Exec,
            Entry::System(_) => Permission::ExecSystem,
            Entry::Discord(_) => Permission::DiscordRpc,
        }
    }
}

fn keys_only(map: &Map<String, Value>, allowed: &[&str]) -> bool {
    map.keys().all(|k| allowed.contains(&k.as_str()))
}

fn string_list(value: Option<&Value>) -> Option<Vec<String>> {
    value?.as_array()?.iter().map(|v| v.as_str().map(str::to_string)).collect()
}

fn permission_entry(path: &str, value: &Value) -> Result<Entry> {
    let invalid = || fail::<Entry>(path, "invalid permission");
    if let Value::String(text) = value {
        return match Permission::parse(text) {
            Some(p) if p.simple() => Ok(Entry::Simple(p)),
            _ => invalid(),
        };
    }
    let Value::Object(map) = value else { return invalid() };
    let Some(id) = map.get("id").and_then(Value::as_str).and_then(Permission::parse) else { return invalid() };
    match id {
        p if p.simple() => {
            if keys_only(map, &["id"]) {
                Ok(Entry::Simple(p))
            } else {
                invalid()
            }
        }
        Permission::Net => {
            let domains = string_list(map.get("domains")).filter(|d| (1..=32).contains(&d.len()));
            match domains {
                Some(domains) if keys_only(map, &["id", "domains"]) && domains.iter().all(|d| d.len() <= 253 && check::DOMAIN.is_match(d)) => Ok(Entry::Net(domains)),
                _ => invalid(),
            }
        }
        Permission::Exec => {
            let program = map.get("program").and_then(Value::as_str);
            let sha = map.get("sha256").and_then(Value::as_str);
            match (program, sha) {
                (Some(program), Some(sha)) if keys_only(map, &["id", "program", "sha256"]) && check::relative_path("", program).is_ok() && check::SHA256.is_match(sha) => {
                    Ok(Entry::Exec(ExecProgram { program: program.into(), sha256: sha.into() }))
                }
                _ => invalid(),
            }
        }
        Permission::ExecSystem => {
            let programs = string_list(map.get("programs")).filter(|p| (1..=8).contains(&p.len()));
            match programs {
                Some(programs) if keys_only(map, &["id", "programs"]) && programs.iter().all(|p| check::PROGRAM_NAME.is_match(p)) => Ok(Entry::System(programs)),
                _ => invalid(),
            }
        }
        Permission::DiscordRpc => match map.get("clientId").and_then(Value::as_str) {
            Some(client) if keys_only(map, &["id", "clientId"]) && check::DISCORD_CLIENT.is_match(client) => Ok(Entry::Discord(client.into())),
            _ => invalid(),
        },
        _ => invalid(),
    }
}

fn unique(values: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        if !out.contains(&value) {
            out.push(value);
        }
    }
    out
}

pub fn parse_manifest(value: Value) -> Result<PluginManifest> {
    let raw: RawManifest = serde_json::from_value(value).map_err(|e| Error::new(format!("manifest: {e}")))?;
    let RawManifest { id, mut name, version, mut author, mut description, icon, engines, permissions, mut contributes } = raw;

    check::plugin_id("id", &id)?;
    check::trimmed("name", &mut name, 1, 60)?;
    matches("version", &check::VERSION, &version)?;
    check::trimmed("author", &mut author, 1, 60)?;
    check::trimmed("description", &mut description, 0, 300)?;
    check::icon("icon", &icon)?;
    check::text("engines.tessera", &engines.tessera, 1, 40)?;
    if permissions.len() > 16 {
        return fail("permissions", "too many permissions");
    }
    let entries = permissions.iter().enumerate().map(|(i, v)| permission_entry(&format!("permissions.{i}"), v)).collect::<Result<Vec<_>>>()?;

    if contributes.widgets.len() > 32 {
        return fail("contributes.widgets", "too many widgets");
    }
    for (index, widget) in contributes.widgets.iter_mut().enumerate() {
        let path = format!("contributes.widgets.{index}");
        matches(&format!("{path}.id"), &check::ICON, &widget.id)?;
        check::trimmed(&format!("{path}.title"), &mut widget.title, 1, 40)?;
        check::trimmed(&format!("{path}.description"), &mut widget.description, 0, 120)?;
        check::icon(&format!("{path}.icon"), &widget.icon)?;
        check::relative_path(&format!("{path}.entry"), &widget.entry)?;
    }
    if let Some(host) = &contributes.host {
        check::relative_path("contributes.host", host)?;
    }
    if contributes.titlebar.len() > 4 {
        return fail("contributes.titlebar", "too many buttons");
    }
    if !contributes.titlebar.is_empty() && contributes.host.is_none() {
        return fail("contributes.titlebar", "titlebar buttons need contributes.host");
    }
    for (index, button) in contributes.titlebar.iter_mut().enumerate() {
        let path = format!("contributes.titlebar.{index}");
        matches(&format!("{path}.id"), &check::ICON, &button.id)?;
        check::trimmed(&format!("{path}.title"), &mut button.title, 1, 24)?;
        check::icon(&format!("{path}.icon"), &button.icon)?;
    }
    if contributes.file_actions.len() > 8 {
        return fail("contributes.fileActions", "too many actions");
    }
    if !contributes.file_actions.is_empty() && contributes.host.is_none() {
        return fail("contributes.fileActions", "file actions need contributes.host");
    }
    for (index, action) in contributes.file_actions.iter_mut().enumerate() {
        let path = format!("contributes.fileActions.{index}");
        matches(&format!("{path}.id"), &check::ICON, &action.id)?;
        check::trimmed(&format!("{path}.title"), &mut action.title, 1, 40)?;
        check::icon(&format!("{path}.icon"), &action.icon)?;
        if action.extensions.is_empty() || action.extensions.len() > 24 {
            return fail(&format!("{path}.extensions"), "1 to 24 extensions");
        }
        for extension in action.extensions.iter_mut() {
            *extension = extension.to_ascii_lowercase();
            if extension != "*" && (extension.is_empty() || extension.len() > 12 || !extension.chars().all(|c| c.is_ascii_alphanumeric())) {
                return fail(&format!("{path}.extensions"), "extensions are letters and digits, without the dot, or *");
            }
        }
        if action.default && action.extensions.iter().any(|e| e == "*") {
            return fail(&format!("{path}.default"), "an action for every file can't be the default");
        }
    }
    if contributes.themes.len() > 16 {
        return fail("contributes.themes", "too many themes");
    }
    for (index, theme) in contributes.themes.iter_mut().enumerate() {
        let path = format!("contributes.themes.{index}");
        matches(&format!("{path}.id"), &check::ICON, &theme.id)?;
        check::trimmed(&format!("{path}.name"), &mut theme.name, 1, 40)?;
        for (token, value) in &theme.tokens {
            matches(&format!("{path}.tokens"), &check::TOKEN_NAME, token)?;
            let text = value.as_str().unwrap_or_default();
            if value.as_str().is_none() || check::len(text) == 0 || check::len(text) > 160 || !check::TOKEN_VALUE.is_match(text) || check::TOKEN_FORBIDDEN.is_match(text) {
                return fail(&format!("{path}.tokens.{token}"), "invalid token value");
            }
        }
        if theme.tokens.len() > 200 {
            return fail(&format!("{path}.tokens"), "too many tokens");
        }
    }
    if let Some(provider) = &contributes.ui_provider {
        check::relative_path("contributes.uiProvider.entry", &provider.entry)?;
    }
    if contributes.settings.len() > 40 {
        return fail("contributes.settings", "too many settings");
    }
    for (index, setting) in contributes.settings.iter_mut().enumerate() {
        setting.validate(&format!("contributes.settings.{index}"))?;
    }

    let ids: Vec<Permission> = entries.iter().map(Entry::id).collect();
    for (index, id) in ids.iter().enumerate() {
        if ids.iter().position(|p| p == id) != Some(index) {
            return fail(&format!("permissions.{index}"), &format!("duplicate permission {}", id.as_str()));
        }
    }
    let theme_ids: Vec<&String> = contributes.themes.iter().map(|t| &t.id).collect();
    for (index, id) in theme_ids.iter().enumerate() {
        if theme_ids.iter().position(|t| t == id) != Some(index) {
            return fail(&format!("contributes.themes.{index}"), &format!("duplicate theme {id}"));
        }
    }
    if !contributes.file_actions.is_empty() && !ids.contains(&Permission::UiMenus) {
        return fail("contributes.fileActions", "file actions need the ui.menus permission");
    }
    if !theme_ids.is_empty() && !ids.contains(&Permission::UiTheme) {
        return fail("contributes.themes", "themes need the ui.theme permission");
    }
    let setting_ids: Vec<&str> = contributes.settings.iter().map(PluginSetting::id).collect();
    for (index, setting) in contributes.settings.iter().enumerate() {
        if setting_ids.iter().position(|s| *s == setting.id()) != Some(index) {
            return fail(&format!("contributes.settings.{index}"), &format!("duplicate setting {}", setting.id()));
        }
        if setting.coerce(&setting.default_value()).is_none() {
            return fail(&format!("contributes.settings.{index}.default"), "default does not match the setting");
        }
        if let PluginSetting::Number { min, max, .. } = setting {
            if min > max {
                return fail(&format!("contributes.settings.{index}"), "min is above max");
            }
        }
    }
    if contributes.ui_provider.is_some() && !ids.contains(&Permission::UiProvider) {
        return fail("contributes.uiProvider", "uiProvider needs the ui.provider permission");
    }
    if ids.contains(&Permission::UiProvider) && contributes.ui_provider.is_none() {
        return fail("contributes.uiProvider", "ui.provider needs contributes.uiProvider");
    }

    let mut network = vec![];
    let mut exec = None;
    let mut system_programs = vec![];
    let mut discord_client_id = None;
    for entry in entries {
        match entry {
            Entry::Net(domains) => network = unique(domains),
            Entry::Exec(program) => exec = Some(program),
            Entry::System(programs) => system_programs = unique(programs),
            Entry::Discord(client) => discord_client_id = Some(client),
            Entry::Simple(_) => {}
        }
    }

    Ok(PluginManifest {
        id,
        name,
        version,
        author,
        description,
        icon,
        engines,
        contributes,
        permissions: ids,
        network,
        exec,
        system_programs,
        discord_client_id,
    })
}

pub fn permission_key(manifest: &PluginManifest, permission: Permission) -> String {
    match permission {
        Permission::Net => {
            let mut domains = manifest.network.clone();
            domains.sort();
            format!("net[{}]", domains.join(","))
        }
        Permission::Exec if manifest.exec.is_some() => {
            let exec = manifest.exec.as_ref().unwrap();
            format!("exec[{}@{}]", exec.program, exec.sha256)
        }
        Permission::ExecSystem => {
            let mut programs = manifest.system_programs.clone();
            programs.sort();
            format!("exec.system[{}]", programs.join(","))
        }
        Permission::DiscordRpc => format!("discord.rpc[{}]", manifest.discord_client_id.clone().unwrap_or_default()),
        other => other.as_str().to_string(),
    }
}

pub fn domain_allowed(domains: &[String], hostname: &str) -> bool {
    let lower = hostname.to_lowercase();
    let host = lower.strip_suffix('.').unwrap_or(&lower);
    domains.iter().any(|domain| match domain.strip_prefix('*') {
        Some(suffix) => host.ends_with(suffix),
        None => host == domain,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginMode {
    Installed,
    Dev,
    Builtin,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SystemProgram {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub granted: Vec<Permission>,
    pub pending: Vec<Permission>,
    pub mode: PluginMode,
    pub integrity: &'static str,
    pub integrity_error: Option<String>,
    pub path: String,
    pub source: String,
    pub external_folder: Option<String>,
    pub system_programs: BTreeMap<String, SystemProgram>,
    pub locales: Locales,
}

pub type Locales = BTreeMap<String, BTreeMap<String, String>>;

const MAX_LOCALE_BYTES: u64 = 64 * 1024;
const MAX_LOCALE_KEYS: usize = 1000;

pub fn read_locales(dir: &std::path::Path) -> Locales {
    let mut locales = Locales::new();
    for item in std::fs::read_dir(dir.join("locales")).into_iter().flatten().flatten() {
        let path = item.path();
        let Some(language) = path.file_stem().and_then(|s| s.to_str()).filter(|s| s.len() == 2 && s.bytes().all(|b| b.is_ascii_lowercase())) else { continue };
        if path.extension().and_then(|e| e.to_str()) != Some("json") || item.metadata().map(|m| m.len() > MAX_LOCALE_BYTES).unwrap_or(true) {
            continue;
        }
        let Ok(messages) = std::fs::read_to_string(&path).map_err(|_| ()).and_then(|text| serde_json::from_str::<BTreeMap<String, String>>(&text).map_err(|_| ())) else { continue };
        let valid = messages.len() <= MAX_LOCALE_KEYS
            && messages.iter().all(|(key, value)| (1..=80).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)) && value.len() <= 1000);
        if valid {
            locales.insert(language.to_string(), messages);
        }
    }
    locales
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    pub time: String,
    pub plugin_id: String,
    pub action: String,
    pub target: String,
    pub allowed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn base(permissions: Value) -> Value {
        json!({ "id": "test.plugin", "name": "Test", "version": "1.0.0", "author": "Me", "engines": { "tessera": "^0.1.0" }, "permissions": permissions,
            "contributes": { "widgets": [{ "id": "main", "title": "Main", "entry": "widget.html" }] } })
    }

    #[test]
    fn parses_and_transforms_permissions() {
        let manifest = parse_manifest(base(json!(["fs.project.read", { "id": "net", "domains": ["api.github.com", "api.github.com"] }]))).unwrap();
        assert_eq!(manifest.permissions, vec![Permission::FsProjectRead, Permission::Net]);
        assert_eq!(manifest.network, vec!["api.github.com".to_string()]);
        assert_eq!(manifest.contributes.widgets[0].category, WidgetCategory::Other);
    }

    #[test]
    fn rejects_bad_manifests() {
        assert!(parse_manifest(base(json!(["net"]))).is_err());
        assert!(parse_manifest(base(json!(["fs.project.read", "fs.project.read"]))).is_err());
        let mut reserved = base(json!([]));
        reserved["id"] = json!("tessera.core");
        assert!(parse_manifest(reserved).is_err());
        let mut themes = base(json!([]));
        themes["contributes"]["themes"] = json!([{ "id": "t", "name": "T", "base": "dark", "tokens": {} }]);
        assert!(parse_manifest(themes).unwrap_err().0.contains("ui.theme"));
    }

    #[test]
    fn domains() {
        let list = vec!["api.github.com".to_string(), "*.example.com".to_string()];
        assert!(domain_allowed(&list, "API.github.com."));
        assert!(domain_allowed(&list, "a.example.com"));
        assert!(!domain_allowed(&list, "example.com"));
        assert!(!domain_allowed(&list, "evilgithub.com"));
    }
}
