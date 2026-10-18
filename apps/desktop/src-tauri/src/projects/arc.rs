use std::fs;
use std::io::copy;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use smash_arc::{ArcFile, ArcLookup, FileNode, Hash40, Region};

use crate::util::{Error, Result};

const HASHES_URL: &str = "https://github.com/ultimate-research/archive-hashes/raw/master/Hashes";
const REGION: Region = Region::UsEnglish;

static OPEN: Mutex<Option<(PathBuf, Arc<ArcFile>)>> = Mutex::new(None);
static LABELS: Mutex<bool> = Mutex::new(false);

#[derive(Serialize)]
pub struct ArcEntry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub size: Option<u64>,
}

fn label(hash: Hash40) -> String {
    hash.global_label().unwrap_or_else(|| format!("0x{:x}", hash.as_u64()))
}

fn file_label(arc: &ArcFile, hash: Hash40) -> String {
    hash.global_label()
        .or_else(|| {
            let meta = arc.get_file_metadata(hash, REGION).ok()?;
            Some(format!("{}{}", meta.parent_hash.global_label()?, meta.file_name_hash.global_label()?))
        })
        .unwrap_or_else(|| label(hash))
}

fn hash_of(path: &str) -> Hash40 {
    match path.strip_prefix("0x").and_then(|hex| u64::from_str_radix(hex, 16).ok()) {
        Some(value) => Hash40(value),
        None => Hash40::from(if path.is_empty() { "/" } else { path }),
    }
}

fn download_hashes(file: &Path) -> Result<()> {
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(300)).user_agent("Tessera").build().map_err(|e| Error::new(e.to_string()))?;
    let mut response = client.get(HASHES_URL).send().and_then(|r| r.error_for_status()).map_err(|e| Error::new(format!("hashes download failed: {e}")))?;
    fs::create_dir_all(file.parent().unwrap_or(file))?;
    let partial = file.with_extension("part");
    copy(&mut response, &mut fs::File::create(&partial)?)?;
    fs::rename(&partial, file)?;
    Ok(())
}

fn load_labels(cache: &Path) -> Result<()> {
    let mut loaded = LABELS.lock().unwrap();
    if *loaded {
        return Ok(());
    }
    let file = cache.join("arc-hashes.txt");
    if !file.is_file() {
        download_hashes(&file)?;
    }
    Hash40::set_global_labels_file(&file)?;
    *loaded = true;
    Ok(())
}

pub fn open_arc(folder: &Path, cache: &Path) -> Result<Arc<ArcFile>> {
    let file = folder.join("data.arc");
    let mut open = OPEN.lock().unwrap();
    if let Some((path, arc)) = open.as_ref() {
        if path == &file {
            return Ok(arc.clone());
        }
    }
    if !file.is_file() {
        return Err(Error::new("no data.arc"));
    }
    load_labels(cache)?;
    let arc = Arc::new(ArcFile::open(&file).map_err(|e| Error::new(format!("invalid data.arc: {e}")))?);
    *open = Some((file, arc.clone()));
    Ok(arc)
}

pub fn list_arc(arc: &ArcFile, path: &str) -> Result<Vec<ArcEntry>> {
    let nodes = arc.get_dir_listing(hash_of(path)).ok_or_else(|| Error::new("not a folder"))?;
    let mut entries: Vec<ArcEntry> = nodes
        .iter()
        .map(|node| match node {
            FileNode::Dir(hash) => {
                let path = label(*hash);
                ArcEntry { name: path.trim_end_matches('/').rsplit('/').next().unwrap_or_default().to_string(), path, dir: true, size: None }
            }
            FileNode::File(hash) => {
                let path = file_label(arc, *hash);
                let size = arc.get_file_metadata(*hash, REGION).ok().map(|m| m.decomp_size);
                ArcEntry { name: path.rsplit('/').next().unwrap_or_default().to_string(), path, dir: false, size }
            }
        })
        .collect();
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.cmp(&b.name)));
    Ok(entries)
}

pub fn mod_path(path: &str) -> String {
    path.replacen("stream:", "stream;", 1).trim_start_matches('/').to_string()
}

pub fn walk_arc(arc: &ArcFile, path: &str, found: &mut Vec<String>) {
    match arc.get_dir_listing(hash_of(path)) {
        Some(nodes) => {
            for node in nodes {
                match node {
                    FileNode::Dir(hash) => walk_arc(arc, &label(*hash), found),
                    FileNode::File(hash) => found.push(file_label(arc, *hash)),
                }
            }
        }
        None => found.push(path.to_string()),
    }
}

pub fn read_arc(arc: &ArcFile, path: &str) -> Result<Vec<u8>> {
    arc.get_file_contents(hash_of(path), REGION).map_err(|e| Error::new(format!("{path}: {e:?}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_arc_paths_to_mod_paths() {
        assert_eq!(mod_path("fighter/mario/model/body/c00/model.numdlb"), "fighter/mario/model/body/c00/model.numdlb");
        assert_eq!(mod_path("stream:/sound/bgm/bgm_a01.nus3audio"), "stream;/sound/bgm/bgm_a01.nus3audio");
        assert_eq!(hash_of("0x1f").as_u64(), 0x1f);
        assert_eq!(hash_of(""), Hash40::from("/"));
    }
}

