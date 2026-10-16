use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{Manager, Runtime, Webview};

use crate::backups::service::BackupReason;
use crate::plugins::api::Decision;
use crate::plugins::archive::{unpack, PACKAGE_EXTENSION};
use crate::plugins::exec::describe_program;
use crate::plugins::service::inspect_package;
use crate::profile::{build_profile, preview_profile, profile_settings_patch, strip_layout_state, MAX_PROFILE_BYTES, PROFILE_EXTENSION};
use crate::projects::export::export_project;
use crate::projects::files_list::{list_dir, read_text, resolve_inside};
use crate::projects::history::{FileChange, Meta};
use crate::projects::layout::{layout_file, read_layout, write_layout};
use crate::projects::notes::{create_note, delete_note, list_notes, note_file, read_note, write_note};
use crate::projects::search::{list_project_files, search_project, SearchOptions, MAX_INDEXED, SEARCH_BUDGET_MS};
use crate::schema::check;
use crate::schema::plugins::Permission;
use crate::schema::projects::{CreateProject, ProjectPatch, UpsertCollection, UpsertTag};
use crate::schema::requests::*;
use crate::schema::settings::validate_patch;
use crate::schema::tools::{HistoryKind, Profile, ProfileApplied};
use crate::state::{AppState, PendingPackage};
use crate::util::time::stamp_for_file;
use crate::util::{Error, Result};
use crate::window;

const RESET_FILES: [&str; 8] = ["settings.json", "plugins.json", "plugin-settings.json", "plugins", "secrets", "permissions.log", "permissions.log.1", "startup.json"];

fn value<T: Serialize>(data: T) -> Result<Value> {
    Ok(serde_json::to_value(data)?)
}

fn done() -> Result<Value> {
    Ok(Value::Null)
}

fn path_string(path: Option<PathBuf>) -> Value {
    path.map(|p| Value::String(p.to_string_lossy().into_owned())).unwrap_or(Value::Null)
}

fn open_path(path: &Path) -> Result<()> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| Error::new(e.to_string()))
}

fn reveal(path: &Path) {
    let _ = tauri_plugin_opener::reveal_item_in_dir(path);
}

fn csv_cell(value: &str) -> String {
    let safe = if value.starts_with(['=', '+', '-', '@', '\t', '\r']) { format!("'{value}") } else { value.to_string() };
    format!("\"{}\"", safe.replace('"', "\"\""))
}

fn platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}

fn plugin_settings_value(state: &AppState, id: &str) -> Value {
    Value::Object(state.plugin_settings.values(id))
}

fn revoke(state: &AppState, id: &str) {
    state.api.revoke_session(id);
    state.discord.clear(id);
}

pub fn dispatch(state: &Arc<AppState>, channel: &str, request: Option<Value>) -> Result<Value> {
    let s = state.as_ref();
    match channel {
        "app:info" => {
            none(&request)?;
            Ok(json!({
                "name": s.app.package_info().name,
                "version": s.version,
                "tauri": tauri::VERSION,
                "webview": tauri::webview_version().unwrap_or_default(),
                "platform": platform(),
                "safeMode": s.safe_reason.is_some(),
                "safeReason": s.safe_reason,
                "userData": s.user_data.to_string_lossy(),
            }))
        }
        "app:open-external" => {
            let r: OpenExternal = parse(request)?;
            check::https_url("url", &r.url, usize::MAX)?;
            tauri_plugin_opener::open_url(&r.url, None::<&str>).map_err(|e| Error::new(e.to_string()))?;
            Ok(json!(true))
        }
        "app:started" => {
            none(&request)?;
            s.guard.done()?;
            if let Some(window) = s.app.get_webview_window("main") {
                let _ = window.set_shadow(true);
            }
            done()
        }
        "app:restart" => {
            let r: Restart = parse(request)?;
            s.guard.done()?;
            window::restart(s, if r.safe_mode { Some(r.reason.unwrap_or(SafeReason::Flag)) } else { None });
            done()
        }
        "app:open-data" => {
            none(&request)?;
            open_path(&s.user_data)?;
            done()
        }
        "app:cache-size" => {
            none(&request)?;
            value(window::cache_size(&s.app))
        }
        "app:clear-cache" => {
            none(&request)?;
            window::clear_cache(&s.app);
            done()
        }
        "app:reset" => {
            none(&request)?;
            for name in RESET_FILES {
                let target = s.user_data.join(name);
                let _ = fs::remove_dir_all(&target);
                let _ = fs::remove_file(&target);
            }
            window::clear_cache(&s.app);
            window::restart(s, None);
            done()
        }
        "safe:apply" => {
            let r: SafeApply = parse(request)?;
            r.validate()?;
            let known: Vec<String> = s.plugins.list().into_iter().map(|p| p.manifest.id).collect();
            for id in &r.disable {
                if known.contains(id) {
                    s.plugins.set_enabled(id, false)?;
                }
            }
            if r.reset_layouts {
                let stamp = stamp_for_file();
                for root in s.projects.roots() {
                    let file = layout_file(&root);
                    let _ = fs::rename(&file, file.with_file_name(format!("layout.reset-{stamp}.json")));
                }
            }
            if r.reset_look {
                let patch = json!({ "pluginTheme": null, "uiProvider": null, "accent": null, "uiScale": 100 });
                s.settings.update(patch.as_object().unwrap())?;
            }
            if r.clear_cache {
                window::clear_cache(&s.app);
            }
            done()
        }
        "backups:list" => value(s.backups.list(&IdRef::uuid(request)?)?),
        "backups:create" => {
            let mut r: CreateBackup = parse(request)?;
            r.validate()?;
            let reason = if r.reason == ManualOrAuto::Auto { BackupReason::Auto } else { BackupReason::Manual };
            value(s.backups.create(&r.id, reason, &r.note)?)
        }
        "backups:restore" => {
            let r: BackupRef = parse(request)?;
            r.validate()?;
            value(s.backups.restore(&r.id, &r.backup)?)
        }
        "backups:delete" => {
            let r: BackupRef = parse(request)?;
            r.validate()?;
            s.backups.delete(&r.id, &r.backup)?;
            done()
        }
        "backups:reveal" => {
            let r: BackupRef = parse(request)?;
            r.validate()?;
            reveal(&s.backups.file_of(&r.id, &r.backup)?);
            done()
        }
        "backups:extract" => {
            let r: BackupRef = parse(request)?;
            r.validate()?;
            let Some(folder) = s.host.pick_folder(None, true) else { return Ok(Value::Null) };
            let target = s.backups.extract(&r.id, &r.backup, &folder)?;
            reveal(&target);
            Ok(path_string(Some(target)))
        }
        "settings:get" => {
            none(&request)?;
            value(s.settings.current())
        }
        "settings:update" => {
            let patch = validate_patch(request.unwrap_or(Value::Null))?;
            value(s.settings.update(&patch)?)
        }
        "projects:home" => {
            none(&request)?;
            value(s.projects.home())
        }
        "projects:create" => {
            let mut r: CreateProject = parse(request)?;
            r.validate()?;
            value(s.projects.create(&r)?)
        }
        "projects:pick-location" => {
            none(&request)?;
            let picked = s.host.files().set_directory(s.projects.default_location()).set_can_create_directories(true).blocking_pick_folder().and_then(|p| p.into_path().ok());
            Ok(path_string(picked))
        }
        "projects:import" => {
            none(&request)?;
            let picked = s.host.files().set_directory(s.projects.default_location()).set_can_create_directories(true).blocking_pick_folder().and_then(|p| p.into_path().ok());
            match picked {
                Some(folder) => value(s.projects.import_folder(&folder)?),
                None => Ok(Value::Null),
            }
        }
        "projects:open" => value(s.projects.open(&IdRef::uuid(request)?)?),
        "projects:update" => {
            #[derive(serde::Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Update {
                id: String,
                patch: ProjectPatch,
            }
            let mut r: Update = parse(request)?;
            check::uuid("id", &r.id)?;
            r.patch.validate()?;
            value(s.projects.update(&r.id, &r.patch)?)
        }
        "projects:set-cover" => {
            let id = IdRef::uuid(request)?;
            let file = s.host.files().add_filter("Images", &["png", "jpg", "jpeg", "webp"]).blocking_pick_file().and_then(|p| p.into_path().ok());
            match file {
                Some(file) => value(s.projects.set_cover(&id, &file)?),
                None => Ok(Value::Null),
            }
        }
        "projects:remove-cover" => value(s.projects.remove_cover(&IdRef::uuid(request)?)?),
        "projects:forget" => {
            s.projects.forget(&IdRef::uuid(request)?)?;
            done()
        }
        "projects:reveal" => {
            open_path(&s.projects.path_of(&IdRef::uuid(request)?)?)?;
            done()
        }
        "projects:export" => {
            #[derive(serde::Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Export {
                id: String,
                zip: bool,
            }
            let r: Export = parse(request)?;
            check::uuid("id", &r.id)?;
            let out = export_project(&s.projects.root_of(&r.id)?, r.zip)?;
            reveal(&out);
            Ok(path_string(Some(out)))
        }
        "tags:upsert" => {
            let mut r: UpsertTag = parse(request)?;
            r.validate()?;
            value(s.projects.upsert_tag(&r)?)
        }
        "tags:delete" => {
            s.projects.delete_tag(&IdRef::uuid(request)?)?;
            done()
        }
        "collections:upsert" => {
            let mut r: UpsertCollection = parse(request)?;
            r.validate()?;
            value(s.projects.upsert_collection(&r)?)
        }
        "collections:delete" => {
            s.projects.delete_collection(&IdRef::uuid(request)?)?;
            done()
        }
        "layout:get" => {
            let id = IdRef::uuid(request)?;
            let template = s.settings.current().layout_template;
            value(read_layout(&s.projects.root_of(&id)?, template.as_ref()))
        }
        "layout:save" => {
            let (id, layout) = parse::<SaveLayout>(request)?.into_parts()?;
            write_layout(&s.projects.root_of(&id)?, &layout)?;
            done()
        }
        "files:list" => {
            let r: ProjectPath = parse(request)?;
            r.validate(0)?;
            value(list_dir(&s.projects.root_of(&r.id)?, &r.path)?)
        }
        "files:read-text" => {
            let r: ProjectPath = parse(request)?;
            r.validate(1)?;
            value(read_text(&s.projects.root_of(&r.id)?, &r.path)?)
        }
        "files:reveal" => {
            let r: ProjectPath = parse(request)?;
            r.validate(1)?;
            reveal(&resolve_inside(&s.projects.root_of(&r.id)?, &r.path)?);
            done()
        }
        "files:index" => value(list_project_files(&s.projects.root_of(&IdRef::uuid(request)?)?, MAX_INDEXED, SEARCH_BUDGET_MS)),
        "notes:list" => value(list_notes(&s.projects.root_of(&IdRef::uuid(request)?)?)),
        "notes:read" => {
            let mut r: NoteRef = parse(request)?;
            r.validate(Content::Forbidden)?;
            value(read_note(&s.projects.root_of(&r.id)?, &r.name)?)
        }
        "notes:write" => {
            let mut r: NoteRef = parse(request)?;
            r.validate(Content::Required)?;
            let root = s.projects.root_of(&r.id)?;
            let file = note_file(&root, &r.name)?;
            let content = r.content.clone().unwrap_or_default();
            s.history.track(&r.id, &root, Meta::new(HistoryKind::NoteWrite, r.name.clone()), &[file], || write_note(&root, &r.name, &content))?;
            done()
        }
        "notes:create" => {
            let mut r: NoteRef = parse(request)?;
            r.validate(Content::Optional)?;
            let root = s.projects.root_of(&r.id)?;
            let content = r.content.clone().unwrap_or_default();
            let created = create_note(&root, &r.name, &content)?;
            let change = FileChange { path: note_file(&root, &created)?, before: None, after: Some(content.into_bytes()) };
            s.history.record(&r.id, &root, Meta::new(HistoryKind::NoteCreate, created.clone()), vec![change]);
            value(created)
        }
        "notes:delete" => {
            let mut r: NoteRef = parse(request)?;
            r.validate(Content::Forbidden)?;
            let root = s.projects.root_of(&r.id)?;
            let file = note_file(&root, &r.name)?;
            s.history.track(&r.id, &root, Meta::new(HistoryKind::NoteDelete, r.name.clone()), &[file], || delete_note(&root, &r.name))?;
            done()
        }
        "search:project" => {
            let mut r: Search = parse(request)?;
            r.validate()?;
            let root = s.projects.root_of(&r.id)?;
            value(search_project(&root, &SearchOptions { query: r.query, content: r.content, limit: r.limit as usize, budget_ms: SEARCH_BUDGET_MS }))
        }
        "history:state" => value(s.history.state(&IdRef::uuid(request)?)),
        "history:undo" => value(s.history.undo(&IdRef::uuid(request)?)?),
        "history:redo" => value(s.history.redo(&IdRef::uuid(request)?)?),
        "plugins:list" => {
            none(&request)?;
            value(s.plugins.list())
        }
        "plugins:inspect-local" => {
            let r: Option<InspectLocal> = match request {
                None | Some(Value::Null) => None,
                some => Some(parse(some)?),
            };
            let path = match r.and_then(|r| r.path) {
                Some(path) => {
                    check::text("path", &path, 1, 500)?;
                    Some(PathBuf::from(path))
                }
                None => s.host.files().blocking_pick_folder().and_then(|p| p.into_path().ok()),
            };
            let Some(path) = path else { return Ok(Value::Null) };
            let shown = path.to_string_lossy().into_owned();
            Ok(match inspect_package(&path) {
                Ok(manifest) => json!({ "path": shown, "manifest": manifest }),
                Err(error) => json!({ "path": shown, "error": error.message }),
            })
        }
        "plugins:inspect-package" => {
            let r: Option<InspectLocal> = match request {
                None | Some(Value::Null) => None,
                some => Some(parse(some)?),
            };
            let file = match r.and_then(|r| r.path) {
                Some(path) => {
                    check::text("path", &path, 1, 500)?;
                    Some(PathBuf::from(path))
                }
                None => s.host.files().add_filter("Tessera plugin", &[PACKAGE_EXTENSION]).blocking_pick_file().and_then(|p| p.into_path().ok()),
            };
            let Some(file) = file else { return Ok(Value::Null) };
            if let Some(previous) = s.pending_package.lock().unwrap().take() {
                let _ = fs::remove_dir_all(&previous.staging);
            }
            let token = uuid::Uuid::new_v4().to_string();
            let staging = s.packages_dir.join(&token);
            let shown = file.to_string_lossy().into_owned();
            match unpack(&file, &staging) {
                Ok(manifest) => {
                    *s.pending_package.lock().unwrap() = Some(PendingPackage { token: token.clone(), staging, file });
                    Ok(json!({ "token": token, "path": shown, "manifest": manifest }))
                }
                Err(error) => {
                    let _ = fs::remove_dir_all(&staging);
                    Ok(json!({ "path": shown, "error": error.message }))
                }
            }
        }
        "plugins:install-package" => {
            let r: InstallPackage = parse(request)?;
            check::uuid("token", &r.token)?;
            if r.granted.len() > 16 {
                return Err(Error::new("invalid request (too many permissions)"));
            }
            let pending = {
                let mut slot = s.pending_package.lock().unwrap();
                match slot.take() {
                    Some(p) if p.token == r.token => p,
                    other => {
                        *slot = other;
                        return Err(Error::new("plugin:expired: package import expired"));
                    }
                }
            };
            let result = s.plugins.install_from(&pending.staging, &r.granted, crate::schema::plugins::PluginMode::Installed, Some(pending.file.to_string_lossy().into_owned()));
            let _ = fs::remove_dir_all(&pending.staging);
            let plugin = result?;
            revoke(s, &plugin.manifest.id);
            s.audit.record(&plugin.manifest.id, "install.package", &plugin.manifest.version, true);
            value(plugin)
        }
        "plugins:install-local" => {
            let r: InstallLocal = parse(request)?;
            r.validate()?;
            let plugin = s.plugins.install(Path::new(&r.path), &r.granted, r.mode)?;
            revoke(s, &plugin.manifest.id);
            let mode = if r.mode == crate::schema::plugins::PluginMode::Installed { "installed" } else { "dev" };
            s.audit.record(&plugin.manifest.id, &format!("install.{mode}"), &plugin.manifest.version, true);
            value(plugin)
        }
        "plugins:set-enabled" => {
            let r: SetEnabled = parse(request)?;
            check::plugin_id("id", &r.id)?;
            revoke(s, &r.id);
            value(s.plugins.set_enabled(&r.id, r.enabled)?)
        }
        "plugins:set-grants" => {
            let r: SetGrants = parse(request)?;
            check::plugin_id("id", &r.id)?;
            if r.granted.len() > 16 {
                return Err(Error::new("invalid request (too many permissions)"));
            }
            revoke(s, &r.id);
            let plugin = s.plugins.set_grants(&r.id, &r.granted)?;
            let target: Vec<&str> = r.granted.iter().map(Permission::as_str).collect();
            let joined = if target.is_empty() { "-".to_string() } else { target.join(", ") };
            s.audit.record(&r.id, "grants.set", &joined, true);
            value(plugin)
        }
        "plugins:remove" => {
            let id = IdRef::plugin(request)?;
            revoke(s, &id);
            s.plugins.remove(&id)?;
            s.secrets.clear(&id);
            s.plugin_settings.forget(&id)?;
            done()
        }
        "plugins:activity" => value(s.audit.for_plugin(&IdRef::plugin(request)?, 100)),
        "plugins:verify" => {
            let id = IdRef::plugin(request)?;
            let (ok, error) = s.plugins.verify(&id)?;
            Ok(json!({ "id": id, "ok": ok, "error": error }))
        }
        "plugins:set-external" => {
            let r: SetExternal = parse(request)?;
            check::plugin_id("id", &r.id)?;
            let name = s.plugins.name_of(&r.id);
            let folder = if r.pick { s.host.pick_folder(Some(&s.host.external_title(&name)), false) } else { None };
            if r.pick && folder.is_none() {
                return value(s.plugins.get(&r.id)?);
            }
            let folder = folder.map(|f| f.to_string_lossy().into_owned());
            s.audit.record(&r.id, "external.set", folder.as_deref().unwrap_or("-"), true);
            value(s.plugins.set_external(&r.id, folder)?)
        }
        "plugins:confirm-answer" => {
            let r: ConfirmAnswer = parse(request)?;
            let decision = match r.decision.as_str() {
                "once" => Decision::Once,
                "session" => Decision::Session,
                "deny" => Decision::Deny,
                _ => return Err(Error::new("invalid decision")),
            };
            s.host.answer(r.id, decision);
            Ok(Value::Null)
        }
        "plugins:pick-program" => {
            let r: PickProgram = parse(request)?;
            check::plugin_id("id", &r.id)?;
            check::matches("name", &check::PROGRAM_NAME, &r.name)?;
            let manifest = s.plugins.manifest_of(&r.id);
            if !manifest.as_ref().is_some_and(|m| m.system_programs.contains(&r.name)) {
                return Err(Error::new("program not declared"));
            }
            if !r.pick {
                revoke(s, &r.id);
                s.audit.record(&r.id, "program.set", &format!("{} = -", r.name), true);
                return value(s.plugins.set_program(&r.id, &r.name, None)?);
            }
            let name = manifest.map(|m| m.name).unwrap_or_else(|| r.id.clone());
            let Some(file) = crate::plugins::api::Host::pick_program(s.host.as_ref(), &name, &r.name) else { return value(s.plugins.get(&r.id)?) };
            let program = describe_program(&file)?;
            revoke(s, &r.id);
            s.audit.record(&r.id, "program.set", &format!("{} = {}", r.name, program.path), true);
            value(s.plugins.set_program(&r.id, &r.name, Some(program))?)
        }
        "plugins:settings-get" => Ok(plugin_settings_value(s, &IdRef::plugin(request)?)),
        "plugins:settings-set" => {
            let r: SetPluginSetting = parse(request)?;
            r.validate()?;
            value(s.plugin_settings.set(&r.id, &r.key, &r.value)?)
        }
        "plugins:settings-reset" => {
            let r: ResetPluginSetting = parse(request)?;
            check::plugin_id("id", &r.id)?;
            if let Some(key) = &r.key {
                check::matches("key", &check::SETTING_KEY, key)?;
            }
            value(s.plugin_settings.reset(&r.id, r.key.as_deref())?)
        }
        "plugin:call" => {
            let r: PluginCall = parse(request)?;
            r.validate()?;
            s.api.call(r)
        }
        "plugin:watch" => {
            let r: PluginWatch = parse(request)?;
            check::plugin_id("pluginId", &r.plugin_id)?;
            check::uuid("projectId", &r.project_id)?;
            if !r.watching {
                s.watcher.stop(&r.project_id, &r.plugin_id);
                return done();
            }
            let allowed = s.plugins.has_grant(&r.plugin_id, Permission::FsProjectRead);
            s.audit.record(&r.plugin_id, "files.watch", ".", allowed);
            if !allowed {
                return Err(Error::new("permission denied: fs.project.read"));
            }
            s.watcher.start(&r.project_id, &s.projects.root_of(&r.project_id)?, &r.plugin_id)?;
            done()
        }
        "app:pick-folder" => {
            let r: PickFolder = parse(request)?;
            if let Some(title) = &r.title {
                check::text("title", title, 0, 120)?;
            }
            Ok(path_string(s.host.pick_folder(r.title.as_deref(), true)))
        }
        "app:pick-file" => {
            let r: PickFile = parse(request)?;
            if r.extensions.is_empty() || r.extensions.len() > 8 {
                return Err(Error::new("extensions: 1 to 8"));
            }
            for extension in &r.extensions {
                check::matches("extensions", &check::ICON, extension)?;
            }
            let extensions: Vec<&str> = r.extensions.iter().map(String::as_str).collect();
            let file = s.host.files().add_filter(r.extensions.join(", "), &extensions).blocking_pick_file();
            Ok(path_string(file.and_then(|p| p.into_path().ok())))
        }
        "accounts:connect" => {
            let r: ConnectAccount = parse(request)?;
            let mut accounts = s.settings.current().accounts;
            match r {
                ConnectAccount::Github { token } => {
                    let token = check::js_trim(&token);
                    check::text("token", &token, 20, 255)?;
                    accounts.github = Some(s.accounts.connect_github(&token)?);
                }
                ConnectAccount::Gamebanana { member } => {
                    let member = check::js_trim(&member);
                    check::text("member", &member, 1, 200)?;
                    accounts.gamebanana = Some(s.accounts.connect_gamebanana(&member)?);
                }
            }
            value(s.settings.set_accounts(accounts)?)
        }
        "accounts:disconnect" => {
            let r: DisconnectAccount = parse(request)?;
            s.accounts.disconnect(r.service)?;
            let mut accounts = s.settings.current().accounts;
            match r.service {
                AccountKind::Github => accounts.github = None,
                AccountKind::Gamebanana => accounts.gamebanana = None,
            }
            value(s.settings.set_accounts(accounts)?)
        }
        "updates:check" => {
            none(&request)?;
            value(crate::updates::check_for_update(&s.version))
        }
        "audit:list" => {
            let q = AuditQuery::parse(request)?;
            value(s.audit.query(&crate::plugins::audit::Query { plugin_id: q.plugin_id.as_deref(), allowed: q.allowed, text: q.text.as_deref(), limit: q.limit as usize }))
        }
        "audit:clear" => {
            none(&request)?;
            s.audit.clear();
            done()
        }
        "audit:export" => {
            let r: AuditExport = parse(request)?;
            let (ext, label) = match r.format {
                AuditFormat::Json => ("json", "JSON"),
                AuditFormat::Csv => ("csv", "CSV"),
            };
            let Some(file) = s.host.files().set_file_name(format!("tessera-journal.{ext}")).add_filter(label, &[ext]).blocking_save_file().and_then(|p| p.into_path().ok()) else {
                return Ok(Value::Null);
            };
            let entries = s.audit.query(&crate::plugins::audit::Query { plugin_id: None, allowed: None, text: None, limit: 2000 }).entries;
            let content = match r.format {
                AuditFormat::Json => serde_json::to_string_pretty(&entries)?,
                AuditFormat::Csv => {
                    let mut lines = vec!["time,plugin,action,target,result".to_string()];
                    for e in &entries {
                        lines.push([e.time.as_str(), &e.plugin_id, &e.action, &e.target, if e.allowed { "allowed" } else { "denied" }].iter().map(|c| csv_cell(c)).collect::<Vec<_>>().join(","));
                    }
                    lines.join("\n") + "\n"
                }
            };
            fs::write(&file, content)?;
            Ok(path_string(Some(file)))
        }
        "profile:export" => {
            let r: ExportProfile = parse(request)?;
            let layout = match &r.layout_from {
                Some(id) => {
                    check::uuid("layoutFrom", id)?;
                    Some(strip_layout_state(&read_layout(&s.projects.root_of(id)?, None)))
                }
                None => None,
            };
            let profile = build_profile(&s.settings.current(), &s.plugins.list(), s.plugin_settings.all(), layout, &s.version);
            let Some(file) = s
                .host
                .files()
                .set_file_name(format!("tessera.{PROFILE_EXTENSION}"))
                .add_filter("Tessera profile", &[PROFILE_EXTENSION])
                .blocking_save_file()
                .and_then(|p| p.into_path().ok())
            else {
                return Ok(Value::Null);
            };
            fs::write(&file, serde_json::to_string_pretty(&profile)?)?;
            Ok(path_string(Some(file)))
        }
        "profile:read" => {
            none(&request)?;
            let Some(file) = s.host.files().add_filter("Tessera profile", &[PROFILE_EXTENSION]).blocking_pick_file().and_then(|p| p.into_path().ok()) else {
                return Ok(Value::Null);
            };
            if fs::metadata(&file).map(|m| m.len()).unwrap_or(0) > MAX_PROFILE_BYTES {
                return Ok(json!({ "ok": false, "error": "too-large" }));
            }
            let parsed = fs::read_to_string(&file).ok().and_then(|raw| serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}')).ok()).and_then(|v| Profile::parse(v).ok());
            let Some(profile) = parsed else { return Ok(json!({ "ok": false, "error": "invalid" })) };
            let token = uuid::Uuid::new_v4().to_string();
            let preview = preview_profile(&profile, &s.plugins.list(), token.clone());
            *s.pending_profile.lock().unwrap() = Some((token, profile));
            Ok(json!({ "ok": true, "preview": preview }))
        }
        "profile:apply" => {
            let r: ApplyProfile = parse(request)?;
            check::uuid("token", &r.token)?;
            let profile = {
                let mut pending = s.pending_profile.lock().unwrap();
                match pending.take() {
                    Some((token, profile)) if token == r.token => profile,
                    other => {
                        *pending = other;
                        return Err(Error::new("profile:expired"));
                    }
                }
            };
            let installed = s.plugins.list();
            let mut skipped = vec![];
            let mut settings_count = 0;
            let mut plugins_count = 0;
            if r.plugins {
                for entry in &profile.plugins {
                    let plugin = installed.iter().find(|p| p.manifest.id == entry.id);
                    match plugin {
                        Some(p) if p.mode == crate::schema::plugins::PluginMode::Installed && p.integrity != "tampered" => {
                            if p.enabled != entry.enabled {
                                s.plugins.set_enabled(&entry.id, entry.enabled)?;
                                plugins_count += 1;
                            }
                        }
                        _ => skipped.push(entry.id.clone()),
                    }
                }
                for (id, values) in &profile.plugin_settings {
                    if installed.iter().any(|p| &p.manifest.id == id) {
                        settings_count += s.plugin_settings.set_many(id, values.as_object().unwrap_or(&Map::new()))?;
                    }
                }
            }
            if r.settings {
                let (patch, rejected) = profile_settings_patch(&profile, &s.settings.current(), &s.plugins.list());
                skipped.extend(rejected);
                s.settings.update(&patch)?;
                settings_count += patch.len();
            }
            if r.layout {
                if let Some(layout) = &profile.layout {
                    let patch = json!({ "layoutTemplate": strip_layout_state(layout) });
                    s.settings.update(patch.as_object().unwrap())?;
                    settings_count += 1;
                }
            }
            value(ProfileApplied { settings: settings_count, plugins: plugins_count, skipped })
        }
        _ => Err(Error::new(format!("Unknown channel: {channel}"))),
    }
}

pub fn trusted<R: Runtime>(webview: &Webview<R>) -> bool {
    webview.label() == "main" && webview.url().map(|url| window::is_trusted(&url)).unwrap_or(false)
}

#[tauri::command]
pub async fn tessera_invoke(webview: Webview, channel: String, request: Option<Value>) -> std::result::Result<Value, String> {
    if !trusted(&webview) {
        return Err(format!("[ipc] {channel}: untrusted sender"));
    }
    let state = webview.app_handle().state::<Arc<AppState>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || dispatch(&state, &channel, request).map_err(|e| e.0))
        .await
        .map_err(|e| e.to_string())?
}
