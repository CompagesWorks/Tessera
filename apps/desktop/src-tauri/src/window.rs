use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionResponse};
use tauri::window::Color;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::schema::plugins::PLUGIN_SCHEME;
use crate::schema::requests::SafeReason;
use crate::startup::restart_args;
use crate::state::AppState;

static TRUSTED: OnceLock<Vec<String>> = OnceLock::new();

pub fn init_trusted(app: &AppHandle) {
    let mut origins = vec!["http://tauri.localhost".to_string(), "https://tauri.localhost".to_string(), "tauri://localhost".to_string()];
    if cfg!(dev) {
        if let Some(dev) = &app.config().build.dev_url {
            origins.push(dev.origin().ascii_serialization());
        }
    }
    let _ = TRUSTED.set(origins);
}

fn origin_of(url: &Url) -> String {
    match url.scheme() {
        "http" | "https" => url.origin().ascii_serialization(),
        scheme => format!("{scheme}://{}", url.host_str().unwrap_or_default()),
    }
}

pub fn is_trusted(url: &Url) -> bool {
    TRUSTED.get().is_some_and(|origins| origins.contains(&origin_of(url)))
}

fn is_plugin_url(url: &Url) -> bool {
    url.scheme() == PLUGIN_SCHEME || (url.scheme() == "http" && url.host_str().is_some_and(|h| h.starts_with(&format!("{PLUGIN_SCHEME}.")) && h.ends_with(".localhost")))
}

fn allowed_navigation(url: &Url) -> bool {
    is_trusted(url) || is_plugin_url(url) || url.as_str() == "about:blank" || url.as_str() == "about:srcdoc"
}

pub fn apply_zoom(window: &WebviewWindow, scale: i64) {
    let _ = window.set_zoom(scale as f64 / 100.0);
}

pub fn create(app: &AppHandle, state: &AppState, data_dir: Option<PathBuf>) -> tauri::Result<WebviewWindow> {
    let zoom_state = state.settings.clone();
    let watcher = state.watcher.clone();
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Tessera")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .center()
        .decorations(false)
        .visible(false)
        .background_color(Color(0, 0, 0, 0))
        .shadow(false)
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .on_navigation(allowed_navigation)
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .on_permission_request(|_, _| PermissionResponse::Deny)
        .on_page_load(move |window, payload| match payload.event() {
            PageLoadEvent::Started => watcher.stop_all(),
            PageLoadEvent::Finished => {
                apply_zoom(&window, zoom_state.current().ui_scale);
                if !window.is_visible().unwrap_or(true) {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.transparent(true);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.decorations(true).shadow(true).title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    }
    if let Some(dir) = data_dir {
        builder = builder.data_directory(dir);
    }
    let window = builder.build()?;
    #[cfg(windows)]
    windows_hooks::install(app, &window);
    Ok(window)
}

pub fn restart(state: &AppState, safe: Option<SafeReason>) {
    let args: Vec<String> = std::env::args().skip(1).filter(|a| !a.starts_with("--tessera-wait-pid=")).collect();
    let mut next = restart_args(&args, safe);
    next.push(format!("--tessera-wait-pid={}", std::process::id()));
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::process::Command::new(exe).args(next).spawn();
    }
    state.app.exit(0);
}

pub fn wait_for_previous(args: &[String]) {
    let Some(pid) = args.iter().find_map(|a| a.strip_prefix("--tessera-wait-pid=")).and_then(|p| p.parse::<u32>().ok()) else { return };
    wait_pid(pid);
}

#[cfg(windows)]
fn wait_pid(pid: u32) {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    unsafe {
        if let Ok(handle) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
            WaitForSingleObject(handle, 10_000);
            let _ = CloseHandle(handle);
        }
    }
}

#[cfg(not(windows))]
fn wait_pid(pid: u32) {
    let alive = || std::process::Command::new("kill").args(["-0", &pid.to_string()]).stderr(std::process::Stdio::null()).status().is_ok_and(|s| s.success());
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while alive() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else { return 0 };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(kind) if kind.is_dir() => dir_size(&entry.path()),
            Ok(kind) if kind.is_file() => entry.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

fn webview_data_dir(app: &AppHandle) -> PathBuf {
    let state = app.state::<std::sync::Arc<AppState>>();
    match &state.webview_data {
        Some(dir) => dir.clone(),
        None => app.path().app_local_data_dir().unwrap_or_default(),
    }
}

#[cfg(windows)]
pub fn cache_size(app: &AppHandle) -> u64 {
    let base = webview_data_dir(app).join("EBWebView").join("Default");
    ["Cache", "Code Cache", "GPUCache"].iter().map(|name| dir_size(&base.join(name))).sum()
}

#[cfg(not(windows))]
pub fn cache_size(app: &AppHandle) -> u64 {
    dir_size(&webview_data_dir(app).join("cache")) + app.path().app_cache_dir().map(|dir| dir_size(&dir)).unwrap_or(0)
}

pub fn clear_cache(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = window.with_webview(move |webview| {
            windows_hooks::clear_disk_cache(&webview, tx);
        });
        let _ = rx.recv_timeout(std::time::Duration::from_secs(10));
    }
    #[cfg(not(windows))]
    {
        let _ = window.clear_all_browsing_data();
    }
}

#[cfg(windows)]
mod windows_hooks {
    use serde_json::json;
    use tauri::{AppHandle, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{AcceleratorKeyPressedEventHandler, ClearBrowsingDataCompletedHandler, NavigationStartingEventHandler, WebResourceRequestedEventHandler};
    use windows::core::{Interface, HSTRING, PWSTR};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};

    use crate::events::emit;

    fn take(text: PWSTR) -> String {
        if text.is_null() {
            return String::new();
        }
        let value = unsafe { text.to_string().unwrap_or_default() };
        unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(text.0 as _)) };
        value
    }

    fn down(key: VIRTUAL_KEY) -> bool {
        unsafe { (GetKeyState(key.0 as i32) as u16 & 0x8000) != 0 }
    }

    fn key_names(vk: u32, shift: bool) -> Option<(String, String)> {
        let named = |key: &str, code: &str| Some((key.to_string(), code.to_string()));
        match vk {
            0x41..=0x5A => {
                let letter = char::from_u32(vk).unwrap();
                let key = if shift { letter.to_string() } else { letter.to_ascii_lowercase().to_string() };
                Some((key, format!("Key{letter}")))
            }
            0x30..=0x39 => {
                let digit = char::from_u32(vk).unwrap();
                Some((digit.to_string(), format!("Digit{digit}")))
            }
            0x70..=0x87 => {
                let n = vk - 0x70 + 1;
                Some((format!("F{n}"), format!("F{n}")))
            }
            0x08 => named("Backspace", "Backspace"),
            0x09 => named("Tab", "Tab"),
            0x0D => named("Enter", "Enter"),
            0x1B => named("Escape", "Escape"),
            0x20 => named(" ", "Space"),
            0x21 => named("PageUp", "PageUp"),
            0x22 => named("PageDown", "PageDown"),
            0x23 => named("End", "End"),
            0x24 => named("Home", "Home"),
            0x25 => named("ArrowLeft", "ArrowLeft"),
            0x26 => named("ArrowUp", "ArrowUp"),
            0x27 => named("ArrowRight", "ArrowRight"),
            0x28 => named("ArrowDown", "ArrowDown"),
            0x2D => named("Insert", "Insert"),
            0x2E => named("Delete", "Delete"),
            0xBA => named(";", "Semicolon"),
            0xBB => named("=", "Equal"),
            0xBC => named(",", "Comma"),
            0xBD => named("-", "Minus"),
            0xBE => named(".", "Period"),
            0xBF => named("/", "Slash"),
            0xC0 => named("`", "Backquote"),
            0xDB => named("[", "BracketLeft"),
            0xDC => named("\\", "Backslash"),
            0xDD => named("]", "BracketRight"),
            0xDE => named("'", "Quote"),
            _ => None,
        }
    }

    fn plugin_frame(uri: &str) -> bool {
        uri == "about:blank" || uri == "about:srcdoc" || (uri.starts_with("http://tessera-plugin.") && url::Url::parse(uri).ok().and_then(|u| u.host_str().map(|h| h.ends_with(".localhost"))).unwrap_or(false))
    }

    fn blocked(uri: &str) -> bool {
        let Ok(url) = url::Url::parse(uri) else { return false };
        if !matches!(url.scheme(), "http" | "https" | "ws" | "wss") {
            return false;
        }
        let host = url.host_str().unwrap_or_default();
        !(host == "localhost" || host.ends_with(".localhost"))
    }

    pub fn clear_disk_cache(webview: &tauri::webview::PlatformWebview, done: std::sync::mpsc::Sender<()>) {
        let result = (|| -> windows::core::Result<()> {
            let core = unsafe { webview.controller().CoreWebView2()? };
            let profile = unsafe { core.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile2>()? };
            let finished = done.clone();
            let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |_| {
                let _ = finished.send(());
                Ok(())
            }));
            unsafe { profile.ClearBrowsingData(COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE, &handler) }
        })();
        if result.is_err() {
            let _ = done.send(());
        }
    }

    pub fn install(app: &AppHandle, window: &WebviewWindow) {
        let app = app.clone();
        let _ = window.with_webview(move |webview| {
            let controller = webview.controller();
            let environment = webview.environment();
            let Ok(core) = (unsafe { controller.CoreWebView2() }) else { return };

            if let Ok(settings) = unsafe { core.Settings() } {
                unsafe {
                    let _ = settings.SetIsStatusBarEnabled(false);
                    if !cfg!(debug_assertions) {
                        let _ = settings.SetAreDefaultContextMenusEnabled(false);
                    }
                    if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
                        if !cfg!(debug_assertions) {
                            let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
                        }
                    }
                    if let Ok(s4) = settings.cast::<ICoreWebView2Settings4>() {
                        let _ = s4.SetIsGeneralAutofillEnabled(false);
                        let _ = s4.SetIsPasswordAutosaveEnabled(false);
                    }
                    if let Ok(s5) = settings.cast::<ICoreWebView2Settings5>() {
                        let _ = s5.SetIsPinchZoomEnabled(false);
                    }
                    if let Ok(s6) = settings.cast::<ICoreWebView2Settings6>() {
                        let _ = s6.SetIsSwipeNavigationEnabled(false);
                    }
                }
            }

            let keys = app.clone();
            let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                let mut vk = 0u32;
                let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
                unsafe {
                    args.KeyEventKind(&mut kind)?;
                    args.VirtualKey(&mut vk)?;
                    args.PhysicalKeyStatus(&mut status)?;
                }
                if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN {
                    return Ok(());
                }
                if status.WasKeyDown.as_bool() {
                    return Ok(());
                }
                let ctrl = down(VK_CONTROL);
                let alt = down(VK_MENU);
                let shift = down(VK_SHIFT);
                let meta = down(VK_LWIN) || down(VK_RWIN);
                let Some((key, code)) = key_names(vk, shift) else { return Ok(()) };
                let function = (0x70..=0x87).contains(&vk);
                if !(ctrl || meta || alt || function) {
                    return Ok(());
                }
                emit(&keys, "keyboard:shortcut", json!({ "key": key, "code": code, "ctrlKey": ctrl, "metaKey": meta, "altKey": alt, "shiftKey": shift }));
                Ok(())
            }));
            let mut token = 0i64;
            unsafe {
                let _ = controller.add_AcceleratorKeyPressed(&handler, &mut token);
            }

            let frames = NavigationStartingEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut uri = PWSTR::null();
                unsafe { args.Uri(&mut uri)? };
                if !plugin_frame(&take(uri)) {
                    unsafe { args.SetCancel(true)? };
                }
                Ok(())
            }));
            unsafe {
                let _ = core.add_FrameNavigationStarting(&frames, &mut token);
            }

            let filter = HSTRING::from("*");
            unsafe {
                let _ = core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
            }
            let requests = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let request = unsafe { args.Request()? };
                let mut uri = PWSTR::null();
                unsafe { request.Uri(&mut uri)? };
                if blocked(&take(uri)) {
                    let response = unsafe { environment.CreateWebResourceResponse(None, 403, &HSTRING::from("Blocked"), &HSTRING::new())? };
                    unsafe { args.SetResponse(&response)? };
                }
                Ok(())
            }));
            unsafe {
                let _ = core.add_WebResourceRequested(&requests, &mut token);
            }
        });
    }
}
