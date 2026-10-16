use serde::Deserialize;

use crate::bridge::get;
use crate::error::Result;
use crate::files::Scope;

#[derive(Debug, Clone, Deserialize)]
pub struct ExternalInfo {
    pub picked: bool,
    pub name: Option<String>,
}

pub async fn pick() -> Result<bool> {
    get(&["external", "pick"], &[]).await
}

pub async fn info() -> Result<ExternalInfo> {
    get(&["external", "info"], &[]).await
}

pub fn folder() -> Scope {
    Scope::External
}
