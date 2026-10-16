use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::schema::plugins::MAX_TEXT_READ;
use crate::util::collate::compare_numeric;
use crate::util::paths::{inside_or_same, realpath, relative_parts, relative_slash, resolve};
use crate::util::{Error, Result};

use super::files::TESSERA_DIR;

pub const MAX_ENTRIES: usize = 2000;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    pub size: u64,
}

fn outside() -> Error {
    Error::new("outside project")
}

pub fn sort_entries(entries: &mut [DirEntry]) {
    entries.sort_by(|a, b| {
        if a.kind == b.kind {
            compare_numeric(&a.name, &b.name)
        } else if a.kind == "dir" {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
}

pub fn resolve_inside(project_root: &Path, path: &str) -> Result<PathBuf> {
    let root = realpath(project_root)?;
    let target = resolve(&root, path);
    if !inside_or_same(&root, &target) {
        return Err(outside());
    }
    let real = realpath(&target).map_err(|_| outside())?;
    if !inside_or_same(&root, &real) {
        return Err(outside());
    }
    Ok(real)
}

pub fn list_dir(project_root: &Path, path: &str) -> Result<Vec<DirEntry>> {
    let root = realpath(project_root)?;
    let real = resolve_inside(&root, path)?;
    let mut result = vec![];
    for entry in fs::read_dir(&real)?.flatten().take(MAX_ENTRIES) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(kind) = entry.file_type() else { continue };
        if name == TESSERA_DIR || kind.is_symlink() {
            continue;
        }
        if !kind.is_file() && !kind.is_dir() {
            continue;
        }
        let full = real.join(&name);
        let size = if kind.is_file() { fs::metadata(&full).map(|m| m.len()).unwrap_or(0) } else { 0 };
        result.push(DirEntry { name, path: relative_slash(&root, &full), kind: if kind.is_dir() { "dir" } else { "file" }, size });
    }
    sort_entries(&mut result);
    Ok(result)
}

pub fn read_text(project_root: &Path, path: &str) -> Result<String> {
    let root = realpath(project_root)?;
    let real = resolve_inside(&root, path)?;
    let parts = relative_parts(&root, &real).unwrap_or_default();
    if parts.is_empty() || parts[0] == TESSERA_DIR {
        return Err(outside());
    }
    let info = fs::metadata(&real)?;
    if !info.is_file() || info.len() > MAX_TEXT_READ {
        return Err(Error::new("file too large"));
    }
    Ok(String::from_utf8_lossy(&fs::read(&real)?).into_owned())
}

pub fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(path).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}
