use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};
use wasm_bindgen::JsValue;

use crate::bridge::{call_sync, from_js, run, text, to_js};
use crate::error::Result;
use crate::events::{on, Subscription};

pub fn get<T: DeserializeOwned>(key: &str) -> Option<T> {
    call_sync(&["settings", "get"], &[text(key)]).ok().filter(|v| !v.is_undefined()).and_then(|v| from_js(v).ok())
}

pub fn all() -> Map<String, Value> {
    call_sync(&["settings", "get"], &[]).ok().and_then(|v| from_js(v).ok()).unwrap_or_default()
}

pub async fn set<T: Serialize>(key: &str, value: &T) -> Result<()> {
    run(&["settings", "set"], &[text(key), to_js(value)?]).await
}

pub async fn reset(key: Option<&str>) -> Result<()> {
    run(&["settings", "reset"], &[key.map(text).unwrap_or(JsValue::UNDEFINED)]).await
}

pub fn on_change(listener: impl FnMut(Map<String, Value>) + 'static) -> Result<Subscription> {
    on("settings.changed", listener)
}
