pub mod accounts;
pub mod backups;
pub mod commands;
pub mod events;
pub mod gamebanana;
pub mod host;
pub mod plugins;
pub mod profile;
pub mod projects;
pub mod protocols;
pub mod schema;
pub mod settings;
pub mod startup;
pub mod state;
pub mod updates;
pub mod util;
pub mod window;

use tauri::Manager;

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    window::wait_for_previous(&args);
    let safe_reason = startup::safe_reason_from_args(&args);

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init());

    protocols::register(builder)
        .invoke_handler(tauri::generate_handler![commands::tessera_invoke])
        .setup(move |app| {
            let handle = app.handle().clone();
            window::init_trusted(&handle);
            let state = state::build(&handle, &args, safe_reason);
            app.manage(state.clone());
            let window = window::create(&handle, &state, state.webview_data.clone())?;
            let zoom_window = window.clone();
            let emitter = handle.clone();
            state.settings.on_change(move |settings| {
                window::apply_zoom(&zoom_window, settings.ui_scale);
                events::emit(&emitter, "settings:changed", settings.clone());
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri failed");
}
