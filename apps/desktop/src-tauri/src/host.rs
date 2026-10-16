use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, MessageDialogButtons, MessageDialogKind, MessageDialogResult};
use tauri_plugin_notification::NotificationExt;

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

pub struct TauriHost {
    app: AppHandle,
    settings: Arc<SettingsStore>,
}

impl TauriHost {
    pub fn new(app: AppHandle, settings: Arc<SettingsStore>) -> Self {
        TauriHost { app, settings }
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

    fn ask(&self, title: &str, message: &str, detail: &str, deny: &str, once: &str, session: Option<&str>) -> Decision {
        #[cfg(windows)]
        if let Some(window) = self.window() {
            if let Ok(hwnd) = window.hwnd() {
                return task_dialog::ask(hwnd, title, message, detail, deny, once, session);
            }
        }
        let mut builder = self.app.dialog().message(format!("{message}\n\n{detail}")).title(title).kind(MessageDialogKind::Warning);
        if let Some(window) = self.window() {
            builder = builder.parent(&window);
        }
        let result = match session {
            Some(session) => builder.buttons(MessageDialogButtons::YesNoCancelCustom(once.into(), session.into(), deny.into())).blocking_show_with_result(),
            None => builder.buttons(MessageDialogButtons::OkCancelCustom(once.into(), deny.into())).blocking_show_with_result(),
        };
        match result {
            MessageDialogResult::Custom(label) if label == once => Decision::Once,
            MessageDialogResult::Custom(label) if session == Some(label.as_str()) => Decision::Session,
            MessageDialogResult::Yes | MessageDialogResult::Ok => Decision::Once,
            MessageDialogResult::No if session.is_some() => Decision::Session,
            _ => Decision::Deny,
        }
    }
}

impl Host for TauriHost {
    fn pick_external(&self, plugin_name: &str) -> Option<PathBuf> {
        let title = self.external_title(plugin_name);
        self.pick_folder(Some(&title), false)
    }

    fn pick_program(&self, plugin_name: &str, program: &str) -> Option<PathBuf> {
        let mut builder = self.files().set_title(self.t("programTitle", &[("name", plugin_name), ("program", program)]));
        if cfg!(windows) {
            builder = builder.add_filter("Programs", &["exe", "com"]);
        }
        builder.blocking_pick_file().and_then(|p| p.into_path().ok())
    }

    fn confirm_exec(&self, plugin_name: &str, command: &str) -> Decision {
        let session = (self.settings.current().exec_policy == ExecPolicy::Session).then(|| self.t("execSession", &[]));
        self.ask(
            &self.t("execTitle", &[]),
            &self.t("execMessage", &[("name", plugin_name)]),
            &self.t("execDetail", &[("command", command)]),
            &self.t("execDeny", &[]),
            &self.t("execOnce", &[]),
            session.as_deref(),
        )
    }

    fn confirm_open(&self, plugin_name: &str, url: &str) -> Decision {
        self.ask(
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
}

#[cfg(windows)]
mod task_dialog {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::Controls::{TaskDialogIndirect, TASKDIALOGCONFIG, TASKDIALOGCONFIG_0, TASKDIALOG_BUTTON, TDF_ALLOW_DIALOG_CANCELLATION, TDF_POSITION_RELATIVE_TO_WINDOW, TD_WARNING_ICON};

    use crate::plugins::api::Decision;

    const DENY: i32 = 100;
    const ONCE: i32 = 101;
    const SESSION: i32 = 102;

    pub fn ask(parent: HWND, title: &str, message: &str, detail: &str, deny: &str, once: &str, session: Option<&str>) -> Decision {
        let title = HSTRING::from(title);
        let message = HSTRING::from(message);
        let detail = HSTRING::from(detail);
        let labels = [HSTRING::from(deny), HSTRING::from(once), HSTRING::from(session.unwrap_or_default())];
        let mut buttons = vec![
            TASKDIALOG_BUTTON { nButtonID: DENY, pszButtonText: PCWSTR(labels[0].as_ptr()) },
            TASKDIALOG_BUTTON { nButtonID: ONCE, pszButtonText: PCWSTR(labels[1].as_ptr()) },
        ];
        if session.is_some() {
            buttons.push(TASKDIALOG_BUTTON { nButtonID: SESSION, pszButtonText: PCWSTR(labels[2].as_ptr()) });
        }
        let config = TASKDIALOGCONFIG {
            cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
            hwndParent: parent,
            dwFlags: TDF_ALLOW_DIALOG_CANCELLATION | TDF_POSITION_RELATIVE_TO_WINDOW,
            pszWindowTitle: PCWSTR(title.as_ptr()),
            pszMainInstruction: PCWSTR(message.as_ptr()),
            pszContent: PCWSTR(detail.as_ptr()),
            cButtons: buttons.len() as u32,
            pButtons: buttons.as_ptr(),
            nDefaultButton: DENY,
            Anonymous1: TASKDIALOGCONFIG_0 { pszMainIcon: TD_WARNING_ICON },
            ..Default::default()
        };
        let mut pressed = 0i32;
        let ok = unsafe { TaskDialogIndirect(&config, Some(&mut pressed), None, None) }.is_ok();
        match (ok, pressed) {
            (true, ONCE) => Decision::Once,
            (true, SESSION) => Decision::Session,
            _ => Decision::Deny,
        }
    }
}
