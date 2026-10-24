use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::projects::arc::{list_arc, mod_path, open_arc, read_arc, search_arc, walk_arc};
use crate::projects::export::deploy_project;
use crate::projects::files::TESSERA_DIR;
use crate::projects::history::{HistoryService, Meta};
use crate::projects::service::ProjectService;
use crate::projects::ssbh::{mesh_buffers, read_ssbh, write_ssbh};
use crate::projects::textures::{add_texture, convert_texture, export_texture, preview_texture, replace_texture, Options};
use crate::schema::check;
use crate::schema::plugins::{Permission, MAX_BINARY_BYTES};
use crate::schema::requests::PluginCall;
use crate::schema::tools::HistoryKind;
use crate::util::paths::{realpath, relative_parts, resolve};
use crate::util::{Error, Result};

use super::audit::AuditLog;
use super::discord::{DiscordPresence, SetActivity};
use super::install::{download, install};
use super::exec::{check_system_program, command_line, describe_program, resolve_program, run_program, spawn_program, ExecParams, OutputSink};
use super::net::{check_url, plugin_fetch, FetchParams};
use super::scoped_fs::{self, Scope, Trash};
use super::secrets::SecretStore;
use super::service::PluginService;

const NOTIFY_EVERY_MS: u128 = 3000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Once,
    Session,
    Deny,
}

pub trait Host: Send + Sync {
    fn pick_external(&self, plugin_name: &str) -> Option<PathBuf>;
    fn pick_arc(&self, plugin_name: &str) -> Option<PathBuf>;
    fn pick_program(&self, plugin_name: &str, program: &str) -> Option<PathBuf>;
    fn confirm_exec(&self, plugin_id: &str, plugin_name: &str, command: &str) -> Decision;
    fn confirm_open(&self, plugin_id: &str, plugin_name: &str, url: &str) -> Decision;
    fn open_url(&self, url: &str) -> Result<()>;
    fn reveal(&self, path: &Path);
    fn trash(&self, path: &Path) -> Result<()>;
    fn write_clipboard(&self, text: &str);
    fn notify(&self, title: &str, body: &str);
    fn exec_output(&self, plugin_id: &str, stream: &str, kind: &str, text: &str);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FsScope {
    Project,
    Private,
    External,
}

impl FsScope {
    fn as_str(&self) -> &'static str {
        match self {
            FsScope::Project => "project",
            FsScope::Private => "private",
            FsScope::External => "external",
        }
    }

    fn read(&self) -> Permission {
        match self {
            FsScope::Project => Permission::FsProjectRead,
            FsScope::Private => Permission::FsProjectWrite,
            FsScope::External => Permission::FsExternal,
        }
    }

    fn write(&self) -> Permission {
        match self {
            FsScope::External => Permission::FsExternal,
            _ => Permission::FsProjectWrite,
        }
    }
}

fn project_scope() -> FsScope {
    FsScope::Project
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PathParams {
    #[serde(default = "project_scope")]
    scope: FsScope,
    path: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WriteParams {
    #[serde(default = "project_scope")]
    scope: FsScope,
    path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BytesParams {
    #[serde(default = "project_scope")]
    scope: FsScope,
    path: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RenameParams {
    #[serde(default = "project_scope")]
    scope: FsScope,
    from: String,
    to: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PreviewParams {
    path: String,
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArcParams {
    #[serde(default)]
    path: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SsbhParams {
    path: String,
    skeleton: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SsbhWriteParams {
    path: String,
    data: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReplaceParams {
    path: String,
    name: Option<String>,
    data: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddParams {
    path: String,
    name: String,
    format: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportParams {
    path: String,
    name: Option<String>,
    to: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ConvertParams {
    from: String,
    to: String,
    format: Option<String>,
    mipmaps: Option<String>,
    quality: Option<String>,
    gamma_fix: Option<bool>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyParams {
    key: String,
    value: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProgramParams {
    program: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InstallParams {
    program: String,
    #[serde(default)]
    stream: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TextParams {
    text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NotifyParams {
    title: String,
    #[serde(default)]
    body: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UrlParams {
    url: String,
}

fn invalid() -> Error {
    Error::new("invalid params")
}

fn object<T: serde::de::DeserializeOwned>(params: &Option<Value>) -> Result<T> {
    match params {
        Some(value) => serde_json::from_value(value.clone()).map_err(|_| invalid()),
        None => Err(invalid()),
    }
}

fn nothing(params: &Option<Value>) -> Result<()> {
    if params.is_none() {
        Ok(())
    } else {
        Err(invalid())
    }
}

fn plugin_path(path: &str, min: usize) -> Result<()> {
    check::plugin_path("path", path, min).map_err(|_| invalid())
}

type Run<'a> = Box<dyn FnOnce() -> Result<Value> + 'a>;
type Precheck<'a> = Box<dyn FnOnce() -> Result<()> + 'a>;

struct Prepared<'a> {
    permission: Permission,
    action: &'static str,
    target: String,
    precheck: Option<Precheck<'a>>,
    run: Run<'a>,
}

#[derive(Clone)]
struct Ctx {
    plugin_id: String,
    project_id: Option<String>,
}

pub struct PluginApi {
    pub plugins: Arc<PluginService>,
    pub audit: Arc<AuditLog>,
    pub secrets: Arc<SecretStore>,
    pub discord: Arc<DiscordPresence>,
    pub history: Option<Arc<HistoryService>>,
    pub projects: Arc<ProjectService>,
    pub host: Arc<dyn Host>,
    session_exec: Mutex<HashSet<String>>,
    session_open: Mutex<HashSet<String>>,
    last_notify: Mutex<HashMap<String, Instant>>,
}

fn to_value<T: serde::Serialize>(value: T) -> Result<Value> {
    Ok(serde_json::to_value(value)?)
}

impl PluginApi {
    pub fn new(
        plugins: Arc<PluginService>,
        audit: Arc<AuditLog>,
        secrets: Arc<SecretStore>,
        discord: Arc<DiscordPresence>,
        history: Option<Arc<HistoryService>>,
        projects: Arc<ProjectService>,
        host: Arc<dyn Host>,
    ) -> Self {
        PluginApi {
            plugins,
            audit,
            secrets,
            discord,
            history,
            projects,
            host,
            session_exec: Mutex::new(HashSet::new()),
            session_open: Mutex::new(HashSet::new()),
            last_notify: Mutex::new(HashMap::new()),
        }
    }

    pub fn revoke_session(&self, plugin_id: &str) {
        let prefix = format!("{plugin_id}@");
        self.session_exec.lock().unwrap().retain(|k| !k.starts_with(&prefix));
    }

    pub fn call(&self, request: PluginCall) -> Result<Value> {
        let ctx = Ctx { plugin_id: request.plugin_id.clone(), project_id: request.project_id.clone() };
        let prepared = self.prepare(&ctx, &request.method, &request.params).map_err(|error| {
            if error.0 == "invalid params" {
                Error::new(format!("invalid params ({})", request.method))
            } else {
                error
            }
        })?;
        let allowed = self.plugins.has_grant(&ctx.plugin_id, prepared.permission);
        if !allowed {
            self.audit.record(&ctx.plugin_id, prepared.action, &prepared.target, false);
            return Err(Error::new(format!("permission denied: {}", prepared.permission.as_str())));
        }
        if let Some(precheck) = prepared.precheck {
            if let Err(error) = precheck() {
                self.audit.record(&ctx.plugin_id, prepared.action, &prepared.target, false);
                return Err(error);
            }
        }
        self.audit.record(&ctx.plugin_id, prepared.action, &prepared.target, true);
        (prepared.run)()
    }

    fn output_sink(&self, ctx: &Ctx, stream: Option<String>) -> Option<OutputSink> {
        let stream = stream?;
        let host = self.host.clone();
        let plugin_id = ctx.plugin_id.clone();
        Some(Arc::new(move |kind: &'static str, text: &str| host.exec_output(&plugin_id, &stream, kind, text)))
    }

    fn trash(&self) -> Trash {
        let host = self.host.clone();
        Arc::new(move |path: &Path| host.trash(path))
    }

    fn scope_of(&self, ctx: &Ctx, scope: FsScope) -> Result<Scope> {
        if scope == FsScope::External {
            let folder = self.plugins.external_of(&ctx.plugin_id).ok_or_else(|| Error::new("no folder picked"))?;
            return Ok(Scope { root: PathBuf::from(folder), hidden: None, trash: Some(self.trash()) });
        }
        let project = ctx.project_id.as_ref().ok_or_else(|| Error::new("no project open"))?;
        let root = self.projects.root_of(project)?;
        if scope == FsScope::Project {
            return Ok(Scope { root, hidden: Some(TESSERA_DIR.into()), trash: Some(self.trash()) });
        }
        let private = root.join(TESSERA_DIR).join("plugins").join(&ctx.plugin_id);
        fs::create_dir_all(&private)?;
        Ok(Scope { root: private, hidden: None, trash: Some(self.trash()) })
    }

    fn open_arc(&self, ctx: &Ctx) -> Result<Arc<smash_arc::ArcFile>> {
        let folder = self.plugins.external_of(&ctx.plugin_id).ok_or_else(|| Error::new("no folder picked"))?;
        open_arc(Path::new(&folder), &self.plugins.cache_dir())
    }

    fn tracked(&self, ctx: &Ctx, scope: FsScope, kind: HistoryKind, target: String, rels: &[&str], run: impl FnOnce() -> Result<()>) -> Result<()> {
        let (Some(history), Some(project), FsScope::Project) = (&self.history, &ctx.project_id, scope) else { return run() };
        let Some(root) = self.scope_of(ctx, FsScope::Project).ok().and_then(|s| realpath(&s.root).ok()) else { return run() };
        let paths: Vec<PathBuf> = rels.iter().map(|rel| resolve(&root, rel)).collect();
        let safe = paths.iter().all(|path| match relative_parts(&root, path) {
            Some(parts) => !parts.is_empty() && parts[0] != TESSERA_DIR,
            None => false,
        });
        if !safe {
            return run();
        }
        let meta = Meta { kind, target, source: Some(self.plugins.name_of(&ctx.plugin_id)) };
        history.track(project, &self.projects.root_of(project)?, meta, &paths, run)
    }

    fn confirm_run(&self, plugin_id: &str, name: &str, key: String, command: &str) -> Result<()> {
        if self.session_exec.lock().unwrap().contains(&key) {
            return Ok(());
        }
        match self.host.confirm_exec(plugin_id, name, command) {
            Decision::Deny => {
                self.audit.record(plugin_id, "exec.confirm", "refused by user", false);
                Err(Error::new("refused by user"))
            }
            Decision::Session => {
                self.session_exec.lock().unwrap().insert(key);
                Ok(())
            }
            Decision::Once => Ok(()),
        }
    }

    fn prepare<'a>(&'a self, ctx: &'a Ctx, method: &str, params: &Option<Value>) -> Result<Prepared<'a>> {
        let prepared = |permission, action, target: String, run: Run<'a>| Ok(Prepared { permission, action, target, precheck: None, run });
        match method {
            "fs.list" | "fs.readText" | "fs.mkdir" | "fs.remove" | "fs.readBytes" | "shell.reveal" => {
                let p: PathParams = object(params)?;
                plugin_path(&p.path, 0)?;
                let scope = p.scope;
                let path = p.path;
                let target = if matches!(method, "fs.list" | "shell.reveal") && path.is_empty() { format!("{}:.", scope.as_str()) } else { format!("{}:{}", scope.as_str(), path) };
                match method {
                    "fs.list" => prepared(scope.read(), "files.list", target, Box::new(move || to_value(scoped_fs::scoped_list(&self.scope_of(ctx, scope)?, &path)?))),
                    "fs.readText" => prepared(scope.read(), "files.readText", target, Box::new(move || to_value(scoped_fs::scoped_read_text(&self.scope_of(ctx, scope)?, &path)?))),
                    "fs.readBytes" => prepared(
                        scope.read(),
                        "files.readBytes",
                        target,
                        Box::new(move || to_value(base64::engine::general_purpose::STANDARD.encode(scoped_fs::scoped_read_bytes(&self.scope_of(ctx, scope)?, &path)?))),
                    ),
                    "fs.mkdir" => prepared(scope.write(), "files.mkdir", target, Box::new(move || to_value(scoped_fs::scoped_mkdir(&self.scope_of(ctx, scope)?, &path)?))),
                    "fs.remove" => prepared(
                        scope.write(),
                        "files.remove",
                        target,
                        Box::new(move || {
                            self.tracked(ctx, scope, HistoryKind::FileRemove, path.clone(), &[&path], || scoped_fs::scoped_remove(&self.scope_of(ctx, scope)?, &path))?;
                            Ok(Value::Null)
                        }),
                    ),
                    _ => prepared(
                        Permission::OpenExternal,
                        "shell.reveal",
                        target,
                        Box::new(move || {
                            let rel = if path.is_empty() { "." } else { path.as_str() };
                            self.host.reveal(&scoped_fs::scoped_reveal(&self.scope_of(ctx, scope)?, rel)?);
                            Ok(Value::Null)
                        }),
                    ),
                }
            }
            "fs.writeText" => {
                let p: WriteParams = object(params)?;
                plugin_path(&p.path, 1)?;
                let target = format!("{}:{}", p.scope.as_str(), p.path);
                prepared(
                    p.scope.write(),
                    "files.writeText",
                    target,
                    Box::new(move || {
                        self.tracked(ctx, p.scope, HistoryKind::FileWrite, p.path.clone(), &[&p.path], || scoped_fs::scoped_write_text(&self.scope_of(ctx, p.scope)?, &p.path, &p.content))?;
                        Ok(Value::Null)
                    }),
                )
            }
            "fs.writeBytes" => {
                let p: BytesParams = object(params)?;
                plugin_path(&p.path, 1)?;
                check::base64("data", &p.data, (MAX_BINARY_BYTES as usize).div_ceil(3) * 4).map_err(|_| invalid())?;
                let target = format!("{}:{}", p.scope.as_str(), p.path);
                prepared(
                    p.scope.write(),
                    "files.writeBytes",
                    target,
                    Box::new(move || {
                        let data = base64::engine::general_purpose::STANDARD.decode(&p.data).map_err(|_| invalid())?;
                        self.tracked(ctx, p.scope, HistoryKind::FileWrite, p.path.clone(), &[&p.path], || scoped_fs::scoped_write_bytes(&self.scope_of(ctx, p.scope)?, &p.path, &data))?;
                        Ok(Value::Null)
                    }),
                )
            }
            "fs.rename" => {
                let p: RenameParams = object(params)?;
                plugin_path(&p.from, 1)?;
                plugin_path(&p.to, 1)?;
                let target = format!("{}:{} -> {}", p.scope.as_str(), p.from, p.to);
                prepared(
                    p.scope.write(),
                    "files.rename",
                    target,
                    Box::new(move || {
                        self.tracked(ctx, p.scope, HistoryKind::FileRename, format!("{} -> {}", p.from, p.to), &[&p.from, &p.to], || scoped_fs::scoped_rename(&self.scope_of(ctx, p.scope)?, &p.from, &p.to))?;
                        Ok(Value::Null)
                    }),
                )
            }
            "external.pick" => {
                nothing(params)?;
                prepared(
                    Permission::FsExternal,
                    "external.pick",
                    "-".into(),
                    Box::new(move || {
                        let Some(folder) = self.host.pick_external(&self.plugins.name_of(&ctx.plugin_id)) else { return Ok(json!(false)) };
                        let folder = folder.to_string_lossy().into_owned();
                        self.plugins.set_external(&ctx.plugin_id, Some(folder.clone()))?;
                        self.audit.record(&ctx.plugin_id, "external.set", &folder, true);
                        Ok(json!(true))
                    }),
                )
            }
            "external.info" => {
                nothing(params)?;
                prepared(
                    Permission::FsExternal,
                    "external.info",
                    "-".into(),
                    Box::new(move || {
                        let folder = self.plugins.external_of(&ctx.plugin_id);
                        let name = folder.as_ref().map(|f| f.split(['\\', '/']).rfind(|s| !s.is_empty()).map(str::to_string).unwrap_or_else(|| f.clone()));
                        Ok(json!({ "picked": folder.is_some(), "name": name }))
                    }),
                )
            }
            "export.deploy" => {
                nothing(params)?;
                prepared(
                    Permission::FsExternal,
                    "export.deploy",
                    "-".into(),
                    Box::new(move || {
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::FsProjectRead) {
                            return Err(Error::new("permission denied: fs.project.read"));
                        }
                        let project = ctx.project_id.as_ref().ok_or_else(|| Error::new("no project open"))?;
                        let root = self.projects.root_of(project)?;
                        let mods = self.scope_of(ctx, FsScope::External)?.root;
                        let target = deploy_project(&root, &mods)?;
                        Ok(json!(target.file_name().map(|n| n.to_string_lossy().into_owned())))
                    }),
                )
            }
            "textures.preview" => {
                let p: PreviewParams = object(params)?;
                plugin_path(&p.path, 1)?;
                if p.name.as_ref().is_some_and(|n| n.len() > 200) {
                    return Err(invalid());
                }
                let target = format!("project:{}", p.path);
                prepared(
                    Permission::FsProjectRead,
                    "textures.preview",
                    target,
                    Box::new(move || {
                        let bytes = scoped_fs::scoped_read_bytes(&self.scope_of(ctx, FsScope::Project)?, &p.path)?;
                        to_value(preview_texture(&bytes, &p.path, p.name.as_deref())?)
                    }),
                )
            }
            "textures.replace" => {
                let p: ReplaceParams = object(params)?;
                plugin_path(&p.path, 1)?;
                if p.name.as_ref().is_some_and(|n| n.len() > 200) {
                    return Err(invalid());
                }
                check::base64("data", &p.data, (MAX_BINARY_BYTES as usize).div_ceil(3) * 4).map_err(|_| invalid())?;
                let target = format!("project:{}", p.path);
                prepared(
                    Permission::FsProjectWrite,
                    "textures.replace",
                    target,
                    Box::new(move || {
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::FsProjectRead) {
                            return Err(Error::new("permission denied: fs.project.read"));
                        }
                        let image = base64::engine::general_purpose::STANDARD.decode(&p.data).map_err(|_| invalid())?;
                        let scope = self.scope_of(ctx, FsScope::Project)?;
                        let data = replace_texture(&scoped_fs::scoped_read_bytes(&scope, &p.path)?, p.name.as_deref(), &image)?;
                        self.tracked(ctx, FsScope::Project, HistoryKind::FileWrite, p.path.clone(), &[&p.path], || scoped_fs::scoped_write_bytes(&scope, &p.path, &data))?;
                        Ok(Value::Null)
                    }),
                )
            }
            "textures.add" => {
                let p: AddParams = object(params)?;
                plugin_path(&p.path, 1)?;
                if p.name.len() > 200 || p.format.len() > 40 {
                    return Err(invalid());
                }
                check::base64("data", &p.data, (MAX_BINARY_BYTES as usize).div_ceil(3) * 4).map_err(|_| invalid())?;
                let target = format!("project:{} + {}", p.path, p.name);
                prepared(
                    Permission::FsProjectWrite,
                    "textures.add",
                    target,
                    Box::new(move || {
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::FsProjectRead) {
                            return Err(Error::new("permission denied: fs.project.read"));
                        }
                        let image = base64::engine::general_purpose::STANDARD.decode(&p.data).map_err(|_| invalid())?;
                        let scope = self.scope_of(ctx, FsScope::Project)?;
                        let data = add_texture(&scoped_fs::scoped_read_bytes(&scope, &p.path)?, &p.name, &p.format, &image)?;
                        self.tracked(ctx, FsScope::Project, HistoryKind::FileWrite, p.path.clone(), &[&p.path], || scoped_fs::scoped_write_bytes(&scope, &p.path, &data))?;
                        Ok(Value::Null)
                    }),
                )
            }
            "textures.export" => {
                let p: ExportParams = object(params)?;
                plugin_path(&p.path, 1)?;
                plugin_path(&p.to, 1)?;
                if p.name.as_ref().is_some_and(|n| n.len() > 200) {
                    return Err(invalid());
                }
                let target = format!("project:{} -> {}", p.path, p.to);
                prepared(
                    Permission::FsProjectWrite,
                    "textures.export",
                    target,
                    Box::new(move || {
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::FsProjectRead) {
                            return Err(Error::new("permission denied: fs.project.read"));
                        }
                        let scope = self.scope_of(ctx, FsScope::Project)?;
                        let data = export_texture(&scoped_fs::scoped_read_bytes(&scope, &p.path)?, &p.path, p.name.as_deref())?;
                        self.tracked(ctx, FsScope::Project, HistoryKind::FileWrite, p.to.clone(), &[&p.to], || scoped_fs::scoped_write_bytes(&scope, &p.to, &data))?;
                        Ok(Value::Null)
                    }),
                )
            }
            "textures.convert" => {
                let p: ConvertParams = object(params)?;
                plugin_path(&p.from, 1)?;
                plugin_path(&p.to, 1)?;
                let mut options = Options::parse(p.format.as_deref(), p.mipmaps.as_deref(), p.quality.as_deref()).map_err(|_| invalid())?;
                options.gamma_fix = p.gamma_fix.unwrap_or(false);
                let target = format!("project:{} -> {}", p.from, p.to);
                prepared(
                    Permission::FsProjectWrite,
                    "textures.convert",
                    target,
                    Box::new(move || {
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::FsProjectRead) {
                            return Err(Error::new("permission denied: fs.project.read"));
                        }
                        let scope = self.scope_of(ctx, FsScope::Project)?;
                        let source = scoped_fs::scoped_read_bytes(&scope, &p.from)?;
                        let data = convert_texture(&source, &p.from, &p.to, scoped_fs::scoped_read_bytes(&scope, &p.to).ok().as_deref(), &options)?;
                        self.tracked(ctx, FsScope::Project, HistoryKind::FileWrite, p.to.clone(), &[&p.to], || scoped_fs::scoped_write_bytes(&scope, &p.to, &data))?;
                        Ok(Value::Null)
                    }),
                )
            }
            "ssbh.read" | "ssbh.meshes" => {
                let p: SsbhParams = object(params)?;
                plugin_path(&p.path, 1)?;
                if let Some(skeleton) = &p.skeleton {
                    plugin_path(skeleton, 1)?;
                }
                let meshes = method == "ssbh.meshes";
                if !meshes && p.skeleton.is_some() {
                    return Err(invalid());
                }
                let target = format!("project:{}", p.path);
                prepared(
                    Permission::FsProjectRead,
                    if meshes { "ssbh.meshes" } else { "ssbh.read" },
                    target,
                    Box::new(move || {
                        let scope = self.scope_of(ctx, FsScope::Project)?;
                        let bytes = scoped_fs::scoped_read_bytes(&scope, &p.path)?;
                        if !meshes {
                            return read_ssbh(&bytes, &p.path);
                        }
                        let skeleton = p.skeleton.as_ref().map(|s| scoped_fs::scoped_read_bytes(&scope, s)).transpose()?;
                        to_value(mesh_buffers(&bytes, skeleton.as_deref())?)
                    }),
                )
            }
            "ssbh.write" => {
                let p: SsbhWriteParams = object(params)?;
                plugin_path(&p.path, 1)?;
                let target = format!("project:{}", p.path);
                prepared(
                    Permission::FsProjectWrite,
                    "ssbh.write",
                    target,
                    Box::new(move || {
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::FsProjectRead) {
                            return Err(Error::new("permission denied: fs.project.read"));
                        }
                        let scope = self.scope_of(ctx, FsScope::Project)?;
                        let data = write_ssbh(p.data, &p.path)?;
                        self.tracked(ctx, FsScope::Project, HistoryKind::FileWrite, p.path.clone(), &[&p.path], || scoped_fs::scoped_write_bytes(&scope, &p.path, &data))?;
                        Ok(Value::Null)
                    }),
                )
            }
            "arc.pick" => {
                nothing(params)?;
                prepared(
                    Permission::FsExternal,
                    "arc.pick",
                    "-".into(),
                    Box::new(move || {
                        let Some(file) = self.host.pick_arc(&self.plugins.name_of(&ctx.plugin_id)) else { return Ok(json!(false)) };
                        let file = file.to_string_lossy().into_owned();
                        self.plugins.set_external(&ctx.plugin_id, Some(file.clone()))?;
                        self.audit.record(&ctx.plugin_id, "external.set", &file, true);
                        Ok(json!(true))
                    }),
                )
            }
            "arc.list" => {
                let p: ArcParams = object(params)?;
                let target = format!("arc:{}", p.path);
                prepared(Permission::FsExternal, "arc.list", target, Box::new(move || to_value(list_arc(&*self.open_arc(ctx)?, &p.path)?)))
            }
            "arc.search" => {
                let p: ArcParams = object(params)?;
                if p.path.chars().count() > 200 {
                    return Err(invalid());
                }
                let target = format!("arc?{}", p.path);
                prepared(Permission::FsExternal, "arc.search", target, Box::new(move || to_value(search_arc(&self.open_arc(ctx)?, &p.path))))
            }
            "arc.extract" => {
                let p: ArcParams = object(params)?;
                let target = format!("arc:{}", p.path);
                prepared(
                    Permission::FsProjectWrite,
                    "arc.extract",
                    target,
                    Box::new(move || {
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::FsExternal) {
                            return Err(Error::new("permission denied: fs.external"));
                        }
                        let arc = self.open_arc(ctx)?;
                        let scope = self.scope_of(ctx, FsScope::Project)?;
                        let mut paths = Vec::new();
                        walk_arc(&arc, &p.path, &mut paths);
                        let (mut written, mut skipped, mut failed) = (0, 0, 0);
                        for path in paths {
                            let rel = format!("extracted/{}", mod_path(&path));
                            if plugin_path(&rel, 1).is_err() || scope.root.join(&rel).exists() {
                                skipped += 1;
                                continue;
                            }
                            match read_arc(&arc, &path).and_then(|data| scoped_fs::write(&scope, &rel, &data)) {
                                Ok(()) => written += 1,
                                Err(_) => failed += 1,
                            }
                        }
                        Ok(json!({ "written": written, "skipped": skipped, "failed": failed }))
                    }),
                )
            }
            "net.fetch" => {
                let p = FetchParams::parse(params.clone().ok_or_else(invalid)?).map_err(|_| invalid())?;
                let target = format!("{} {}", p.method, p.url);
                let domains = self.plugins.manifest_of(&ctx.plugin_id).map(|m| m.network).unwrap_or_default();
                let check_domains = domains.clone();
                let url = p.url.clone();
                Ok(Prepared {
                    permission: Permission::Net,
                    action: "net.fetch",
                    target,
                    precheck: Some(Box::new(move || check_url(&check_domains, &url).map(|_| ()))),
                    run: Box::new(move || to_value(plugin_fetch(&domains, &p)?)),
                })
            }
            "secrets.get" | "secrets.delete" | "secrets.set" => {
                let p: KeyParams = object(params)?;
                check::matches("key", &check::SECRET_KEY, &p.key).map_err(|_| invalid())?;
                if (method == "secrets.set") != p.value.is_some() {
                    return Err(invalid());
                }
                let target = p.key.clone();
                match method {
                    "secrets.get" => prepared(Permission::Secrets, "secrets.get", target, Box::new(move || to_value(self.secrets.get(&ctx.plugin_id, &p.key)?))),
                    "secrets.delete" => prepared(Permission::Secrets, "secrets.delete", target, Box::new(move || to_value(self.secrets.delete(&ctx.plugin_id, &p.key)?))),
                    _ => prepared(Permission::Secrets, "secrets.set", target, Box::new(move || to_value(self.secrets.set(&ctx.plugin_id, &p.key, p.value.as_deref().unwrap_or_default())?))),
                }
            }
            "secrets.keys" => {
                nothing(params)?;
                prepared(Permission::Secrets, "secrets.keys", "-".into(), Box::new(move || to_value(self.secrets.keys(&ctx.plugin_id))))
            }
            "exec.run" => {
                let p = ExecParams::parse(params.clone().ok_or_else(invalid)?, false).map_err(|_| invalid())?;
                let joined = p.args.join(" ");
                let target = if joined.is_empty() { "-".to_string() } else { truncate(&joined, 300) };
                prepared(
                    Permission::Exec,
                    "exec.run",
                    target,
                    Box::new(move || {
                        let manifest = self.plugins.manifest_of(&ctx.plugin_id);
                        let root = self.plugins.root_of(&ctx.plugin_id);
                        let (Some(manifest), Some(root)) = (manifest, root) else { return Err(Error::new("no program declared")) };
                        let Some(exec) = manifest.exec.clone() else { return Err(Error::new("no program declared")) };
                        let project = ctx.project_id.as_ref().ok_or_else(|| Error::new("no project open"))?;
                        let file = resolve_program(&root, &exec)?;
                        let cwd = self.projects.root_of(project)?;
                        self.confirm_run(&ctx.plugin_id, &manifest.name, format!("{}@{}", ctx.plugin_id, exec.sha256), &command_line(&exec.program, &p.args))?;
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::Exec) {
                            return Err(Error::new("permission denied: exec"));
                        }
                        to_value(run_program(&file, &p.args, &cwd, p.timeout, self.output_sink(ctx, p.stream.clone()))?)
                    }),
                )
            }
            "exec.runSystem" => {
                let p = ExecParams::parse(params.clone().ok_or_else(invalid)?, true).map_err(|_| invalid())?;
                if let Some(path) = p.project_file.as_deref() { plugin_path(path, 1)?; }
                let program = p.program.clone().unwrap_or_default();
                let mut target_args = p.args.clone();
                if let Some(path) = &p.project_file { target_args.push(path.clone()); }
                let target = truncate(&format!("{} {}", program, target_args.join(" ")), 300);
                prepared(
                    Permission::ExecSystem,
                    "exec.runSystem",
                    target,
                    Box::new(move || {
                        let manifest = self.plugins.manifest_of(&ctx.plugin_id).filter(|m| m.system_programs.contains(&program)).ok_or_else(|| Error::new("program not declared"))?;
                        let picked = self.plugins.program_of(&ctx.plugin_id, &program).ok_or_else(|| Error::new("program not picked"))?;
                        let project = ctx.project_id.as_ref().ok_or_else(|| Error::new("no project open"))?;
                        let file = check_system_program(&picked)?;
                        let cwd = self.projects.root_of(project)?;
                        let mut args = p.args.clone();
                        if let Some(path) = p.project_file.as_deref() {
                            if !self.plugins.has_grant(&ctx.plugin_id, Permission::FsProjectRead) {
                                return Err(Error::new("permission denied: fs.project.read"));
                            }
                            let source = scoped_fs::scoped_reveal(&self.scope_of(ctx, FsScope::Project)?, path)?;
                            if !source.is_file() { return Err(Error::new("not a file")); }
                            args.push(source.to_string_lossy().into_owned());
                        }
                        let key = format!("{}@system:{}@{}", ctx.plugin_id, program, picked.sha256);
                        self.confirm_run(&ctx.plugin_id, &manifest.name, key, &command_line(&file.to_string_lossy(), &args))?;
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::ExecSystem) {
                            return Err(Error::new("permission denied: exec.system"));
                        }
                        if p.detach {
                            spawn_program(&file, &args)?;
                            return Ok(Value::Null);
                        }
                        to_value(run_program(&file, &args, &cwd, p.timeout, self.output_sink(ctx, p.stream.clone()))?)
                    }),
                )
            }
            "exec.pickSystem" => {
                let p: ProgramParams = object(params)?;
                check::matches("program", &check::PROGRAM_NAME, &p.program).map_err(|_| invalid())?;
                let target = p.program.clone();
                prepared(
                    Permission::ExecSystem,
                    "exec.pickSystem",
                    target,
                    Box::new(move || {
                        let manifest = self.plugins.manifest_of(&ctx.plugin_id).filter(|m| m.system_programs.contains(&p.program)).ok_or_else(|| Error::new("program not declared"))?;
                        let Some(file) = self.host.pick_program(&manifest.name, &p.program) else { return Ok(json!(false)) };
                        let described = describe_program(&file)?;
                        self.plugins.set_program(&ctx.plugin_id, &p.program, Some(described.clone()))?;
                        self.audit.record(&ctx.plugin_id, "program.set", &format!("{} = {}", p.program, described.path), true);
                        Ok(json!(true))
                    }),
                )
            }
            "exec.installSystem" => {
                let p: InstallParams = object(params)?;
                check::matches("program", &check::PROGRAM_NAME, &p.program).map_err(|_| invalid())?;
                if let Some(stream) = &p.stream { check::matches("stream", &check::PROGRAM_NAME, stream).map_err(|_| invalid())?; }
                let target = p.program.clone();
                prepared(
                    Permission::ExecInstall,
                    "exec.installSystem",
                    target,
                    Box::new(move || {
                        let manifest = self.plugins.manifest_of(&ctx.plugin_id).filter(|m| m.system_programs.contains(&p.program)).ok_or_else(|| Error::new("program not declared"))?;
                        let source = manifest.installs.get(&p.program).and_then(|systems| systems.get(std::env::consts::OS)).cloned().ok_or_else(|| Error::new("no download for this system"))?;
                        let key = format!("{}@install:{}@{}", ctx.plugin_id, p.program, source.sha256);
                        self.confirm_run(&ctx.plugin_id, &manifest.name, key, &format!("download {} → {}", source.url, source.file))?;
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::ExecInstall) {
                            return Err(Error::new("permission denied: exec.install"));
                        }
                        let sink = self.output_sink(ctx, p.stream.clone());
                        let progress = |done: u64, total: Option<u64>| {
                            if let Some(sink) = &sink { sink("stdout", &format!("{done}/{}\n", total.unwrap_or(0))); }
                        };
                        let file = install(&download(&source.url, progress)?, &source, &self.plugins.programs_dir(&ctx.plugin_id).join(&p.program))?;
                        let described = describe_program(&file)?;
                        self.plugins.set_program(&ctx.plugin_id, &p.program, Some(described.clone()))?;
                        self.audit.record(&ctx.plugin_id, "program.install", &format!("{} = {}", p.program, described.path), true);
                        Ok(json!(true))
                    }),
                )
            }
            "exec.systemInfo" => {
                nothing(params)?;
                prepared(
                    Permission::ExecSystem,
                    "exec.systemInfo",
                    "-".into(),
                    Box::new(move || {
                        let programs = self.plugins.manifest_of(&ctx.plugin_id).map(|m| m.system_programs).unwrap_or_default();
                        let info: serde_json::Map<String, Value> = programs.into_iter().map(|name| {
                            let picked = self.plugins.program_of(&ctx.plugin_id, &name).is_some();
                            (name, json!(picked))
                        }).collect();
                        Ok(Value::Object(info))
                    }),
                )
            }
            "discord.setActivity" => {
                let p = SetActivity::parse(params.clone().ok_or_else(invalid)?).map_err(|_| invalid())?;
                let target = match &p.activity {
                    None => "clear".to_string(),
                    Some(a) => {
                        let parts: Vec<&str> = [a.details.as_deref(), a.state.as_deref()].into_iter().flatten().filter(|s| !s.is_empty()).collect();
                        if parts.is_empty() {
                            "-".into()
                        } else {
                            parts.join(" · ")
                        }
                    }
                };
                prepared(
                    Permission::DiscordRpc,
                    "discord.setActivity",
                    target,
                    Box::new(move || {
                        let client = self.plugins.manifest_of(&ctx.plugin_id).and_then(|m| m.discord_client_id).ok_or_else(|| Error::new("no client id declared"))?;
                        self.discord.set(&ctx.plugin_id, &client, p.activity.as_ref())?;
                        Ok(Value::Null)
                    }),
                )
            }
            "clipboard.writeText" => {
                let p: TextParams = object(params)?;
                if check::len(&p.text) > 100_000 {
                    return Err(invalid());
                }
                let target = format!("{} chars", check::len(&p.text));
                prepared(
                    Permission::ClipboardWrite,
                    "clipboard.writeText",
                    target,
                    Box::new(move || {
                        self.host.write_clipboard(&p.text);
                        Ok(Value::Null)
                    }),
                )
            }
            "notify.show" => {
                let mut p: NotifyParams = object(params)?;
                check::trimmed("title", &mut p.title, 1, 64).map_err(|_| invalid())?;
                check::text("body", &p.body, 0, 256).map_err(|_| invalid())?;
                let target = p.title.clone();
                Ok(Prepared {
                    permission: Permission::NotifySystem,
                    action: "notify.show",
                    target,
                    precheck: Some(Box::new(move || {
                        let mut last = self.last_notify.lock().unwrap();
                        let now = Instant::now();
                        if last.get(&ctx.plugin_id).is_some_and(|t| now.duration_since(*t).as_millis() < NOTIFY_EVERY_MS) {
                            return Err(Error::new("rate limited"));
                        }
                        last.insert(ctx.plugin_id.clone(), now);
                        Ok(())
                    })),
                    run: Box::new(move || {
                        self.host.notify(&format!("{} · {}", self.plugins.name_of(&ctx.plugin_id), p.title), &p.body);
                        Ok(Value::Null)
                    }),
                })
            }
            "shell.openUrl" => {
                let p: UrlParams = object(params)?;
                let parsed = check::https_url("url", &p.url, 2000).map_err(|_| invalid())?;
                let target = p.url.clone();
                prepared(
                    Permission::OpenExternal,
                    "shell.openUrl",
                    target,
                    Box::new(move || {
                        let host = parsed.host_str().unwrap_or_default().to_string();
                        let key = format!("{}@{}", ctx.plugin_id, host);
                        if !self.session_open.lock().unwrap().contains(&key) {
                            match self.host.confirm_open(&ctx.plugin_id, &self.plugins.name_of(&ctx.plugin_id), &p.url) {
                                Decision::Deny => return Err(Error::new("refused by user")),
                                Decision::Session => {
                                    self.session_open.lock().unwrap().insert(key);
                                }
                                Decision::Once => {}
                            }
                        }
                        if !self.plugins.has_grant(&ctx.plugin_id, Permission::OpenExternal) {
                            return Err(Error::new("permission denied: open.external"));
                        }
                        self.host.open_url(&p.url)?;
                        Ok(Value::Null)
                    }),
                )
            }
            "projects.list" => {
                nothing(params)?;
                prepared(
                    Permission::ProjectsList,
                    "projects.list",
                    "-".into(),
                    Box::new(move || {
                        let home = self.projects.home();
                        let tag_name: HashMap<&str, &str> = home.tags.iter().map(|t| (t.id.as_str(), t.name.as_str())).collect();
                        let collection_name: HashMap<&str, &str> = home.collections.iter().map(|c| (c.id.as_str(), c.name.as_str())).collect();
                        let list: Vec<Value> = home
                            .projects
                            .iter()
                            .map(|p| {
                                json!({
                                    "name": p.name,
                                    "kind": p.kind,
                                    "status": p.status,
                                    "tags": p.tags.iter().filter_map(|id| tag_name.get(id.as_str())).collect::<Vec<_>>(),
                                    "collection": p.collection.as_ref().and_then(|c| collection_name.get(c.as_str())),
                                    "favorite": p.favorite,
                                    "updatedAt": p.updated_at,
                                    "missing": p.missing,
                                })
                            })
                            .collect();
                        Ok(Value::Array(list))
                    }),
                )
            }
            _ => Err(Error::new("unknown method")),
        }
    }
}

fn truncate(text: &str, max: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().take(max).collect();
    String::from_utf16_lossy(&units)
}
