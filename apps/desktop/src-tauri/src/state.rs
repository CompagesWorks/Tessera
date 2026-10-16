use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::accounts::AccountService;
use crate::backups::service::BackupService;
use crate::events::emit;
use crate::host::TauriHost;
use crate::plugins::api::PluginApi;
use crate::plugins::audit::AuditLog;
use crate::plugins::discord::DiscordPresence;
use crate::plugins::plugin_settings::PluginSettingsStore;
use crate::plugins::secrets::{load_key, AesCipher, SecretStore};
use crate::plugins::service::PluginService;
use crate::plugins::watch::ProjectWatcher;
use crate::projects::history::HistoryService;
use crate::projects::service::ProjectService;
use crate::schema::requests::SafeReason;
use crate::schema::tools::Profile;
use crate::settings::SettingsStore;
use crate::startup::{StartupGuard, CRASHES_BEFORE_SAFE_MODE};

pub struct PendingPackage {
    pub token: String,
    pub staging: PathBuf,
    pub file: PathBuf,
}

pub struct AppState {
    pub app: AppHandle,
    pub user_data: PathBuf,
    pub webview_data: Option<PathBuf>,
    pub version: String,
    pub safe_reason: Option<SafeReason>,
    pub settings: Arc<SettingsStore>,
    pub projects: Arc<ProjectService>,
    pub history: Arc<HistoryService>,
    pub plugins: Arc<PluginService>,
    pub audit: Arc<AuditLog>,
    pub secrets: Arc<SecretStore>,
    pub plugin_settings: Arc<PluginSettingsStore>,
    pub watcher: Arc<ProjectWatcher>,
    pub discord: Arc<DiscordPresence>,
    pub api: Arc<PluginApi>,
    pub accounts: AccountService,
    pub backups: Arc<BackupService>,
    pub guard: StartupGuard,
    pub host: Arc<TauriHost>,
    pub pending_profile: Mutex<Option<(String, Profile)>>,
    pub pending_package: Mutex<Option<PendingPackage>>,
    pub packages_dir: PathBuf,
}

impl AppState {
    pub fn active_provider(&self) -> Option<String> {
        if self.safe_reason.is_some() {
            return None;
        }
        self.settings.current().ui_provider
    }
}

pub fn dev_profile(args: &[String]) -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    args.iter().find_map(|a| a.strip_prefix("--tessera-profile=")).map(PathBuf::from)
}

pub fn user_data_dir(app: &AppHandle, args: &[String]) -> PathBuf {
    dev_profile(args).unwrap_or_else(|| app.path().config_dir().unwrap_or_else(|_| std::env::temp_dir()).join("Tessera"))
}

pub fn build(app: &AppHandle, args: &[String], arg_safe_reason: Option<SafeReason>) -> Arc<AppState> {
    let user_data = user_data_dir(app, args);
    let _ = std::fs::create_dir_all(&user_data);
    let guard = StartupGuard::new(user_data.join("startup.json"));
    let failed_starts = guard.begin();
    let safe_reason = arg_safe_reason.or((failed_starts >= CRASHES_BEFORE_SAFE_MODE).then_some(SafeReason::Crash));

    let packages_dir = user_data.join("plugin-packages");
    let _ = std::fs::remove_dir_all(&packages_dir);

    let settings = SettingsStore::new(&user_data);
    settings.load();

    let documents = app.path().document_dir().unwrap_or_else(|_| user_data.clone());
    let location_settings = settings.clone();
    let projects = Arc::new(ProjectService::new(user_data.join("projects.json"), move || {
        location_settings.current().projects_folder.map(PathBuf::from).unwrap_or_else(|| documents.join("Tessera"))
    }));
    projects.load();

    let handle = app.clone();
    let history = Arc::new(HistoryService::new(move |project_id| emit(&handle, "history:changed", json!({ "projectId": project_id }))));

    let audit_pending = Arc::new(AtomicBool::new(false));
    let handle = app.clone();
    let audit = Arc::new(AuditLog::new(user_data.join("permissions.log"), move || {
        if audit_pending.swap(true, Ordering::SeqCst) {
            return;
        }
        let pending = audit_pending.clone();
        let handle = handle.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(400));
            pending.store(false, Ordering::SeqCst);
            emit(&handle, "audit:changed", serde_json::Value::Null);
        });
    }));
    audit.load();

    let handle = app.clone();
    let tamper_audit = audit.clone();
    let plugins = Arc::new(PluginService::new(user_data.join("plugins.json"), user_data.join("plugins"), move |id, reason| {
        tamper_audit.record(id, "integrity.failed", reason, false);
        emit(&handle, "plugins:tampered", json!({ "id": id, "reason": reason }));
    }));
    plugins.set_suspended(safe_reason.is_some());
    plugins.sync_builtin(&builtin_plugins_dir(app));
    plugins.load();

    let defs = plugins.clone();
    let handle = app.clone();
    let plugin_settings = Arc::new(PluginSettingsStore::new(
        user_data.join("plugin-settings.json"),
        move |id| defs.manifest_of(id).map(|m| m.contributes.settings),
        move |id, values| emit(&handle, "plugins:settings-changed", json!({ "id": id, "values": values })),
    ));
    plugin_settings.load();

    let secrets = Arc::new(SecretStore::new(user_data.join("secrets"), Arc::new(AesCipher::new(load_key(&user_data)))));

    let handle = app.clone();
    let watcher = Arc::new(ProjectWatcher::new(move |project_id, paths| emit(&handle, "plugin:files-changed", json!({ "projectId": project_id, "paths": paths }))));
    let discord = Arc::new(DiscordPresence::default());
    let host = Arc::new(TauriHost::new(app.clone(), settings.clone()));
    let api = Arc::new(PluginApi::new(plugins.clone(), audit.clone(), secrets.clone(), discord.clone(), Some(history.clone()), projects.clone(), host.clone()));

    let roots = projects.clone();
    let backup_settings = settings.clone();
    let handle = app.clone();
    let backups = Arc::new(BackupService::new(
        move |id| roots.root_of(id),
        move || backup_settings.current().backups,
        move |project_id| emit(&handle, "backups:changed", json!({ "projectId": project_id })),
    ));

    Arc::new(AppState {
        app: app.clone(),
        webview_data: dev_profile(args).map(|p| p.join("webview")),
        user_data,
        version: app.package_info().version.to_string(),
        safe_reason,
        settings,
        projects,
        history,
        plugins,
        audit,
        accounts: AccountService::new(secrets.clone()),
        secrets,
        plugin_settings,
        watcher,
        discord,
        api,
        backups,
        guard,
        host,
        pending_profile: Mutex::new(None),
        pending_package: Mutex::new(None),
        packages_dir,
    })
}

fn builtin_plugins_dir(app: &AppHandle) -> PathBuf {
    if cfg!(debug_assertions) {
        return Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugins");
    }
    app.path().resource_dir().unwrap_or_default().join("plugins")
}
