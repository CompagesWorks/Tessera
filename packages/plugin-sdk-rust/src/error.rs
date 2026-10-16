use std::fmt;

use js_sys::Reflect;
use wasm_bindgen::JsValue;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(String);

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn new(message: impl Into<String>) -> Self {
        Error(message.into())
    }

    pub fn message(&self) -> &str {
        &self.0
    }

    pub fn is_permission_denied(&self) -> bool {
        self.0.starts_with("permission denied")
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

impl From<JsValue> for Error {
    fn from(value: JsValue) -> Self {
        if let Some(text) = value.as_string() {
            return Error(text);
        }
        let message = Reflect::get(&value, &JsValue::from_str("message")).ok().and_then(|m| m.as_string());
        Error(message.unwrap_or_else(|| format!("{value:?}")))
    }
}

impl From<Error> for JsValue {
    fn from(error: Error) -> Self {
        js_sys::Error::new(&error.0).into()
    }
}
