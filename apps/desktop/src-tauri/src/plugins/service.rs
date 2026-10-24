use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::schema::check;
use crate::schema::plugins::{parse_manifest, permission_key, read_locales, InstalledPlugin, Permission, PluginManifest, PluginMode, SystemProgram};
use crate::util::paths::{inside, inside_or_same, realpath, relative_slash, resolve};
use crate::util::time::mtime_ms;
use crate::util::{json, Error, Result};

use super::install::SOURCE_FILE;
use super::package::{copy_package, hash_file, list_package, verify_package};

type OnTamper = Box<dyn Fn(&str, &str) + Send + Sync>;

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct PluginError {
    pub code: &'static str,
    pub message: String,
}

impl PluginError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        PluginError { code, message: message.into() }
    }
}

impl From<PluginError> for Error {
    fn from(error: PluginError) -> Self {
        if error.code.is_empty() {
            Error::new(error.message)
        } else {
            Error::new(format!("plugin:{}: {}", error.code, error.message))
        }
    }
}

impl From<Error> for PluginError {
    fn from(error: Error) -> Self {
        PluginError::new("", error.0)
    }
}

impl From<std::io::Error> for PluginError {
    fn from(error: std::io::Error) -> Self {
        PluginError::new("", error.to_string())
    }
}

type PResult<T> = std::result::Result<T, PluginError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    pub id: String,
    #[serde(default = "dev_mode")]
    pub mode: PluginMode,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub enabled: bool,
    pub granted: Vec<Permission>,
    #[serde(default)]
    pub decided: Vec<String>,
    #[serde(default)]
    pub external: Option<String>,
    #[serde(default)]
    pub programs: BTreeMap<String, SystemProgram>,
    #[serde(default)]
    pub hashes: BTreeMap<String, String>,
}

fn dev_mode() -> PluginMode {
    PluginMode::Dev
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registry {
    format_version: u8,
    plugins: Vec<Entry>,
}

impl Registry {
    fn empty() -> Self {
        Registry { format_version: 1, plugins: vec![] }
    }

    fn parse(value: Value) -> Result<Registry> {
        let registry: Registry = serde_json::from_value(value)?;
        if registry.format_version != 1 {
            return Err(Error::new("invalid registry"));
        }
        for entry in &registry.plugins {
            check::plugin_id("id", &entry.id)?;
            if entry.path.is_empty() || entry.source.as_ref().is_some_and(String::is_empty) || entry.decided.iter().any(|d| check::len(d) > 400) {
                return Err(Error::new("invalid entry"));
            }
            for (name, program) in &entry.programs {
                if !check::PROGRAM_NAME.is_match(name) || program.path.is_empty() || !check::SHA256.is_match(&program.sha256) {
                    return Err(Error::new("invalid program"));
                }
            }
        }
        Ok(registry)
    }
}

pub fn read_manifest(folder: &Path) -> PResult<PluginManifest> {
    let root = realpath(folder).map_err(|_| PluginError::new("invalid-manifest", "Folder not found"))?;
    let file = root.join("manifest.json");
    match fs::metadata(&file) {
        Ok(info) if info.is_file() && info.len() <= MAX_MANIFEST_BYTES => {}
        _ => return Err(PluginError::new("invalid-manifest", "manifest.json missing or too large")),
    }
    let raw = fs::read_to_string(&file).map_err(|_| PluginError::new("invalid-manifest", "manifest.json is not valid JSON"))?;
    let value: Value = serde_json::from_str(raw.trim_start_matches('\u{feff}')).map_err(|_| PluginError::new("invalid-manifest", "manifest.json is not valid JSON"))?;
    let manifest = parse_manifest(value).map_err(|e| PluginError::new("invalid-manifest", e.0))?;
    let exists = |rel: &str| realpath(&resolve(&root, rel)).ok().is_some_and(|r| inside(&root, &r) && fs::metadata(&r).map(|m| m.is_file()).unwrap_or(false));
    for widget in &manifest.contributes.widgets {
        if !exists(&widget.entry) {
            return Err(PluginError::new("missing-entry", format!("Widget \"{}\": {} not found", widget.id, widget.entry)));
        }
    }
    if let Some(host) = &manifest.contributes.host {
        if !exists(host) {
            return Err(PluginError::new("missing-entry", format!("Host: {host} not found")));
        }
    }
    let widget_icons = manifest.contributes.widgets.iter().map(|w| &w.icon);
    let button_icons = manifest.contributes.titlebar.iter().map(|b| &b.icon);
    let action_icons = manifest.contributes.file_actions.iter().map(|a| &a.icon);
    for icon in std::iter::once(&manifest.icon).chain(widget_icons).chain(button_icons).chain(action_icons) {
        if check::ICON_IMAGE.is_match(icon) && !exists(icon) {
            return Err(PluginError::new("missing-icon", format!("Icon {icon} not found")));
        }
    }
    Ok(manifest)
}

pub fn inspect_package(folder: &Path) -> PResult<PluginManifest> {
    let manifest = read_manifest(folder)?;
    let root = realpath(folder)?;
    list_package(&root).map_err(|e| PluginError::new("invalid-package", e.0))?;
    Ok(manifest)
}

fn keys_of(manifest: &PluginManifest) -> Vec<String> {
    manifest.permissions.iter().map(|p| permission_key(manifest, *p)).collect()
}

fn is_granted(entry: &Entry, manifest: &PluginManifest, permission: Permission) -> bool {
    manifest.permissions.contains(&permission) && entry.granted.contains(&permission) && entry.decided.contains(&permission_key(manifest, permission))
}

#[derive(Clone)]
struct Loaded {
    manifest: PluginManifest,
    integrity_error: Option<String>,
    checked: bool,
}

struct State {
    registry: Registry,
    loaded: HashMap<String, Loaded>,
    verified: HashMap<String, String>,
}

pub struct PluginService {
    registry_file: PathBuf,
    plugins_dir: PathBuf,
    suspended: AtomicBool,
    state: Mutex<State>,
    on_tamper: OnTamper,
}

impl PluginService {
    pub fn new(registry_file: PathBuf, plugins_dir: PathBuf, on_tamper: impl Fn(&str, &str) + Send + Sync + 'static) -> Self {
        PluginService {
            registry_file,
            plugins_dir,
            suspended: AtomicBool::new(false),
            state: Mutex::new(State { registry: Registry::empty(), loaded: HashMap::new(), verified: HashMap::new() }),
            on_tamper: Box::new(on_tamper),
        }
    }

    pub fn set_suspended(&self, suspended: bool) {
        self.suspended.store(suspended, Ordering::SeqCst);
    }

    fn suspended(&self) -> bool {
        self.suspended.load(Ordering::SeqCst)
    }

    pub fn load(&self) {
        let registry = json::read(&self.registry_file, Registry::parse).unwrap_or_else(Registry::empty);
        let mut loaded = HashMap::new();
        for entry in &registry.plugins {
            match read_manifest(Path::new(&entry.path)) {
                Ok(manifest) if manifest.id == entry.id => {
                    loaded.insert(entry.id.clone(), Loaded { manifest, integrity_error: None, checked: entry.mode != PluginMode::Installed });
                }
                Ok(_) => {}
                Err(error) => eprintln!("[plugins] {} skipped: {}", entry.id, error.message),
            }
        }
        let mut state = self.state.lock().unwrap();
        state.registry = registry;
        state.loaded = loaded;
        state.verified.clear();
    }

    pub fn sync_builtin(&self, folder: &Path) {
        let existing = json::read(&self.registry_file, Registry::parse);
        if existing.is_none() && self.registry_file.exists() {
            return;
        }
        let mut registry = existing.unwrap_or_else(Registry::empty);
        let mut changed = false;
        for item in fs::read_dir(folder).into_iter().flatten().flatten() {
            let Ok(manifest) = read_manifest(&item.path()) else { continue };
            let path = realpath(&item.path()).unwrap_or_else(|_| item.path()).to_string_lossy().into_owned();
            match registry.plugins.iter_mut().find(|p| p.id == manifest.id) {
                Some(entry) if entry.mode == PluginMode::Builtin => {
                    if entry.path != path {
                        entry.path = path;
                        changed = true;
                    }
                    for permission in &manifest.permissions {
                        let key = permission_key(&manifest, *permission);
                        if !entry.decided.contains(&key) {
                            entry.decided.push(key);
                            if !entry.granted.contains(permission) {
                                entry.granted.push(*permission);
                            }
                            changed = true;
                        }
                    }
                }
                Some(_) => {}
                None => {
                    registry.plugins.push(Entry {
                        id: manifest.id.clone(),
                        mode: PluginMode::Builtin,
                        path,
                        source: None,
                        enabled: true,
                        granted: manifest.permissions.clone(),
                        decided: keys_of(&manifest),
                        external: None,
                        programs: BTreeMap::new(),
                        hashes: BTreeMap::new(),
                    });
                    changed = true;
                }
            }
        }
        if changed {
            let _ = json::write(&self.registry_file, &registry);
        }
    }

    pub fn list(&self) -> Vec<InstalledPlugin> {
        let state = self.state.lock().unwrap();
        list_of(&state)
    }

    pub fn get(&self, id: &str) -> PResult<InstalledPlugin> {
        self.list().into_iter().find(|p| p.manifest.id == id).ok_or_else(|| PluginError::new("not-found", "Unknown plugin"))
    }

    pub fn install(&self, folder: &Path, granted: &[Permission], mode: PluginMode) -> PResult<InstalledPlugin> {
        self.install_from(folder, granted, mode, None)
    }

    pub fn install_from(&self, folder: &Path, granted: &[Permission], mode: PluginMode, origin: Option<String>) -> PResult<InstalledPlugin> {
        let manifest = inspect_package(folder)?;
        let source = realpath(folder)?;
        let allowed: Vec<Permission> = granted.iter().copied().filter(|p| manifest.permissions.contains(p)).collect();
        let mut path = source.clone();
        let mut hashes = BTreeMap::new();
        if mode == PluginMode::Installed {
            path = self.plugins_dir.join(&manifest.id);
            if inside_or_same(&path, &source) || inside_or_same(&source, &path) {
                return Err(PluginError::new("invalid-package", "Cannot install a plugin from its own install folder"));
            }
            hashes = copy_package(&source, &path).map_err(|e| PluginError::new("invalid-package", e.0))?;
        }
        let tamper = {
            let mut state = self.state.lock().unwrap();
            let previous = state.registry.plugins.iter().find(|p| p.id == manifest.id).cloned();
            if let Some(previous) = &previous {
                if previous.mode == PluginMode::Installed && mode == PluginMode::Dev {
                    let _ = fs::remove_dir_all(&previous.path);
                }
            }
            let entry = Entry {
                id: manifest.id.clone(),
                mode,
                path: path.to_string_lossy().into_owned(),
                source: Some(origin.clone().unwrap_or_else(|| source.to_string_lossy().into_owned())),
                enabled: true,
                granted: allowed,
                decided: keys_of(&manifest),
                external: previous.as_ref().and_then(|p| p.external.clone()),
                programs: previous.map(|p| p.programs).unwrap_or_default(),
                hashes,
            };
            state.registry.plugins.retain(|p| p.id != manifest.id);
            state.registry.plugins.push(entry);
            self.save(&state)?;
            self.refresh(&mut state, &manifest.id)
        };
        self.notify(tamper);
        self.get(&manifest.id)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> PResult<InstalledPlugin> {
        let tamper = {
            let mut state = self.state.lock().unwrap();
            entry_index(&state, id)?;
            let mut tamper = None;
            if enabled {
                tamper = self.refresh(&mut state, id);
                if let Some(error) = state.loaded.get(id).and_then(|l| l.integrity_error.clone()) {
                    drop(state);
                    self.notify(tamper);
                    return Err(PluginError::new("tampered", error));
                }
            }
            let index = entry_index(&state, id)?;
            state.registry.plugins[index].enabled = enabled;
            self.save(&state)?;
            tamper
        };
        self.notify(tamper);
        self.get(id)
    }

    pub fn set_grants(&self, id: &str, granted: &[Permission]) -> PResult<InstalledPlugin> {
        {
            let mut state = self.state.lock().unwrap();
            let index = entry_index(&state, id)?;
            let manifest = state.loaded.get(id).map(|l| l.manifest.clone());
            let entry = &mut state.registry.plugins[index];
            entry.granted = granted.iter().copied().filter(|p| manifest.as_ref().is_some_and(|m| m.permissions.contains(p))).collect();
            if let Some(manifest) = &manifest {
                entry.decided = keys_of(manifest);
            }
            self.save(&state)?;
        }
        self.get(id)
    }

    pub fn set_external(&self, id: &str, folder: Option<String>) -> PResult<InstalledPlugin> {
        {
            let mut state = self.state.lock().unwrap();
            let index = entry_index(&state, id)?;
            state.registry.plugins[index].external = folder;
            self.save(&state)?;
        }
        self.get(id)
    }

    pub fn set_program(&self, id: &str, name: &str, program: Option<SystemProgram>) -> PResult<InstalledPlugin> {
        {
            let mut state = self.state.lock().unwrap();
            let index = entry_index(&state, id)?;
            let programs = &mut state.registry.plugins[index].programs;
            match program {
                Some(program) => {
                    programs.insert(name.to_string(), program);
                }
                None => {
                    programs.remove(name);
                }
            }
            self.save(&state)?;
        }
        self.get(id)
    }

    pub fn program_of(&self, id: &str, name: &str) -> Option<SystemProgram> {
        let state = self.state.lock().unwrap();
        let entry = state.registry.plugins.iter().find(|p| p.id == id)?;
        let manifest = &state.loaded.get(id)?.manifest;
        if !manifest.system_programs.iter().any(|p| p == name) {
            return None;
        }
        let program = entry.programs.get(name)?;
        let installed = self.programs_dir(id).join(name);
        if inside(&installed, Path::new(&program.path)) {
            let wanted = manifest.installs.get(name).and_then(|systems| systems.get(std::env::consts::OS)).map(|d| d.sha256.as_str());
            if fs::read_to_string(installed.join(SOURCE_FILE)).ok().as_deref() != wanted {
                return None;
            }
        }
        Some(program.clone())
    }

    pub fn manifest_of(&self, id: &str) -> Option<PluginManifest> {
        self.state.lock().unwrap().loaded.get(id).map(|l| l.manifest.clone())
    }

    pub fn name_of(&self, id: &str) -> String {
        self.manifest_of(id).map(|m| m.name).unwrap_or_else(|| id.to_string())
    }

    pub fn programs_dir(&self, id: &str) -> PathBuf {
        self.plugins_dir.with_file_name("programs").join(id)
    }

    pub fn cache_dir(&self) -> PathBuf {
        self.plugins_dir.with_file_name("cache")
    }

    pub fn external_of(&self, id: &str) -> Option<String> {
        self.state.lock().unwrap().registry.plugins.iter().find(|p| p.id == id).and_then(|p| p.external.clone())
    }

    pub fn root_of(&self, id: &str) -> Option<PathBuf> {
        self.state.lock().unwrap().registry.plugins.iter().find(|p| p.id == id).map(|p| PathBuf::from(&p.path))
    }

    pub fn remove(&self, id: &str) -> PResult<()> {
        let mut state = self.state.lock().unwrap();
        let index = entry_index(&state, id)?;
        if state.registry.plugins[index].mode == PluginMode::Builtin {
            return Err(PluginError::new("builtin", "Built-in plugins can only be disabled"));
        }
        let entry = state.registry.plugins.remove(index);
        state.loaded.remove(id);
        if entry.mode == PluginMode::Installed && inside(&self.plugins_dir, Path::new(&entry.path)) {
            let _ = fs::remove_dir_all(&entry.path);
        }
        let _ = fs::remove_dir_all(self.programs_dir(id));
        self.save(&state)?;
        Ok(())
    }

    pub fn has_grant(&self, id: &str, permission: Permission) -> bool {
        if self.suspended() {
            return false;
        }
        let state = self.state.lock().unwrap();
        let entry = state.registry.plugins.iter().find(|p| p.id == id);
        let loaded = state.loaded.get(id);
        match (entry, loaded) {
            (Some(entry), Some(loaded)) => entry.enabled && loaded.checked && loaded.integrity_error.is_none() && is_granted(entry, &loaded.manifest, permission),
            _ => false,
        }
    }

    pub fn resolve_file(&self, id: &str, path: &str) -> Option<PathBuf> {
        if self.suspended() {
            return None;
        }
        let (entry_path, mode, expected_hashes) = {
            let state = self.state.lock().unwrap();
            let entry = state.registry.plugins.iter().find(|p| p.id == id)?;
            let loaded = state.loaded.get(id)?;
            if !entry.enabled || !loaded.checked || loaded.integrity_error.is_some() {
                return None;
            }
            (entry.path.clone(), entry.mode, entry.hashes.clone())
        };
        let root = realpath(Path::new(&entry_path)).ok()?;
        let target = resolve(&root, path);
        if !inside(&root, &target) {
            return None;
        }
        let real = realpath(&target).ok()?;
        if !inside(&root, &real) {
            return None;
        }
        let info = fs::metadata(&real).ok()?;
        if !info.is_file() {
            return None;
        }
        if mode == PluginMode::Installed {
            let key = relative_slash(&root, &real);
            let stamp = format!("{}:{}", info.len(), info.modified().map(mtime_ms).unwrap_or(0.0));
            let cache_key = format!("{id}/{key}");
            let cached = self.state.lock().unwrap().verified.get(&cache_key) == Some(&stamp);
            if !cached {
                let expected = expected_hashes.get(&key);
                let ok = expected.is_some_and(|e| hash_file(&real).ok().as_ref() == Some(e));
                if !ok {
                    let reason = if expected.is_some() { format!("Modified file: {key}") } else { format!("Unexpected file: {key}") };
                    let tamper = self.mark_tampered(id, &reason);
                    self.notify(tamper);
                    return None;
                }
                self.state.lock().unwrap().verified.insert(cache_key, stamp);
            }
        }
        Some(real)
    }

    pub fn verify(&self, id: &str) -> PResult<(bool, Option<String>)> {
        let (result, tamper) = {
            let mut state = self.state.lock().unwrap();
            entry_index(&state, id)?;
            let prefix = format!("{id}/");
            state.verified.retain(|k, _| !k.starts_with(&prefix));
            let tamper = self.refresh(&mut state, id);
            let result = match state.loaded.get(id) {
                None => (false, Some("invalid manifest".to_string())),
                Some(loaded) => (loaded.integrity_error.is_none(), loaded.integrity_error.clone()),
            };
            (result, tamper)
        };
        self.notify(tamper);
        Ok(result)
    }

    fn refresh(&self, state: &mut State, id: &str) -> Option<(String, String)> {
        let index = state.registry.plugins.iter().position(|p| p.id == id)?;
        let entry = state.registry.plugins[index].clone();
        match read_manifest(Path::new(&entry.path)) {
            Ok(manifest) if manifest.id == entry.id => {
                let integrity_error = if entry.mode == PluginMode::Installed { verify_package(Path::new(&entry.path), &entry.hashes) } else { None };
                state.loaded.insert(id.to_string(), Loaded { manifest, integrity_error: integrity_error.clone(), checked: true });
                if let Some(error) = integrity_error {
                    if entry.enabled {
                        state.registry.plugins[index].enabled = false;
                        let _ = self.save(state);
                        return Some((id.to_string(), error));
                    }
                }
                None
            }
            Ok(_) => {
                state.loaded.remove(id);
                None
            }
            Err(error) => {
                eprintln!("[plugins] {id} skipped: {}", error.message);
                state.loaded.remove(id);
                None
            }
        }
    }

    fn mark_tampered(&self, id: &str, reason: &str) -> Option<(String, String)> {
        let mut state = self.state.lock().unwrap();
        let loaded = state.loaded.get_mut(id)?;
        if loaded.integrity_error.is_some() {
            return None;
        }
        loaded.integrity_error = Some(reason.to_string());
        if let Some(entry) = state.registry.plugins.iter_mut().find(|p| p.id == id) {
            entry.enabled = false;
        }
        let _ = self.save(&state);
        Some((id.to_string(), reason.to_string()))
    }

    fn notify(&self, tamper: Option<(String, String)>) {
        if let Some((id, reason)) = tamper {
            (self.on_tamper)(&id, &reason);
        }
    }

    fn save(&self, state: &State) -> Result<()> {
        json::write(&self.registry_file, &state.registry)
    }
}

fn entry_index(state: &State, id: &str) -> PResult<usize> {
    state.registry.plugins.iter().position(|p| p.id == id).ok_or_else(|| PluginError::new("not-found", "Unknown plugin"))
}

fn list_of(state: &State) -> Vec<InstalledPlugin> {
    state
        .registry
        .plugins
        .iter()
        .filter_map(|entry| {
            let loaded = state.loaded.get(&entry.id)?;
            let manifest = &loaded.manifest;
            Some(InstalledPlugin {
                manifest: manifest.clone(),
                enabled: entry.enabled,
                granted: entry.granted.iter().copied().filter(|p| is_granted(entry, manifest, *p)).collect(),
                pending: manifest.permissions.iter().copied().filter(|p| !entry.decided.contains(&permission_key(manifest, *p))).collect(),
                mode: entry.mode,
                integrity: if entry.mode == PluginMode::Dev {
                    "dev"
                } else if entry.mode == PluginMode::Builtin {
                    "builtin"
                } else if loaded.integrity_error.is_some() {
                    "tampered"
                } else {
                    "ok"
                },
                integrity_error: loaded.integrity_error.clone(),
                path: entry.path.clone(),
                source: entry.source.clone().unwrap_or_else(|| entry.path.clone()),
                external_folder: entry.external.clone(),
                system_programs: entry.programs.iter().filter(|(name, _)| manifest.system_programs.contains(name)).map(|(k, v)| (k.clone(), v.clone())).collect(),
                locales: read_locales(Path::new(&entry.path)),
            })
        })
        .collect()
}
