use js_sys::Uint8Array;
use serde::Deserialize;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::JsValue;

use crate::bridge::{call, from_js, get, run, text};
use crate::error::Result;
use crate::events::{subscribe, Subscription};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
}

impl DirEntry {
    pub fn is_dir(&self) -> bool {
        self.kind == "dir"
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct FilesChanged {
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Project,
    Private,
    External,
}

impl Scope {
    fn path(&self, method: &'static str) -> Vec<&'static str> {
        match self {
            Scope::Project => vec!["files", method],
            Scope::Private => vec!["files", "private", method],
            Scope::External => vec!["external", method],
        }
    }

    pub async fn list(&self, path: &str) -> Result<Vec<DirEntry>> {
        get(&self.path("list"), &[text(path)]).await
    }

    pub async fn read_text(&self, path: &str) -> Result<String> {
        get(&self.path("readText"), &[text(path)]).await
    }

    pub async fn write_text(&self, path: &str, content: &str) -> Result<()> {
        run(&self.path("writeText"), &[text(path), text(content)]).await
    }

    pub async fn mkdir(&self, path: &str) -> Result<()> {
        run(&self.path("mkdir"), &[text(path)]).await
    }

    pub async fn remove(&self, path: &str) -> Result<()> {
        run(&self.path("remove"), &[text(path)]).await
    }

    pub async fn rename(&self, from: &str, to: &str) -> Result<()> {
        run(&self.path("rename"), &[text(from), text(to)]).await
    }

    pub async fn read_bytes(&self, path: &str) -> Result<Vec<u8>> {
        let value = call(&self.path("readBytes"), &[text(path)]).await?;
        Ok(Uint8Array::new(&value).to_vec())
    }

    pub async fn write_bytes(&self, path: &str, data: &[u8]) -> Result<()> {
        run(&self.path("writeBytes"), &[text(path), Uint8Array::from(data).into()]).await
    }
}

pub fn project() -> Scope {
    Scope::Project
}

pub fn private() -> Scope {
    Scope::Private
}

pub fn watch(mut listener: impl FnMut(FilesChanged) + 'static) -> Result<Subscription> {
    let closure = Closure::<dyn FnMut(JsValue)>::new(move |payload: JsValue| {
        if let Ok(value) = from_js::<FilesChanged>(payload) {
            listener(value);
        }
    });
    subscribe(&["files", "watch"], &[], closure)
}
