use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use serde_json::json;
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};
use tauri_plugin_notification::NotificationExt;

use crate::events::emit;
use crate::plugins::api::{Decision, Host};
use crate::schema::settings::{ExecPolicy, Language};
use crate::settings::SettingsStore;
use crate::util::{Error, Result};

fn text(language: Language, key: &str) -> &'static str {
    match (language, key) {
        (Language::Fr, "externalTitle") => "{name} : choisir le dossier auquel il aura accès",
        (Language::Fr, "execTitle") => "Exécuter un programme",
        (Language::Fr, "execMessage") => "« {name} » veut lancer ce programme :",
        (Language::Fr, "execDetail") => "{command}\n\nLe programme aura les mêmes droits que toi sur cet ordinateur. Ne l’autorise que si tu fais confiance à ce plugin.",
        (Language::Fr, "execOnce") => "Exécuter une fois",
        (Language::Fr, "execSession") => "Toujours pour cette session",
        (Language::Fr, "execDeny") => "Refuser",
        (Language::Fr, "arcTitle") => "{name} : choisir le data.arc",
        (Language::Fr, "programTitle") => "{name} : choisir le programme « {program} »",
        (Language::Fr, "openTitle") => "Ouvrir un lien",
        (Language::Fr, "openMessage") => "« {name} » veut ouvrir ce lien dans ton navigateur :",
        (Language::Fr, "openOnce") => "Ouvrir",
        (Language::Fr, "openSession") => "Toujours pour ce site (session)",
        (Language::En, "externalTitle") => "{name}: pick the folder it can access",
        (Language::En, "execTitle") => "Run a program",
        (Language::En, "execMessage") => "\"{name}\" wants to run this program:",
        (Language::En, "execDetail") => "{command}\n\nThe program gets the same rights as you on this computer. Only allow it if you trust this plugin.",
        (Language::En, "execOnce") => "Run once",
        (Language::En, "execSession") => "Always for this session",
        (Language::En, "execDeny") => "Deny",
        (Language::En, "arcTitle") => "{name}: pick the data.arc",
        (Language::En, "programTitle") => "{name}: pick the program \"{program}\"",
        (Language::En, "openTitle") => "Open a link",
        (Language::En, "openMessage") => "\"{name}\" wants to open this link in your browser:",
        (Language::En, "openOnce") => "Open",
        (Language::En, "openSession") => "Always for this site (session)",
        _ => "",
    }
}

fn format(template: &str, values: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (key, value) in values {
        out = out.replace(&format!("{{{key}}}"), value);
    }
    out
}

const CONFIRM_TIMEOUT: Duration = Duration::from_secs(120);

pub struct TauriHost {
    app: AppHandle,
    settings: Arc<SettingsStore>,
    next: AtomicU64,
    pending: Mutex<HashMap<u64, mpsc::Sender<Decision>>>,
}

impl TauriHost {
    pub fn new(app: AppHandle, settings: Arc<SettingsStore>) -> Self {
        TauriHost { app, settings, next: AtomicU64::new(0), pending: Mutex::new(HashMap::new()) }
    }

    fn t(&self, key: &str, values: &[(&str, &str)]) -> String {
        format(text(self.settings.current().language, key), values)
    }

    pub fn window(&self) -> Option<WebviewWindow> {
        self.app.get_webview_window("main")
    }

    pub fn files(&self) -> FileDialogBuilder<tauri::Wry> {
        let builder = self.app.dialog().file();
        match self.window() {
            Some(window) => builder.set_parent(&window),
            None => builder,
        }
    }

    pub fn pick_folder(&self, title: Option<&str>, create: bool) -> Option<PathBuf> {
        let mut builder = self.files().set_can_create_directories(create);
        if let Some(title) = title {
            builder = builder.set_title(title);
        }
        builder.blocking_pick_folder().and_then(|p| p.into_path().ok())
    }

    pub fn external_title(&self, name: &str) -> String {
        self.t("externalTitle", &[("name", name)])
    }

    pub fn answer(&self, id: u64, decision: Decision) {
        if let Some(sender) = self.pending.lock().unwrap().remove(&id) {
            let _ = sender.send(decision);
        }
    }

    fn ask(&self, plugin_id: &str, title: &str, message: &str, detail: &str, deny: &str, once: &str, session: Option<&str>) -> Decision {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, sender);
        emit(&self.app, "plugins:confirm", json!({
            "id": id, "pluginId": plugin_id, "title": title, "message": message, "detail": detail,
            "deny": deny, "once": once, "session": session,
        }));
        let decision = receiver.recv_timeout(CONFIRM_TIMEOUT).unwrap_or(Decision::Deny);
        self.pending.lock().unwrap().remove(&id);
        decision
    }
}

impl Host for TauriHost {
    fn pick_external(&self, plugin_name: &str) -> Option<PathBuf> {
        let title = self.external_title(plugin_name);
        self.pick_folder(Some(&title), false)
    }

    fn pick_arc(&self, plugin_name: &str) -> Option<PathBuf> {
        self.files().set_title(self.t("arcTitle", &[("name", plugin_name)])).add_filter("ARC", &["arc"]).blocking_pick_file().and_then(|p| p.into_path().ok())
    }

    fn pick_program(&self, plugin_name: &str, program: &str) -> Option<PathBuf> {
        let mut builder = self.files().set_title(self.t("programTitle", &[("name", plugin_name), ("program", program)]));
        if cfg!(windows) {
            builder = builder.add_filter("Programs", &["exe", "com"]);
        }
        builder.blocking_pick_file().and_then(|p| p.into_path().ok())
    }

    fn confirm_exec(&self, plugin_id: &str, plugin_name: &str, command: &str) -> Decision {
        let session = (self.settings.current().exec_policy == ExecPolicy::Session).then(|| self.t("execSession", &[]));
        self.ask(
            plugin_id,
            &self.t("execTitle", &[]),
            &self.t("execMessage", &[("name", plugin_name)]),
            &self.t("execDetail", &[("command", command)]),
            &self.t("execDeny", &[]),
            &self.t("execOnce", &[]),
            session.as_deref(),
        )
    }

    fn confirm_open(&self, plugin_id: &str, plugin_name: &str, url: &str) -> Decision {
        self.ask(
            plugin_id,
            &self.t("openTitle", &[]),
            &self.t("openMessage", &[("name", plugin_name)]),
            url,
            &self.t("execDeny", &[]),
            &self.t("openOnce", &[]),
            Some(&self.t("openSession", &[])),
        )
    }

    fn open_url(&self, url: &str) -> Result<()> {
        tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| Error::new(e.to_string()))
    }

    fn reveal(&self, path: &Path) {
        let _ = tauri_plugin_opener::reveal_item_in_dir(path);
    }

    fn trash(&self, path: &Path) -> Result<()> {
        trash::delete(path).map_err(|e| Error::new(e.to_string()))
    }

    fn write_clipboard(&self, text: &str) {
        let _ = self.app.clipboard().write_text(text);
    }

    fn notify(&self, title: &str, body: &str) {
        let _ = self.app.notification().builder().title(title).body(body).show();
    }

    fn exec_output(&self, plugin_id: &str, stream: &str, kind: &str, text: &str) {
        crate::events::emit(&self.app, "plugin:exec-output", serde_json::json!({ "pluginId": plugin_id, "stream": stream, "kind": kind, "text": text }));
    }
}
