use serde::{Deserialize, Serialize};

use super::check::{self, fail, matches};
use crate::util::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectKind {
    Skin,
    Stage,
    Ui,
    Audio,
    Effect,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    Draft,
    Wip,
    Done,
    Published,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

impl Tag {
    pub fn validate(&mut self) -> Result<()> {
        check::uuid("id", &self.id)?;
        check::trimmed("name", &mut self.name, 1, 32)?;
        matches("color", &check::COLOR, &self.color)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
}

impl Collection {
    pub fn validate(&mut self) -> Result<()> {
        check::uuid("id", &self.id)?;
        check::trimmed("name", &mut self.name, 1, 48)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: ProjectKind,
    pub status: ProjectStatus,
    pub tags: Vec<String>,
    pub collection: Option<String>,
    pub favorite: bool,
    pub cover: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_opened: Option<String>,
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeData {
    pub projects: Vec<ProjectSummary>,
    pub tags: Vec<Tag>,
    pub collections: Vec<Collection>,
    pub default_location: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateProject {
    pub name: String,
    pub kind: ProjectKind,
    pub location: String,
}

impl CreateProject {
    pub fn validate(&mut self) -> Result<()> {
        check::project_name("name", &mut self.name)?;
        check::text("location", &self.location, 1, usize::MAX)
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub kind: Option<ProjectKind>,
    pub status: Option<ProjectStatus>,
    pub tags: Option<Vec<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub collection: Option<Option<String>>,
    pub favorite: Option<bool>,
}

pub fn double_option<'de, D, T>(deserializer: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

impl ProjectPatch {
    pub fn validate(&mut self) -> Result<()> {
        if let Some(name) = &mut self.name {
            check::project_name("patch.name", name)?;
        }
        if let Some(tags) = &self.tags {
            if tags.len() > 32 {
                return fail("patch.tags", "too many tags");
            }
            for tag in tags {
                check::uuid("patch.tags", tag)?;
            }
        }
        if let Some(Some(collection)) = &self.collection {
            check::uuid("patch.collection", collection)?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpsertTag {
    pub id: Option<String>,
    pub name: String,
    pub color: String,
}

impl UpsertTag {
    pub fn validate(&mut self) -> Result<()> {
        if let Some(id) = &self.id {
            check::uuid("id", id)?;
        }
        check::trimmed("name", &mut self.name, 1, 32)?;
        matches("color", &check::COLOR, &self.color)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpsertCollection {
    pub id: Option<String>,
    pub name: String,
}

impl UpsertCollection {
    pub fn validate(&mut self) -> Result<()> {
        if let Some(id) = &self.id {
            check::uuid("id", id)?;
        }
        check::trimmed("name", &mut self.name, 1, 48)
    }
}
