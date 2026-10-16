use js_sys::Function;
use serde::de::DeserializeOwned;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::{JsCast, JsValue};

use crate::bridge::{call_sync, from_js, text};
use crate::error::Result;

pub struct Subscription {
    off: Option<Function>,
    _listener: Closure<dyn FnMut(JsValue)>,
}

impl Subscription {
    pub(crate) fn new(off: Option<Function>, listener: Closure<dyn FnMut(JsValue)>) -> Self {
        Subscription { off, _listener: listener }
    }

    pub fn keep(self) {
        std::mem::forget(self);
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Some(off) = self.off.take() {
            let _ = off.call0(&JsValue::NULL);
        }
    }
}

pub(crate) fn subscribe(path: &[&str], args: &[JsValue], listener: Closure<dyn FnMut(JsValue)>) -> Result<Subscription> {
    let mut all = args.to_vec();
    all.push(listener.as_ref().clone());
    let off = call_sync(path, &all)?.dyn_into::<Function>().ok();
    Ok(Subscription::new(off, listener))
}

pub fn on<T: DeserializeOwned + 'static>(event: &str, mut listener: impl FnMut(T) + 'static) -> Result<Subscription> {
    let closure = Closure::<dyn FnMut(JsValue)>::new(move |payload: JsValue| {
        if let Ok(value) = from_js::<T>(payload) {
            listener(value);
        }
    });
    subscribe(&["on"], &[text(event)], closure)
}
