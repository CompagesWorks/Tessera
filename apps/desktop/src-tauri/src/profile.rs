use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::schema::layout::ProjectLayout;
use crate::schema::plugins::{InstalledPlugin, PluginMode};
use crate::schema::settings::Settings;
use crate::schema::tools::{Profile, ProfileBackups, ProfilePlugin, ProfilePluginPreview, ProfilePreview, ProfileSettings};
use crate::util::time::now_iso;

pub const PROFILE_EXTENSION: &str = "tessera-profile";
pub const MAX_PROFILE_BYTES: u64 = 2 * 1024 * 1024;

pub fn strip_layout_state(layout: &ProjectLayout) -> ProjectLayout {
    let mut out = layout.clone();
    for widget in out.widgets.values_mut() {
        if let Some(object) = widget.as_object_mut() {
            object.insert("state".into(), Value::Object(Map::new()));
        }
    }
    out
}

pub fn build_profile(settings: &Settings, plugins: &[InstalledPlugin], plugin_settings: Map<String, Value>, layout: Option<ProjectLayout>, app_version: &str) -> Profile {
    Profile {
        format_version: 1,
        kind: "tessera-profile".into(),
        created_at: now_iso(),
        app_version: app_version.into(),
        settings: ProfileSettings {
            language: Some(settings.language),
            theme: Some(settings.theme),
            motion: Some(settings.motion),
            plugin_theme: Some(settings.plugin_theme.clone()),
            ui_provider: Some(settings.ui_provider.clone()),
            accent: Some(settings.accent.clone()),
            ui_scale: Some(settings.ui_scale),
            show_splash: Some(settings.show_splash),
            reopen_last_project: Some(settings.reopen_last_project),
            exec_policy: Some(settings.exec_policy),
            shortcuts: Some(settings.shortcuts.clone()),
            backups: Some(ProfileBackups { auto: settings.backups.auto, keep: settings.backups.keep }),
            updates: Some(settings.updates.clone()),
        },
        plugins: plugins
            .iter()
            .filter(|p| p.mode == PluginMode::Installed)
            .map(|p| ProfilePlugin { id: p.manifest.id.clone(), version: p.manifest.version.clone(), enabled: p.enabled })
            .collect(),
        plugin_settings,
        layout,
    }
}

pub fn preview_profile(profile: &Profile, installed: &[InstalledPlugin], token: String) -> ProfilePreview {
    let by_id: HashMap<&str, &InstalledPlugin> = installed.iter().map(|p| (p.manifest.id.as_str(), p)).collect();
    ProfilePreview {
        token,
        created_at: profile.created_at.clone(),
        app_version: profile.app_version.clone(),
        setting_keys: profile.settings.keys().into_iter().filter(|k| *k != "shortcuts").collect(),
        shortcuts: profile.settings.shortcuts.as_ref().map(Map::len).unwrap_or(0),
        plugins: profile
            .plugins
            .iter()
            .map(|entry| {
                let plugin = by_id.get(entry.id.as_str());
                ProfilePluginPreview {
                    id: entry.id.clone(),
                    name: plugin.map(|p| p.manifest.name.clone()),
                    version: entry.version.clone(),
                    installed_version: plugin.map(|p| p.manifest.version.clone()),
                    enabled: entry.enabled,
                    state: match plugin {
                        None => "missing",
                        Some(p) if p.manifest.version == entry.version => "same",
                        Some(_) => "version",
                    },
                }
            })
            .collect(),
        plugin_settings: profile.plugin_settings.values().map(|v| v.as_object().map(Map::len).unwrap_or(0)).sum(),
        has_layout: profile.layout.is_some(),
    }
}

pub fn profile_settings_patch(profile: &Profile, current: &Settings, installed: &[InstalledPlugin]) -> (Map<String, Value>, Vec<String>) {
    let s = &profile.settings;
    let mut patch = Map::new();
    let mut skipped = vec![];
    let mut put = |key: &str, value: Value| {
        patch.insert(key.into(), value);
    };
    if let Some(v) = &s.language {
        put("language", val(v));
    }
    if let Some(v) = &s.theme {
        put("theme", val(v));
    }
    if let Some(v) = &s.motion {
        put("motion", val(v));
    }
    if let Some(v) = &s.accent {
        put("accent", val(v));
    }
    if let Some(v) = &s.ui_scale {
        put("uiScale", val(v));
    }
    if let Some(v) = &s.show_splash {
        put("showSplash", val(v));
    }
    if let Some(v) = &s.reopen_last_project {
        put("reopenLastProject", val(v));
    }
    if let Some(v) = &s.exec_policy {
        put("execPolicy", val(v));
    }
    if let Some(v) = &s.shortcuts {
        put("shortcuts", Value::Object(v.clone()));
    }
    if let Some(v) = &s.updates {
        put("updates", val(v));
    }
    if let Some(backups) = &s.backups {
        let mut next = current.backups.clone();
        next.auto = backups.auto;
        next.keep = backups.keep;
        put("backups", serde_json::to_value(next).unwrap_or(Value::Null));
    }
    let by_id: HashMap<&str, &InstalledPlugin> = installed.iter().map(|p| (p.manifest.id.as_str(), p)).collect();
    if let Some(theme) = &s.plugin_theme {
        match theme {
            None => put("pluginTheme", Value::Null),
            Some(theme) => {
                let mut split = theme.splitn(2, '/');
                let plugin = split.next().and_then(|id| by_id.get(id));
                let theme_id = split.next().unwrap_or_default();
                if plugin.is_some_and(|p| p.manifest.contributes.themes.iter().any(|t| t.id == theme_id)) {
                    put("pluginTheme", Value::String(theme.clone()));
                } else {
                    skipped.push("pluginTheme".to_string());
                }
            }
        }
    }
    if let Some(provider) = &s.ui_provider {
        match provider {
            None => put("uiProvider", Value::Null),
            Some(id) if by_id.get(id.as_str()).is_some_and(|p| p.manifest.contributes.ui_provider.is_some()) => put("uiProvider", Value::String(id.clone())),
            Some(_) => skipped.push("uiProvider".to_string()),
        }
    }
    (patch, skipped)
}

fn val<T: serde::Serialize>(value: &T) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::plugins::{parse_manifest, InstalledPlugin, PluginMode};
    use serde_json::json;
    use std::collections::BTreeMap;

    fn plugin() -> InstalledPlugin {
        let manifest = parse_manifest(json!({
            "id": "dev.lab", "name": "Lab", "version": "1.0.0", "author": "me", "engines": { "tessera": "1" }, "permissions": ["ui.theme"],
            "contributes": { "themes": [{ "id": "night", "name": "Night", "base": "dark", "tokens": {} }] }
        }))
        .unwrap();
        InstalledPlugin {
            manifest,
            enabled: true,
            granted: vec![],
            pending: vec![],
            mode: PluginMode::Installed,
            integrity: "ok",
            integrity_error: None,
            path: "x".into(),
            source: "x".into(),
            external_folder: None,
            system_programs: BTreeMap::new(),
        }
    }

    fn make(settings: Value) -> Profile {
        Profile::parse(json!({ "formatVersion": 1, "kind": "tessera-profile", "createdAt": now_iso(), "appVersion": "1", "settings": settings, "plugins": [] })).unwrap()
    }

    #[test]
    fn round_trips_without_machine_paths() {
        let mut settings = Settings { projects_folder: Some(r"C:\secret".into()), ..Settings::default() };
        settings.game.ryujinx = Some(r"C:\emu".into());
        settings.shortcuts.insert("app.theme".into(), json!("Mod+T"));
        let profile = build_profile(&settings, &[plugin()], Map::new(), None, "0.1.0");
        let text = serde_json::to_string(&profile).unwrap();
        assert!(!text.contains("secret") && !text.contains("emu"));
        let parsed = Profile::parse(serde_json::from_str(&text).unwrap()).unwrap();
        assert_eq!(parsed.plugins.len(), 1);
        assert_eq!(parsed.plugins[0].version, "1.0.0");
    }

    #[test]
    fn flags_missing_or_other_versions() {
        let profile = Profile::parse(json!({ "formatVersion": 1, "kind": "tessera-profile", "createdAt": now_iso(), "appVersion": "0.1.0", "settings": {},
            "plugins": [{ "id": "dev.lab", "version": "0.9.0", "enabled": true }, { "id": "dev.gone", "version": "1.0.0", "enabled": true }] }))
        .unwrap();
        let preview = preview_profile(&profile, &[plugin()], "t".into());
        assert_eq!(preview.plugins.iter().map(|p| p.state).collect::<Vec<_>>(), vec!["version", "missing"]);
    }

    #[test]
    fn keeps_theme_or_provider_only_when_installed() {
        let (good, _) = profile_settings_patch(&make(json!({ "pluginTheme": "dev.lab/night" })), &Settings::default(), &[plugin()]);
        assert_eq!(good["pluginTheme"], json!("dev.lab/night"));
        let (bad, skipped) = profile_settings_patch(&make(json!({ "pluginTheme": "dev.gone/x", "uiProvider": "dev.gone" })), &Settings::default(), &[plugin()]);
        assert!(bad.get("pluginTheme").is_none());
        assert_eq!(skipped, vec!["pluginTheme", "uiProvider"]);
    }

    #[test]
    fn rejects_broken_values() {
        let base = |settings: Value| json!({ "formatVersion": 1, "kind": "tessera-profile", "createdAt": now_iso(), "appVersion": "1", "plugins": [], "settings": settings });
        assert!(Profile::parse(base(json!({ "uiScale": 5000 }))).is_err());
        assert!(Profile::parse(base(json!({ "shortcuts": { "a b": "Mod+X" } }))).is_err());
    }
}
