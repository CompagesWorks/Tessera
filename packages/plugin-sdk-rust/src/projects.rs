use serde::Deserialize;

use crate::bridge::get;
use crate::error::Result;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub name: String,
    pub kind: String,
    pub status: String,
    pub tags: Vec<String>,
    pub collection: Option<String>,
    pub favorite: bool,
    pub updated_at: String,
    pub missing: bool,
}

pub async fn list() -> Result<Vec<ProjectEntry>> {
    get(&["projects", "list"], &[]).await
}
