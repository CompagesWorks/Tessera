use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::util::collate::compare;
use crate::util::paths::{from_slash, relative_slash};
use crate::util::{Error, Result};

pub const MAX_PACKAGE_BYTES: u64 = 50 * 1024 * 1024;
pub const MAX_PACKAGE_FILES: usize = 2000;

#[derive(Debug, Clone)]
pub struct PackageFile {
    pub path: String,
    pub size: u64,
}

pub fn list_package(root: &Path) -> Result<Vec<PackageFile>> {
    let mut files = vec![];
    let mut total = 0u64;
    fn walk(dir: &Path, root: &Path, files: &mut Vec<PackageFile>, total: &mut u64) -> Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let full = dir.join(entry.file_name());
            let info = fs::symlink_metadata(&full)?;
            if info.file_type().is_symlink() {
                return Err(Error::new(format!("Links are not allowed: {}", relative_slash(root, &full).replace('/', std::path::MAIN_SEPARATOR_STR))));
            }
            if info.is_dir() {
                walk(&full, root, files, total)?;
                continue;
            }
            if !info.is_file() {
                continue;
            }
            *total += info.len();
            files.push(PackageFile { path: relative_slash(root, &full), size: info.len() });
            if files.len() > MAX_PACKAGE_FILES {
                return Err(Error::new(format!("Too many files (max {MAX_PACKAGE_FILES})")));
            }
            if *total > MAX_PACKAGE_BYTES {
                return Err(Error::new(format!("Plugin too large (max {} MB)", MAX_PACKAGE_BYTES / 1024 / 1024)));
            }
        }
        Ok(())
    }
    walk(root, root, &mut files, &mut total)?;
    files.sort_by(|a, b| compare(&a.path, &b.path));
    Ok(files)
}

pub fn hash_file(file: &Path) -> Result<String> {
    let mut hasher = Sha256::new();
    let mut reader = fs::File::open(file)?;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn copy_package(source: &Path, destination: &Path) -> Result<BTreeMap<String, String>> {
    let files = list_package(source)?;
    let mut staging = destination.as_os_str().to_owned();
    staging.push(".staging");
    let staging = std::path::PathBuf::from(staging);
    let _ = fs::remove_dir_all(&staging);
    let mut hashes = BTreeMap::new();
    for file in &files {
        let target = from_slash(&staging, &file.path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(from_slash(source, &file.path), &target)?;
        hashes.insert(file.path.clone(), hash_file(&target)?);
    }
    if files.is_empty() {
        fs::create_dir_all(&staging)?;
    }
    let _ = fs::remove_dir_all(destination);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&staging, destination)?;
    Ok(hashes)
}

pub fn verify_package(root: &Path, hashes: &BTreeMap<String, String>) -> Option<String> {
    let files = match list_package(root) {
        Ok(files) => files,
        Err(error) => return Some(error.0),
    };
    let actual: Vec<&String> = files.iter().map(|f| &f.path).collect();
    if let Some(extra) = actual.iter().find(|p| !hashes.contains_key(p.as_str())) {
        return Some(format!("Unexpected file: {extra}"));
    }
    if let Some(missing) = hashes.keys().find(|p| !actual.contains(p)) {
        return Some(format!("Missing file: {missing}"));
    }
    for (path, expected) in hashes {
        if hash_file(&from_slash(root, path)).ok().as_ref() != Some(expected) {
            return Some(format!("Modified file: {path}"));
        }
    }
    None
}
