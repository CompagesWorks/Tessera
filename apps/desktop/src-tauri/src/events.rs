use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

pub fn emit<R: Runtime>(app: &AppHandle<R>, event: &str, payload: impl Serialize + Clone) {
    let _ = app.emit_to("main", &format!("tessera:{event}"), payload);
}
