use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::json;

use super::api::{lookup, GbMod};
use super::archive::{copy_tree, extract_archive, find_mod_roots};
use super::download::{download, download_image};
use crate::projects::files::{SOURCES_DIR, TESSERA_DIR};
use crate::projects::service::ProjectService;
use crate::schema::check;
use crate::schema::projects::{CreateProject, ProjectKind, ProjectSummary};
use crate::util::time::now_iso;
use crate::util::{json, Error, Result};

pub const EXTRAS_DIR: &str = "extras";

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ImportRequest {
    pub mod_id: u64,
    pub file_id: u64,
    pub name: String,
    pub kind: ProjectKind,
    pub location: String,
    pub token: String,
}

impl ImportRequest {
    pub fn validate(&self) -> Result<()> {
        if !check::PROGRAM_NAME.is_match(&self.token) {
            return Err(Error::new("invalid request (token)"));
        }
        Ok(())
    }
}

struct WorkDir(PathBuf);

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn extra_name(base: &Path, root: &Path) -> String {
    let relative = root.strip_prefix(base).unwrap_or(root);
    let name = relative.iter().map(|part| part.to_string_lossy().into_owned()).collect::<Vec<_>>().join(" - ");
    if name.is_empty() { "mod".into() } else { name }
}

fn fill_project(gb: &GbMod, extracted: &Path, root: &Path) -> Result<()> {
    let roots = find_mod_roots(extracted);
    match roots.split_first() {
        Some((main, extras)) => {
            copy_tree(main, &root.join(SOURCES_DIR))?;
            for extra in extras {
                copy_tree(extra, &root.join(EXTRAS_DIR).join(extra_name(extracted, extra)))?;
            }
        }
        None => copy_tree(extracted, &root.join(SOURCES_DIR))?,
    }
    let record = json!({
        "formatVersion": 1,
        "id": gb.id,
        "url": gb.url,
        "name": gb.name,
        "author": gb.author,
        "category": gb.category,
        "credits": gb.credits,
        "license": gb.license,
        "remix": gb.remix,
        "importedAt": now_iso(),
        "extras": roots.len().saturating_sub(1),
    });
    json::write(&root.join(TESSERA_DIR).join("gamebanana.json"), &record)
}

pub fn import_mod(projects: &ProjectService, request: &ImportRequest, progress: impl Fn(&'static str, u64, u64)) -> Result<ProjectSummary> {
    let gb = lookup(request.mod_id)?;
    let file = gb.files.iter().find(|f| f.id == request.file_id).ok_or_else(|| Error::new("gamebanana: file not found on the mod page"))?;
    if !file.clean {
        return Err(Error::new("gamebanana: this file has not passed GameBanana's antivirus check"));
    }
    let work = WorkDir(std::env::temp_dir().join(format!("tessera-gamebanana-{}", uuid::Uuid::new_v4())));
    fs::create_dir_all(&work.0)?;
    let archive = work.0.join("archive");
    download(&file.url, &archive, file.size, Some(&file.md5), |received| progress("download", received, file.size))?;
    progress("extract", 0, 0);
    let extracted = work.0.join("extracted");
    extract_archive(&archive, &extracted)?;
    progress("copy", 0, 0);
    let mut project = projects.create(&CreateProject { name: request.name.clone(), kind: request.kind, location: request.location.clone() })?;
    let root = PathBuf::from(&project.path);
    if let Err(error) = fill_project(&gb, &extracted, &root) {
        let _ = projects.forget(&project.id);
        let _ = fs::remove_dir_all(&root);
        return Err(error);
    }
    if let Some(url) = gb.images.first() {
        let extension = url.rsplit('.').next().unwrap_or("jpg").to_lowercase();
        let cover = work.0.join(format!("cover.{extension}"));
        if download_image(url, &cover).is_ok() {
            project = projects.set_cover(&project.id, &cover).unwrap_or(project);
        }
    }
    Ok(project)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gamebanana::api::{GbLicense, GbMod};

    fn sample() -> GbMod {
        GbMod {
            id: 1,
            name: "Mod".into(),
            url: "https://gamebanana.com/mods/1".into(),
            author: "Me".into(),
            category: "Mario".into(),
            images: vec![],
            thumbnails: vec![],
            files: vec![],
            license: GbLicense::default(),
            remix: "ask",
            credits: vec![],
        }
    }

    #[test]
    fn copies_the_main_root_into_sources_and_keeps_options_aside() {
        let dir = tempfile::tempdir().unwrap();
        let extracted = dir.path().join("x");
        fs::create_dir_all(extracted.join("Main/fighter/mario")).unwrap();
        fs::write(extracted.join("Main/fighter/mario/a.nutexb"), "a").unwrap();
        fs::create_dir_all(extracted.join("Options/Voice/sound/bank")).unwrap();
        let root = dir.path().join("project");
        fs::create_dir_all(root.join(TESSERA_DIR)).unwrap();
        fill_project(&sample(), &extracted, &root).unwrap();
        assert!(root.join("sources/fighter/mario/a.nutexb").is_file());
        assert!(root.join("extras/Options - Voice/sound/bank").is_dir());
        let record: serde_json::Value = serde_json::from_str(&fs::read_to_string(root.join(".tessera/gamebanana.json")).unwrap()).unwrap();
        assert_eq!((record["remix"].as_str(), record["extras"].as_u64()), (Some("ask"), Some(1)));
    }
}

#[cfg(test)]
mod live {
    use super::*;

    #[test]
    #[ignore]
    fn downloads_and_extracts_a_real_mod() {
        let gb = lookup(728673).unwrap();
        let file = &gb.files[0];
        let dir = tempfile::tempdir().unwrap();
        let archive = dir.path().join("archive");
        download(&file.url, &archive, file.size, Some(&file.md5), |_| {}).unwrap();
        extract_archive(&archive, &dir.path().join("x")).unwrap();
        let roots = find_mod_roots(&dir.path().join("x"));
        eprintln!("ROOTS {:?}", roots.iter().map(|r| r.strip_prefix(dir.path()).unwrap().to_path_buf()).collect::<Vec<_>>());
        assert!(!roots.is_empty());
    }
}
