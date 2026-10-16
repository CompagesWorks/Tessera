use serde::Deserialize;

use crate::bridge::get;
use crate::error::Result;

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub kind: String,
    pub status: String,
}

pub async fn info() -> Result<ProjectInfo> {
    get(&["project", "info"], &[]).await
}
