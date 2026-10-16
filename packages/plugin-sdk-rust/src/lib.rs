mod bridge;
mod error;
mod events;

pub mod clipboard;
pub mod discord;
pub mod exec;
pub mod external;
pub mod files;
pub mod net;
pub mod notify;
pub mod project;
pub mod projects;
pub mod secrets;
pub mod settings;
pub mod shell;
pub mod ui;
pub mod widget;

pub use error::{Error, Result};
pub use events::{on, Subscription};
pub use serde_json::{json, Value};
pub use wasm_bindgen;
pub use wasm_bindgen_futures::spawn_local;

pub async fn ready() -> Result<()> {
    let promise = js_sys::Reflect::get(&bridge::sdk_object()?, &wasm_bindgen::JsValue::from_str("ready")).map_err(Error::from)?;
    if let Ok(promise) = wasm_bindgen::JsCast::dyn_into::<js_sys::Promise>(promise) {
        wasm_bindgen_futures::JsFuture::from(promise).await.map_err(Error::from)?;
    }
    Ok(())
}
