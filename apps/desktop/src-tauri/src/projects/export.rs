use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;

use crate::backups::zip::{write_zip, ZipSource};
use crate::projects::files::{meta_file, project_file, MetaFile, ProjectFile, SOURCES_DIR};
use crate::projects::folder_name::folder_name;
use crate::schema::projects::ProjectKind;
use crate::util::time::mtime_ms;
use crate::util::{json, Error, Result};

pub const BUILD_DIR: &str = "build";
const DEPLOY_MARKER: &str = ".tessera-deploy";
static WORK_FILES: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(blend\d*|psd|kra|xcf|spp|aseprite)$").unwrap());

fn category(kind: ProjectKind) -> &'static str {
    match kind {
        ProjectKind::Skin => "Fighter",
        ProjectKind::Stage => "Stage",
        ProjectKind::Ui => "UI",
        ProjectKind::Audio => "Audio",
        ProjectKind::Effect => "Effects",
        ProjectKind::Other => "Misc",
    }
}

fn info_toml(name: &str, kind: ProjectKind) -> String {
    let quoted = serde_json::to_string(name).unwrap();
    format!("display_name = {quoted}\ncategory = \"{}\"\n", category(kind))
}

fn copy_tree(from: &Path, to: &Path, prefix: &str, files: &mut Vec<ZipSource>) -> Result<()> {
    fs::create_dir_all(to)?;
    for item in fs::read_dir(from)?.flatten() {
        let Ok(kind) = item.file_type() else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        let source = from.join(&name);
        let rel = format!("{prefix}/{name}");
        if kind.is_dir() {
            copy_tree(&source, &to.join(&name), &rel, files)?;
        } else if kind.is_file() && !WORK_FILES.is_match(&name) {
            let size = fs::copy(&source, to.join(&name))?;
            files.push(ZipSource { path: rel, size, mtime: fs::metadata(&source)?.modified().map(mtime_ms).unwrap_or(0.0) });
        }
    }
    Ok(())
}

pub fn export_project(root: &Path, zip: bool) -> Result<PathBuf> {
    let project = json::read(&project_file(root), ProjectFile::parse).ok_or_else(|| Error::new("missing"))?;
    let kind = json::read(&meta_file(root), MetaFile::parse).map_or(ProjectKind::Other, |m| m.kind);
    let sources = root.join(SOURCES_DIR);
    if !fs::metadata(&sources).is_ok_and(|m| m.is_dir()) {
        return Err(Error::new("the project has no sources folder"));
    }
    let name = folder_name(&project.name);
    let build = root.join(BUILD_DIR);
    let out = build.join(&name);
    match fs::remove_dir_all(&out) {
        Err(error) if error.kind() != ErrorKind::NotFound => return Err(error.into()),
        _ => {}
    }
    let mut files = vec![];
    copy_tree(&sources, &out, &name, &mut files)?;
    let info = info_toml(&project.name, kind);
    fs::write(out.join("info.toml"), &info)?;
    if !zip {
        return Ok(out);
    }
    files.push(ZipSource { path: format!("{name}/info.toml"), size: info.len() as u64, mtime: 0.0 });
    let archive = build.join(format!("{name}.zip"));
    let temp = build.join(format!("{name}.zip.tmp"));
    if let Err(error) = write_zip(&build, &files, &temp).and_then(|_| Ok(fs::rename(&temp, &archive)?)) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(archive)
}

pub fn deploy_project(root: &Path, mods: &Path) -> Result<PathBuf> {
    let built = export_project(root, false)?;
    let name = built.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or_else(|| Error::new("invalid build"))?;
    let target = mods.join(&name);
    if fs::symlink_metadata(&target).is_ok() {
        if !target.join(DEPLOY_MARKER).is_file() {
            return Err(Error::new(format!("{name} already exists in the mods folder and was not deployed by Tessera")));
        }
        fs::remove_dir_all(&target)?;
    }
    copy_tree(&built, &target, &name, &mut vec![])?;
    fs::write(target.join(DEPLOY_MARKER), "")?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backups::zip::read_zip_entries;

    fn project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir_all(root.join(".tessera")).unwrap();
        fs::create_dir_all(root.join("sources/fighter/mario/model/body/c00")).unwrap();
        fs::write(
            root.join(".tessera/project.json"),
            r#"{"formatVersion":1,"id":"00000000-0000-4000-8000-000000000001","name":"Mario \"Classic\"","game":"ssbu","createdAt":"2026-10-16T10:00:00.000Z"}"#,
        )
        .unwrap();
        fs::write(root.join(".tessera/meta.json"), r#"{"formatVersion":1,"kind":"skin","status":"draft","tags":[],"collection":null,"favorite":false,"updatedAt":"2026-10-16T10:00:00.000Z"}"#).unwrap();
        fs::write(root.join("sources/fighter/mario/model/body/c00/def_mario_001_col.nutexb"), "tex").unwrap();
        fs::write(root.join("sources/body.psd"), "work").unwrap();
        dir
    }

    #[test]
    fn builds_folder_with_info_toml() {
        let dir = project();
        fs::create_dir_all(dir.path().join("build/mario-classic")).unwrap();
        fs::write(dir.path().join("build/mario-classic/stale.txt"), "old").unwrap();
        let out = export_project(dir.path(), false).unwrap();
        assert_eq!(out, dir.path().join("build/mario-classic"));
        assert_eq!(fs::read_to_string(out.join("fighter/mario/model/body/c00/def_mario_001_col.nutexb")).unwrap(), "tex");
        assert_eq!(fs::read_to_string(out.join("info.toml")).unwrap(), "display_name = \"Mario \\\"Classic\\\"\"\ncategory = \"Fighter\"\n");
        assert!(!out.join("body.psd").exists());
        assert!(!out.join("stale.txt").exists());
    }

    #[test]
    fn builds_zip_with_mod_folder_at_root() {
        let dir = project();
        let archive = export_project(dir.path(), true).unwrap();
        assert_eq!(archive, dir.path().join("build/mario-classic.zip"));
        let mut paths: Vec<String> = read_zip_entries(&archive).unwrap().into_iter().map(|e| e.path).collect();
        paths.sort();
        assert_eq!(paths, vec!["mario-classic/fighter/mario/model/body/c00/def_mario_001_col.nutexb", "mario-classic/info.toml"]);
    }

    #[test]
    fn deploys_and_replaces_only_its_own_folder() {
        let dir = project();
        let mods = dir.path().join("sd/ultimate/mods");
        fs::create_dir_all(&mods).unwrap();
        let target = deploy_project(dir.path(), &mods).unwrap();
        assert_eq!(target, mods.join("mario-classic"));
        assert!(target.join("info.toml").is_file());
        fs::write(target.join("old.txt"), "old").unwrap();
        deploy_project(dir.path(), &mods).unwrap();
        assert!(!target.join("old.txt").exists());
        fs::remove_file(target.join(DEPLOY_MARKER)).unwrap();
        assert!(deploy_project(dir.path(), &mods).unwrap_err().0.contains("already exists"));
        assert!(target.join("info.toml").is_file());
    }

    #[test]
    fn refuses_project_without_sources() {
        let dir = project();
        fs::remove_dir_all(dir.path().join("sources")).unwrap();
        assert!(export_project(dir.path(), false).unwrap_err().0.contains("no sources"));
    }
}
