use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::api::{Decision, Host, PluginApi};
use super::audit::AuditLog;
use super::discord::DiscordPresence;
use super::scoped_fs::{scoped_list, scoped_read_text, scoped_remove, scoped_rename, scoped_write_text, Scope};
use super::secrets::{AesCipher, SecretStore};
use super::service::{read_manifest, PluginService};
use crate::projects::service::ProjectService;
use crate::schema::plugins::{Permission, PluginMode};
use crate::schema::projects::{CreateProject, ProjectKind, ProjectPatch, ProjectStatus, UpsertTag};
use crate::schema::requests::PluginCall;
use crate::util::Result;

fn manifest(overrides: Value) -> Value {
    let mut base = json!({
        "id": "test.plugin",
        "name": "Test",
        "version": "1.0.0",
        "author": "Me",
        "engines": { "tessera": "^0.1.0" },
        "permissions": ["fs.project.read"],
        "contributes": { "widgets": [{ "id": "main", "title": "Main", "entry": "widget.html" }] }
    });
    for (key, value) in overrides.as_object().unwrap() {
        base[key] = value.clone();
    }
    base
}

struct Fixture {
    dir: tempfile::TempDir,
    plugin_dir: PathBuf,
    tampered: Arc<Mutex<Vec<String>>>,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let plugin_dir = dir.path().join("plugin");
        fs::create_dir(&plugin_dir).unwrap();
        fs::write(plugin_dir.join("widget.html"), "<p>hi</p>").unwrap();
        fs::write(dir.path().join("secret.txt"), "secret").unwrap();
        Fixture { dir, plugin_dir, tampered: Arc::new(Mutex::new(vec![])) }
    }

    fn write(&self, value: Value) {
        fs::write(self.plugin_dir.join("manifest.json"), serde_json::to_string(&value).unwrap()).unwrap();
    }

    fn service(&self) -> PluginService {
        let tampered = self.tampered.clone();
        PluginService::new(self.dir.path().join("plugins.json"), self.dir.path().join("installed"), move |id, reason| tampered.lock().unwrap().push(format!("{id}: {reason}")))
    }
}

#[test]
fn builtin_plugins_are_registered_and_cannot_be_removed() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    let builtin = f.dir.path().join("builtin");
    fs::create_dir(&builtin).unwrap();
    fs::rename(&f.plugin_dir, builtin.join("plugin")).unwrap();
    let service = f.service();
    service.sync_builtin(&builtin);
    service.load();
    let plugin = service.get("test.plugin").unwrap();
    assert_eq!((plugin.mode, plugin.integrity, plugin.enabled), (PluginMode::Builtin, "builtin", true));
    assert!(plugin.pending.is_empty());
    assert!(service.has_grant("test.plugin", Permission::FsProjectRead));
    assert_eq!(service.remove("test.plugin").unwrap_err().code, "builtin");
    service.set_grants("test.plugin", &[]).unwrap();
    fs::write(builtin.join("plugin/manifest.json"), serde_json::to_string(&manifest(json!({ "permissions": ["fs.project.read", "clipboard.write"] }))).unwrap()).unwrap();
    service.sync_builtin(&builtin);
    service.load();
    assert!(service.get("test.plugin").unwrap().pending.is_empty());
    assert!(service.has_grant("test.plugin", Permission::ClipboardWrite));
    assert!(!service.has_grant("test.plugin", Permission::FsProjectRead));
    service.set_enabled("test.plugin", false).unwrap();
    service.sync_builtin(&builtin);
    service.load();
    assert!(!service.get("test.plugin").unwrap().enabled);
    fs::write(f.dir.path().join("plugins.json"), "{ broken").unwrap();
    service.sync_builtin(&builtin);
    assert_eq!(fs::read_to_string(f.dir.path().join("plugins.json")).unwrap(), "{ broken");
}

#[test]
fn reads_valid_locales_only() {
    let f = Fixture::new();
    let locales = f.plugin_dir.join("locales");
    fs::create_dir_all(&locales).unwrap();
    fs::write(locales.join("fr.json"), r#"{ "convert": "Convertir", "widget.title": "Textures" }"#).unwrap();
    fs::write(locales.join("en.json"), r#"{ "bad key!": "x" }"#).unwrap();
    fs::write(locales.join("de.json"), "not json").unwrap();
    fs::write(locales.join("english.json"), r#"{ "a": "b" }"#).unwrap();
    let read = crate::schema::plugins::read_locales(&f.plugin_dir);
    assert_eq!(read.keys().collect::<Vec<_>>(), vec!["fr"]);
    assert_eq!(read["fr"]["convert"], "Convertir");
}

#[test]
fn builtin_plugins_have_valid_manifests() {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins");
    for item in fs::read_dir(folder).unwrap() {
        let path = item.unwrap().path();
        if let Err(error) = read_manifest(&path) {
            panic!("{}: {}", path.display(), error.message);
        }
    }
}

#[test]
fn reads_manifest_and_refuses_bad_ones() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    let result = read_manifest(&f.plugin_dir).unwrap();
    assert_eq!(result.contributes.widgets[0].icon, "puzzle");
    f.write(manifest(json!({ "id": "core.evil" })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "invalid-manifest");
    f.write(manifest(json!({ "permissions": ["exec"] })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "invalid-manifest");
    f.write(manifest(json!({ "contributes": { "widgets": [{ "id": "main", "title": "Main", "entry": "../secret.txt" }] } })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "invalid-manifest");
    f.write(manifest(json!({ "contributes": { "widgets": [{ "id": "main", "title": "Main", "entry": "missing.html" }] } })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "missing-entry");
    f.write(manifest(json!({ "contributes": { "widgets": [], "titlebar": [{ "id": "go", "title": "Go" }] } })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "invalid-manifest");
    f.write(manifest(json!({ "contributes": { "widgets": [], "host": "host.html", "titlebar": [{ "id": "go", "title": "Go" }] } })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "missing-entry");
    fs::write(f.plugin_dir.join("host.html"), "<p>host</p>").unwrap();
    assert_eq!(read_manifest(&f.plugin_dir).unwrap().contributes.titlebar[0].icon, "puzzle");
    f.write(manifest(json!({ "contributes": { "fileActions": [{ "id": "convert", "title": "Convert", "extensions": ["png"] }] } })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "invalid-manifest");
    f.write(manifest(json!({ "permissions": ["ui.menus"], "contributes": { "host": "host.html", "fileActions": [{ "id": "convert", "title": "Convert", "extensions": [".png"] }] } })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "invalid-manifest");
    f.write(manifest(json!({ "permissions": ["ui.menus"], "contributes": { "host": "host.html", "fileActions": [{ "id": "convert", "title": "Convert", "extensions": ["PNG", "nutexb"] }] } })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap().contributes.file_actions[0].extensions, vec!["png", "nutexb"]);
    f.write(manifest(json!({ "contributes": { "host": "host.html", "fileActions": [{ "id": "convert", "title": "Convert", "extensions": ["png"] }] } })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "invalid-manifest");
    f.write(manifest(json!({ "icon": "icon.png" })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "missing-icon");
    fs::write(f.plugin_dir.join("icon.png"), [137, 80, 78, 71]).unwrap();
    assert_eq!(read_manifest(&f.plugin_dir).unwrap().icon, "icon.png");
    f.write(manifest(json!({ "icon": "../icon.png" })));
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "invalid-manifest");
    fs::write(f.plugin_dir.join("manifest.json"), "{ nope").unwrap();
    assert_eq!(read_manifest(&f.plugin_dir).unwrap_err().code, "invalid-manifest");
}

#[test]
fn installs_a_copy_and_persists() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    let plugin = f.service().install(&f.plugin_dir, &[Permission::FsProjectRead], PluginMode::Installed).unwrap();
    assert_eq!(PathBuf::from(&plugin.path), f.dir.path().join("installed").join("test.plugin"));
    assert_eq!(plugin.integrity, "ok");
    assert_eq!(plugin.granted, vec![Permission::FsProjectRead]);
    let reloaded = f.service();
    reloaded.load();
    assert_eq!(reloaded.list().iter().map(|p| (p.manifest.id.clone(), p.integrity)).collect::<Vec<_>>(), vec![("test.plugin".to_string(), "ok")]);
}

#[test]
fn serves_the_installed_copy_not_the_source() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    let s = f.service();
    s.install(&f.plugin_dir, &[], PluginMode::Installed).unwrap();
    fs::write(f.plugin_dir.join("widget.html"), "<script>evil()</script>").unwrap();
    assert_eq!(fs::read_to_string(s.resolve_file("test.plugin", "widget.html").unwrap()).unwrap(), "<p>hi</p>");
}

#[test]
fn disables_modified_plugins() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    let s = f.service();
    let plugin = s.install(&f.plugin_dir, &[Permission::FsProjectRead], PluginMode::Installed).unwrap();
    let file = Path::new(&plugin.path).join("widget.html");
    fs::write(&file, "<p>hi</p><script>evil()</script>").unwrap();
    assert!(s.resolve_file("test.plugin", "widget.html").is_none());
    let current = s.get("test.plugin").unwrap();
    assert!(!current.enabled);
    assert_eq!(current.integrity, "tampered");
    assert!(!s.has_grant("test.plugin", Permission::FsProjectRead));
    assert_eq!(*f.tampered.lock().unwrap(), vec!["test.plugin: Modified file: widget.html".to_string()]);
    assert_eq!(s.set_enabled("test.plugin", true).unwrap_err().code, "tampered");
}

#[test]
fn locks_until_verified_and_detects_added_files() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    let plugin = f.service().install(&f.plugin_dir, &[Permission::FsProjectRead], PluginMode::Installed).unwrap();
    fs::write(Path::new(&plugin.path).join("extra.js"), "evil()").unwrap();
    let s = f.service();
    s.load();
    assert!(!s.has_grant("test.plugin", Permission::FsProjectRead));
    assert!(s.resolve_file("test.plugin", "widget.html").is_none());
    assert_eq!(s.verify("test.plugin").unwrap(), (false, Some("Unexpected file: extra.js".to_string())));
    let current = s.get("test.plugin").unwrap();
    assert!(!current.enabled);
    assert_eq!(current.integrity_error.as_deref(), Some("Unexpected file: extra.js"));
}

#[test]
fn unlocks_clean_plugin_once_verified() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    f.service().install(&f.plugin_dir, &[Permission::FsProjectRead], PluginMode::Installed).unwrap();
    let s = f.service();
    s.load();
    assert_eq!(s.verify("test.plugin").unwrap(), (true, None));
    assert!(s.has_grant("test.plugin", Permission::FsProjectRead));
    assert!(s.resolve_file("test.plugin", "widget.html").is_some());
}

#[cfg(windows)]
#[test]
fn refuses_packages_with_links() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    let status = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(f.plugin_dir.join("secret-link")).arg(f.dir.path()).output().unwrap();
    assert!(status.status.success());
    assert_eq!(f.service().install(&f.plugin_dir, &[], PluginMode::Installed).unwrap_err().code, "invalid-package");
}

#[test]
fn dev_plugins_ask_again_for_new_permissions() {
    let f = Fixture::new();
    f.write(manifest(json!({ "permissions": [] })));
    let s = f.service();
    let plugin = s.install(&f.plugin_dir, &[], PluginMode::Dev).unwrap();
    assert_eq!((plugin.mode, plugin.integrity), (PluginMode::Dev, "dev"));
    assert!(plugin.pending.is_empty());
    f.write(manifest(json!({})));
    s.load();
    let current = s.get("test.plugin").unwrap();
    assert_eq!((current.pending.clone(), current.granted.clone()), (vec![Permission::FsProjectRead], vec![]));
    assert!(!s.has_grant("test.plugin", Permission::FsProjectRead));
    s.set_grants("test.plugin", &[Permission::FsProjectRead]).unwrap();
    let current = s.get("test.plugin").unwrap();
    assert_eq!((current.pending, current.granted), (vec![], vec![Permission::FsProjectRead]));
}

#[test]
fn asks_again_when_domains_change() {
    let f = Fixture::new();
    f.write(manifest(json!({ "permissions": [{ "id": "net", "domains": ["a.example.com"] }] })));
    let s = f.service();
    s.install(&f.plugin_dir, &[Permission::Net], PluginMode::Dev).unwrap();
    assert!(s.has_grant("test.plugin", Permission::Net));
    f.write(manifest(json!({ "permissions": [{ "id": "net", "domains": ["a.example.com", "b.example.com"] }] })));
    s.load();
    s.verify("test.plugin").unwrap();
    assert_eq!(s.get("test.plugin").unwrap().pending, vec![Permission::Net]);
    assert!(!s.has_grant("test.plugin", Permission::Net));
    s.set_grants("test.plugin", &[Permission::Net]).unwrap();
    assert!(s.has_grant("test.plugin", Permission::Net));
}

#[test]
fn serves_inside_only_and_nothing_when_disabled() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    let s = f.service();
    s.install(&f.plugin_dir, &[], PluginMode::Dev).unwrap();
    assert_eq!(s.resolve_file("test.plugin", "widget.html").unwrap(), crate::util::paths::realpath(&f.plugin_dir.join("widget.html")).unwrap());
    assert!(s.resolve_file("test.plugin", "../secret.txt").is_none());
    assert!(s.resolve_file("other.plugin", "widget.html").is_none());
    s.set_enabled("test.plugin", false).unwrap();
    assert!(s.resolve_file("test.plugin", "widget.html").is_none());
}

#[test]
fn removes_installed_copy() {
    let f = Fixture::new();
    f.write(manifest(json!({})));
    let s = f.service();
    let plugin = s.install(&f.plugin_dir, &[Permission::FsProjectRead], PluginMode::Installed).unwrap();
    s.remove("test.plugin").unwrap();
    assert!(s.list().is_empty());
    assert!(!Path::new(&plugin.path).join("widget.html").exists());
    assert_eq!(fs::read_to_string(f.plugin_dir.join("widget.html")).unwrap(), "<p>hi</p>");
}

#[test]
fn audit_keeps_entries_per_plugin_across_reloads() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("permissions.log");
    let log = AuditLog::new(file.clone(), || {});
    log.record("a.b", "files.list", ".", true);
    log.record("c.d", "files.list", ".", false);
    log.record("a.b", "files.readText", "x.txt", false);
    let reloaded = AuditLog::new(file, || {});
    reloaded.load();
    assert_eq!(reloaded.for_plugin("a.b", 100).iter().map(|e| (e.action.clone(), e.allowed)).collect::<Vec<_>>(), vec![("files.readText".to_string(), false), ("files.list".to_string(), true)]);
}

#[test]
fn scoped_files_stay_in_scope_and_use_trash() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("project");
    fs::create_dir_all(root.join(".tessera")).unwrap();
    fs::write(root.join(".tessera/project.json"), "{}").unwrap();
    let trashed = Arc::new(Mutex::new(vec![]));
    let sink = trashed.clone();
    let scope = Scope { root: root.clone(), hidden: Some(".tessera".into()), trash: Some(Arc::new(move |p: &Path| -> Result<()> { sink.lock().unwrap().push(p.to_path_buf()); Ok(()) })) };
    scoped_write_text(&scope, "mods/a.txt", "hello").unwrap();
    scoped_rename(&scope, "mods/a.txt", "mods/b.txt").unwrap();
    assert_eq!(scoped_read_text(&scope, "mods/b.txt").unwrap(), "hello");
    scoped_remove(&scope, "mods/b.txt").unwrap();
    let real = crate::util::paths::realpath(&root).unwrap();
    assert_eq!(*trashed.lock().unwrap(), vec![real.join("mods").join("b.txt")]);
    assert_eq!(scoped_write_text(&scope, ".tessera/project.json", "x").unwrap_err().0, "outside scope");
    assert_eq!(scoped_list(&scope, "").unwrap().iter().map(|e| e.name.clone()).collect::<Vec<_>>(), vec!["mods"]);
}

#[test]
fn secrets_stay_apart() {
    let dir = tempfile::tempdir().unwrap();
    let store = SecretStore::new(dir.path().join("secrets"), Arc::new(AesCipher::new(Some([3u8; 32]))));
    store.set("a.one", "token", "abc").unwrap();
    store.set("b.two", "token", "xyz").unwrap();
    assert_eq!(store.get("a.one", "token").unwrap().as_deref(), Some("abc"));
    assert_eq!(store.get("b.two", "token").unwrap().as_deref(), Some("xyz"));
    store.delete("a.one", "token").unwrap();
    assert!(store.keys("a.one").is_empty());
    store.clear("b.two");
    assert_eq!(store.get("b.two", "token").unwrap(), None);
}

#[derive(Default)]
struct FakeHost {
    decision: Mutex<Option<Decision>>,
    asked: Mutex<Vec<String>>,
    effects: Mutex<Vec<String>>,
    picks: Mutex<std::collections::HashMap<String, PathBuf>>,
}

impl FakeHost {
    fn decision(&self) -> Decision {
        self.decision.lock().unwrap().unwrap_or(Decision::Deny)
    }
}

impl Host for FakeHost {
    fn pick_external(&self, _plugin_name: &str) -> Option<PathBuf> {
        None
    }
    fn pick_program(&self, _plugin_name: &str, program: &str) -> Option<PathBuf> {
        self.picks.lock().unwrap().get(program).cloned()
    }
    fn confirm_exec(&self, _plugin_id: &str, _plugin_name: &str, command: &str) -> Decision {
        self.asked.lock().unwrap().push(command.to_string());
        self.decision()
    }
    fn confirm_open(&self, _plugin_id: &str, _plugin_name: &str, url: &str) -> Decision {
        self.asked.lock().unwrap().push(url.to_string());
        self.decision()
    }
    fn open_url(&self, url: &str) -> Result<()> {
        self.effects.lock().unwrap().push(format!("open {url}"));
        Ok(())
    }
    fn reveal(&self, path: &Path) {
        self.effects.lock().unwrap().push(format!("reveal {}", path.display()));
    }
    fn trash(&self, path: &Path) -> Result<()> {
        Ok(fs::remove_file(path)?)
    }
    fn write_clipboard(&self, text: &str) {
        self.effects.lock().unwrap().push(format!("clip {text}"));
    }
    fn notify(&self, title: &str, body: &str) {
        self.effects.lock().unwrap().push(format!("notify {title} {body}"));
    }
    fn exec_output(&self, _plugin_id: &str, stream: &str, kind: &str, text: &str) {
        self.effects.lock().unwrap().push(format!("output {stream} {kind} {text}"));
    }
}

struct ApiFixture {
    dir: tempfile::TempDir,
    api: PluginApi,
    audit: Arc<AuditLog>,
    host: Arc<FakeHost>,
    project: PathBuf,
    project_id: String,
}

impl ApiFixture {
    fn new(permissions: Value, granted: &[Permission], decision: Decision) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let plugin_dir = dir.path().join("plugin");
        fs::create_dir_all(&plugin_dir).unwrap();
        fs::write(plugin_dir.join("widget.html"), "<p>hi</p>").unwrap();
        fs::write(plugin_dir.join("manifest.json"), serde_json::to_string(&manifest(json!({ "permissions": permissions }))).unwrap()).unwrap();
        let plugins = Arc::new(PluginService::new(dir.path().join("plugins.json"), dir.path().join("installed"), |_, _| {}));
        plugins.install(&plugin_dir, granted, PluginMode::Dev).unwrap();
        let location = dir.path().join("Projects");
        let projects = Arc::new(ProjectService::new(dir.path().join("projects.json"), move || location.clone()));
        let created = projects.create(&CreateProject { name: "Mario".into(), kind: ProjectKind::Skin, location: dir.path().join("Projects").to_string_lossy().into() }).unwrap();
        let tag = projects.upsert_tag(&UpsertTag { id: None, name: "Smash".into(), color: "#ff0000".into() }).unwrap();
        projects.update(&created.id, &ProjectPatch { tags: Some(vec![tag.id]), status: Some(ProjectStatus::Wip), favorite: Some(true), ..Default::default() }).unwrap();
        let audit = Arc::new(AuditLog::new(dir.path().join("permissions.log"), || {}));
        let host = Arc::new(FakeHost::default());
        *host.decision.lock().unwrap() = Some(decision);
        let secrets = Arc::new(SecretStore::new(dir.path().join("secrets"), Arc::new(AesCipher::new(Some([5u8; 32])))));
        let api = PluginApi::new(plugins, audit.clone(), secrets, Arc::new(DiscordPresence::default()), None, projects, host.clone());
        ApiFixture { project: PathBuf::from(&created.path), project_id: created.id, dir, api, audit, host }
    }

    fn call(&self, method: &str, params: Option<Value>) -> Result<Value> {
        self.api.call(PluginCall { plugin_id: "test.plugin".into(), project_id: Some(self.project_id.clone()), method: method.into(), params })
    }
}

fn err(result: Result<Value>) -> String {
    result.unwrap_err().0
}

#[test]
fn api_reads_and_writes_binary() {
    use base64::Engine;
    let f = ApiFixture::new(json!(["fs.project.read", "fs.project.write"]), &[Permission::FsProjectRead, Permission::FsProjectWrite], Decision::Deny);
    let bytes = vec![0u8, 1, 2, 255, 254];
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    f.call("fs.writeBytes", Some(json!({ "path": "tex/a.nutexb", "data": encoded }))).unwrap();
    assert_eq!(fs::read(f.project.join("tex/a.nutexb")).unwrap(), bytes);
    assert_eq!(f.call("fs.readBytes", Some(json!({ "path": "tex/a.nutexb" }))).unwrap(), json!(encoded));
    assert_eq!(err(f.call("fs.writeBytes", Some(json!({ "path": "x.bin", "data": "not base64!" })))), "invalid params (fs.writeBytes)");
}

#[test]
fn api_converts_textures_inside_the_project() {
    let f = ApiFixture::new(json!(["fs.project.read", "fs.project.write"]), &[Permission::FsProjectRead, Permission::FsProjectWrite], Decision::Deny);
    let mut png = std::io::Cursor::new(Vec::new());
    image::RgbaImage::from_pixel(8, 8, image::Rgba([200, 30, 30, 255])).write_to(&mut png, image::ImageFormat::Png).unwrap();
    fs::write(f.project.join("sources/col.png"), png.get_ref()).unwrap();
    f.call("textures.convert", Some(json!({ "from": "sources/col.png", "to": "sources/col.nutexb", "gammaFix": true }))).unwrap();
    f.call("textures.convert", Some(json!({ "from": "sources/col.nutexb", "to": "sources/back.png" }))).unwrap();
    assert_eq!(image::open(f.project.join("sources/back.png")).unwrap().width(), 8);
    assert_eq!(err(f.call("textures.convert", Some(json!({ "from": "sources/col.png", "to": ".tessera/x.nutexb" })))), "outside scope");
    let preview = f.call("textures.preview", Some(json!({ "path": "sources/col.nutexb" }))).unwrap();
    assert_eq!((preview["width"].clone(), preview["height"].clone()), (json!(8), json!(8)));
    assert!(preview["data"].as_str().unwrap().starts_with("iVBOR"));
    f.call("textures.export", Some(json!({ "path": "sources/col.nutexb", "to": "sources/exported.png" }))).unwrap();
    assert_eq!(image::open(f.project.join("sources/exported.png")).unwrap().width(), 8);
    let read_only = ApiFixture::new(json!(["fs.project.read", "fs.project.write"]), &[Permission::FsProjectRead], Decision::Deny);
    assert_eq!(err(read_only.call("textures.replace", Some(json!({ "path": "a.bntx", "data": "AA==" })))), "permission denied: fs.project.write");
    assert!(read_only.call("textures.preview", Some(json!({ "path": "../col.png" }))).is_err());
    assert_eq!(err(read_only.call("textures.convert", Some(json!({ "from": "a.png", "to": "a.nutexb" })))), "permission denied: fs.project.write");
}

#[test]
fn api_reads_ssbh_files_inside_the_project() {
    let f = ApiFixture::new(json!(["fs.project.read"]), &[Permission::FsProjectRead], Decision::Deny);
    let modl = ssbh_data::modl_data::ModlData {
        major_version: 1,
        minor_version: 0,
        model_name: "model".into(),
        skeleton_file_name: "model.nusktb".into(),
        material_file_names: vec![],
        animation_file_name: None,
        mesh_file_name: "model.numshb".into(),
        entries: vec![],
    };
    modl.write_to_file(f.project.join("sources/model.numdlb")).unwrap();
    assert_eq!(f.call("ssbh.read", Some(json!({ "path": "sources/model.numdlb" }))).unwrap()["mesh_file_name"], "model.numshb");
    assert!(f.call("ssbh.read", Some(json!({ "path": "sources/model.numdlb", "skeleton": "a.nusktb" }))).is_err());
    assert!(f.call("ssbh.meshes", Some(json!({ "path": "../model.numshb" }))).is_err());
    assert!(f.call("ssbh.meshes", Some(json!({ "path": "sources/model.numdlb" }))).is_err());
}

#[test]
fn api_system_programs() {
    let f = ApiFixture::new(json!([{ "id": "exec.system", "programs": ["git"] }]), &[Permission::ExecSystem], Decision::Deny);
    let program = f.dir.path().join(if cfg!(windows) { "git.exe" } else { "git" });
    fs::write(&program, "fake git").unwrap();
    assert_eq!(err(f.call("exec.runSystem", Some(json!({ "program": "git", "args": ["status"] })))), "program not picked");
    assert_eq!(err(f.call("exec.runSystem", Some(json!({ "program": "node", "args": [] })))), "program not declared");
    f.host.picks.lock().unwrap().insert("git".into(), program.clone());
    assert_eq!(f.call("exec.pickSystem", Some(json!({ "program": "git" }))).unwrap(), json!(true));
    assert_eq!(f.call("exec.systemInfo", None).unwrap(), json!({ "git": true }));
    assert_eq!(err(f.call("exec.runSystem", Some(json!({ "program": "git", "args": ["status"] })))), "refused by user");
    assert_eq!(f.host.asked.lock().unwrap().len(), 1);
    assert!(f.host.asked.lock().unwrap()[0].ends_with(" status"));
    fs::write(&program, "evil git").unwrap();
    assert!(err(f.call("exec.runSystem", Some(json!({ "program": "git", "args": ["status"] })))).starts_with("program changed"));
}

#[test]
fn api_system_program_project_file_stays_in_scope() {
    let f = ApiFixture::new(
        json!(["fs.project.read", { "id": "exec.system", "programs": ["editor"] }]),
        &[Permission::FsProjectRead, Permission::ExecSystem],
        Decision::Deny,
    );
    let program = f.dir.path().join(if cfg!(windows) { "editor.exe" } else { "editor" });
    let image = f.project.join("image.png");
    fs::write(&program, "fake editor").unwrap();
    fs::write(&image, "image").unwrap();
    f.host.picks.lock().unwrap().insert("editor".into(), program);
    f.call("exec.pickSystem", Some(json!({ "program": "editor" }))).unwrap();
    assert_eq!(err(f.call("exec.runSystem", Some(json!({ "program": "editor", "projectFile": "image.png", "detach": true })))), "refused by user");
    assert!(f.host.asked.lock().unwrap()[0].contains(&image.to_string_lossy().to_string()));
    assert!(err(f.call("exec.runSystem", Some(json!({ "program": "editor", "projectFile": "../outside.png" })))).starts_with("invalid params"));
    assert_eq!(err(f.call("exec.runSystem", Some(json!({ "program": "editor", "projectFile": ".tessera/secret" })))), "outside scope");
}

#[test]
fn api_asks_before_opening_links() {
    let f = ApiFixture::new(json!(["open.external"]), &[Permission::OpenExternal], Decision::Session);
    f.call("shell.openUrl", Some(json!({ "url": "https://gamebanana.com/mods/1" }))).unwrap();
    f.call("shell.openUrl", Some(json!({ "url": "https://gamebanana.com/mods/2" }))).unwrap();
    assert_eq!(err(f.call("shell.openUrl", Some(json!({ "url": "http://gamebanana.com/" })))), "invalid params (shell.openUrl)");
    assert_eq!(*f.host.asked.lock().unwrap(), vec!["https://gamebanana.com/mods/1".to_string()]);
    assert_eq!(*f.host.effects.lock().unwrap(), vec!["open https://gamebanana.com/mods/1".to_string(), "open https://gamebanana.com/mods/2".to_string()]);
}

#[test]
fn api_clipboard_notifications_and_projects() {
    let f = ApiFixture::new(json!(["clipboard.write", "notify.system", "projects.list"]), &[Permission::ClipboardWrite, Permission::NotifySystem, Permission::ProjectsList], Decision::Deny);
    f.call("clipboard.writeText", Some(json!({ "text": "hash" }))).unwrap();
    f.call("notify.show", Some(json!({ "title": "Export", "body": "done" }))).unwrap();
    assert_eq!(err(f.call("notify.show", Some(json!({ "title": "Again" })))), "rate limited");
    assert_eq!(*f.host.effects.lock().unwrap(), vec!["clip hash".to_string(), "notify Test · Export done".to_string()]);
    let projects = f.call("projects.list", None).unwrap();
    let first = &projects[0];
    assert_eq!(first["name"], "Mario");
    assert_eq!(first["tags"], json!(["Smash"]));
    assert_eq!(first["status"], "wip");
    assert!(first.get("path").is_none());
}

#[test]
fn api_discord_needs_grant() {
    let f = ApiFixture::new(json!([{ "id": "discord.rpc", "clientId": "123456789012345678" }]), &[], Decision::Deny);
    assert_eq!(err(f.call("discord.setActivity", Some(json!({ "activity": { "details": "Modding" } })))), "permission denied: discord.rpc");
}

#[test]
fn api_checks_permission_per_scope_and_logs() {
    let f = ApiFixture::new(json!(["fs.project.read", "fs.project.write"]), &[Permission::FsProjectRead], Decision::Deny);
    assert_eq!(err(f.call("fs.writeText", Some(json!({ "path": "a.txt", "content": "x" })))), "permission denied: fs.project.write");
    assert_eq!(err(f.call("fs.list", Some(json!({ "scope": "private", "path": "" })))), "permission denied: fs.project.write");
    let listed = f.call("fs.list", Some(json!({ "path": "" }))).unwrap();
    assert_eq!(listed.as_array().unwrap().iter().map(|e| e["name"].clone()).collect::<Vec<_>>(), vec![json!("sources")]);
    assert_eq!(err(f.call("fs.list", Some(json!({ "scope": "external", "path": "" })))), "permission denied: fs.external");
    assert_eq!(err(f.call("nope", None)), "unknown method");
    let log: Vec<(String, bool)> = f.audit.for_plugin("test.plugin", 100).into_iter().map(|e| (e.action, e.allowed)).collect();
    assert_eq!(log, vec![("files.list".to_string(), false), ("files.list".to_string(), true), ("files.list".to_string(), false), ("files.writeText".to_string(), false)]);
    assert!(!f.project.join("a.txt").exists());
}

#[test]
fn api_logs_undeclared_domain_as_denied() {
    let f = ApiFixture::new(json!([{ "id": "net", "domains": ["api.example.com"] }]), &[Permission::Net], Decision::Deny);
    assert_eq!(err(f.call("net.fetch", Some(json!({ "url": "https://evil.com/" })))), "domain not declared: evil.com");
    let log: Vec<(String, String, bool)> = f.audit.for_plugin("test.plugin", 100).into_iter().map(|e| (e.action, e.target, e.allowed)).collect();
    assert_eq!(log, vec![("net.fetch".to_string(), "GET https://evil.com/".to_string(), false)]);
}

#[test]
fn api_private_files() {
    let f = ApiFixture::new(json!(["fs.project.read", "fs.project.write"]), &[Permission::FsProjectRead, Permission::FsProjectWrite], Decision::Deny);
    f.call("fs.writeText", Some(json!({ "scope": "private", "path": "cache.json", "content": "{}" }))).unwrap();
    assert_eq!(fs::read_to_string(f.project.join(".tessera/plugins/test.plugin/cache.json")).unwrap(), "{}");
    assert_eq!(err(f.call("fs.readText", Some(json!({ "path": ".tessera/plugins/test.plugin/cache.json" })))), "outside scope");
}

#[test]
fn api_exec_checks_hash_and_asks() {
    let program = if cfg!(windows) { "tool.exe" } else { "tool" };
    let content = "not really a program";
    let sha = hex::encode(Sha256::digest(content.as_bytes()));
    let f = ApiFixture::new(json!([{ "id": "exec", "program": program, "sha256": sha }]), &[Permission::Exec], Decision::Deny);
    let file = f.dir.path().join("plugin").join(program);
    fs::write(&file, format!("{content}!")).unwrap();
    assert_eq!(err(f.call("exec.run", Some(json!({ "args": ["a"] })))), "program hash mismatch");
    fs::write(&file, content).unwrap();
    assert_eq!(err(f.call("exec.run", Some(json!({ "args": ["a b"] })))), "refused by user");
    assert_eq!(*f.host.asked.lock().unwrap(), vec![format!("{program} \"a b\"")]);
}
