use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::schema::check::{self, fail};
use crate::schema::projects::{Collection, ProjectKind, ProjectStatus, Tag};
use crate::util::time::{is_iso, now_iso};
use crate::util::Result;

pub const TESSERA_DIR: &str = ".tessera";
pub const SOURCES_DIR: &str = "sources";
pub const COVER_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];
pub const MAX_COVER_BYTES: u64 = 10 * 1024 * 1024;

pub fn project_file(root: &Path) -> PathBuf {
    root.join(TESSERA_DIR).join("project.json")
}

pub fn meta_file(root: &Path) -> PathBuf {
    root.join(TESSERA_DIR).join("meta.json")
}

pub fn cover_file(root: &Path, ext: &str) -> PathBuf {
    root.join(TESSERA_DIR).join(format!("cover.{ext}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub format_version: u8,
    pub id: String,
    pub name: String,
    pub game: String,
    pub created_at: String,
}

impl ProjectFile {
    pub fn parse(value: Value) -> Result<Self> {
        let file: ProjectFile = serde_json::from_value(value)?;
        if file.format_version != 1 || file.game != "ssbu" || file.name.is_empty() || !is_iso(&file.created_at) {
            return fail("project", "invalid project file");
        }
        check::uuid("id", &file.id)?;
        Ok(file)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaFile {
    pub format_version: u8,
    pub kind: ProjectKind,
    pub status: ProjectStatus,
    pub tags: Vec<String>,
    pub collection: Option<String>,
    pub favorite: bool,
    pub updated_at: String,
}

impl MetaFile {
    pub fn parse(value: Value) -> Result<Self> {
        let meta: MetaFile = serde_json::from_value(value)?;
        if meta.format_version != 1 || !is_iso(&meta.updated_at) || !meta.tags.iter().all(|t| check::is_uuid(t)) || meta.collection.as_ref().is_some_and(|c| !check::is_uuid(c)) {
            return fail("meta", "invalid meta file");
        }
        Ok(meta)
    }

    pub fn default_meta() -> Self {
        MetaFile { format_version: 1, kind: ProjectKind::Other, status: ProjectStatus::Draft, tags: vec![], collection: None, favorite: false, updated_at: now_iso() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    pub last_opened: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub format_version: u8,
    pub projects: Vec<RegistryEntry>,
    pub tags: Vec<Tag>,
    pub collections: Vec<Collection>,
}

impl Registry {
    pub fn empty() -> Self {
        Registry { format_version: 1, projects: vec![], tags: vec![], collections: vec![] }
    }

    pub fn parse(value: Value) -> Result<Self> {
        let mut registry: Registry = serde_json::from_value(value)?;
        if registry.format_version != 1 {
            return fail("registry", "invalid version");
        }
        for entry in &registry.projects {
            check::uuid("id", &entry.id)?;
            if entry.path.is_empty() || entry.name.is_empty() || entry.last_opened.as_ref().is_some_and(|t| !is_iso(t)) {
                return fail("registry", "invalid entry");
            }
        }
        for tag in &mut registry.tags {
            tag.validate()?;
        }
        for collection in &mut registry.collections {
            collection.validate()?;
        }
        Ok(registry)
    }
}
