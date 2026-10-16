use serde::Serialize;
use wasm_bindgen::JsValue;

use crate::bridge::{run, to_js};
use crate::error::Result;

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub large_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub large_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub small_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub small_text: Option<String>,
}

pub async fn set_activity(activity: Option<&Activity>) -> Result<()> {
    let value = match activity {
        Some(activity) => to_js(activity)?,
        None => JsValue::NULL,
    };
    run(&["discord", "setActivity"], &[value]).await
}
