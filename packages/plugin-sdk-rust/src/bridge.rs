use js_sys::{Array, Function, Promise, Reflect};
use serde::de::DeserializeOwned;
use serde::Serialize;
use wasm_bindgen::{JsCast, JsValue};
use wasm_bindgen_futures::JsFuture;

use crate::error::{Error, Result};

pub(crate) fn sdk_object() -> Result<JsValue> {
    let value = Reflect::get(&js_sys::global(), &JsValue::from_str("tessera")).map_err(Error::from)?;
    if value.is_undefined() {
        return Err(Error::new("the Tessera SDK is not loaded: add <script src=\"/__tessera/sdk.js\"></script> before your module"));
    }
    Ok(value)
}

fn resolve(path: &[&str]) -> Result<(JsValue, Function)> {
    let mut owner = sdk_object()?;
    let (last, parents) = path.split_last().expect("path");
    for name in parents {
        owner = Reflect::get(&owner, &JsValue::from_str(name)).map_err(Error::from)?;
    }
    let function = Reflect::get(&owner, &JsValue::from_str(last)).map_err(Error::from)?;
    let function = function.dyn_into::<Function>().map_err(|_| Error::new(format!("tessera.{} is not available", path.join("."))))?;
    Ok((owner, function))
}

pub(crate) fn call_sync(path: &[&str], args: &[JsValue]) -> Result<JsValue> {
    let (owner, function) = resolve(path)?;
    let list: Array = args.iter().collect();
    function.apply(&owner, &list).map_err(Error::from)
}

pub(crate) async fn call(path: &[&str], args: &[JsValue]) -> Result<JsValue> {
    let value = call_sync(path, args)?;
    match value.dyn_into::<Promise>() {
        Ok(promise) => JsFuture::from(promise).await.map_err(Error::from),
        Err(value) => Ok(value),
    }
}

pub(crate) fn to_js<T: Serialize + ?Sized>(value: &T) -> Result<JsValue> {
    value.serialize(&serde_wasm_bindgen::Serializer::json_compatible()).map_err(|e| Error::new(e.to_string()))
}

pub(crate) fn from_js<T: DeserializeOwned>(value: JsValue) -> Result<T> {
    serde_wasm_bindgen::from_value(value).map_err(|e| Error::new(e.to_string()))
}

pub(crate) fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

pub(crate) async fn get<T: DeserializeOwned>(path: &[&str], args: &[JsValue]) -> Result<T> {
    from_js(call(path, args).await?)
}

pub(crate) async fn run(path: &[&str], args: &[JsValue]) -> Result<()> {
    call(path, args).await.map(|_| ())
}
