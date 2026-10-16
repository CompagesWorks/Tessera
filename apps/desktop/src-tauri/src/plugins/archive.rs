use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::backups::zip::{extract_zip, read_zip_entries};
use crate::schema::check;
use crate::schema::plugins::PluginManifest;
use crate::util::paths::from_slash;

use super::package::{hash_file, list_package, MAX_PACKAGE_BYTES, MAX_PACKAGE_FILES};
use super::service::{read_manifest, PluginError};

pub const PACKAGE_EXTENSION: &str = "tessera-plugin";
pub const PACKAGE_INDEX: &str = "tessera-package.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackageIndex {
    pub format_version: u8,
    pub id: String,
    pub version: String,
    pub files: BTreeMap<String, String>,
}

fn invalid(message: impl Into<String>) -> PluginError {
    PluginError::new("invalid-package", message)
}

pub fn unpack(file: &Path, staging: &Path) -> Result<PluginManifest, PluginError> {
    let info = fs::metadata(file).map_err(|_| invalid("Package not found"))?;
    if !info.is_file() || info.len() > MAX_PACKAGE_BYTES {
        return Err(invalid(format!("Package too large (max {} MB)", MAX_PACKAGE_BYTES / 1024 / 1024)));
    }
    let entries = read_zip_entries(file).map_err(|e| invalid(e.0))?;
    if entries.len() > MAX_PACKAGE_FILES + 1 {
        return Err(invalid(format!("Too many files (max {MAX_PACKAGE_FILES})")));
    }
    if entries.iter().map(|e| e.size).sum::<u64>() > MAX_PACKAGE_BYTES {
        return Err(invalid(format!("Plugin too large (max {} MB)", MAX_PACKAGE_BYTES / 1024 / 1024)));
    }
    if !entries.iter().any(|e| e.path == PACKAGE_INDEX) {
        return Err(invalid(format!("{PACKAGE_INDEX} missing: build the package with tessera-plugin pack")));
    }

    let _ = fs::remove_dir_all(staging);
    fs::create_dir_all(staging)?;
    extract_zip(file, staging).map_err(|e| invalid(e.0))?;

    let index_file = staging.join(PACKAGE_INDEX);
    let raw = fs::read_to_string(&index_file).map_err(|_| invalid(format!("{PACKAGE_INDEX} unreadable")))?;
    let index: PackageIndex = serde_json::from_str(&raw).map_err(|e| invalid(format!("{PACKAGE_INDEX}: {e}")))?;
    fs::remove_file(&index_file)?;
    if index.format_version != 1 {
        return Err(invalid(format!("Unsupported package format {}", index.format_version)));
    }
    if index.files.values().any(|hash| !check::SHA256.is_match(hash)) {
        return Err(invalid(format!("{PACKAGE_INDEX}: invalid hash")));
    }

    let files = list_package(staging).map_err(|e| invalid(e.0))?;
    if let Some(extra) = files.iter().find(|f| !index.files.contains_key(&f.path)) {
        return Err(invalid(format!("Unexpected file: {}", extra.path)));
    }
    if let Some(missing) = index.files.keys().find(|p| !files.iter().any(|f| &&f.path == p)) {
        return Err(invalid(format!("Missing file: {missing}")));
    }
    for (path, expected) in &index.files {
        if &hash_file(&from_slash(staging, path))? != expected {
            return Err(invalid(format!("Modified file: {path}")));
        }
    }

    let manifest = read_manifest(staging)?;
    if manifest.id != index.id || manifest.version != index.version {
        return Err(invalid(format!("{PACKAGE_INDEX} does not match manifest.json")));
    }
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use sha2::{Digest, Sha256};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    use super::*;

    const MANIFEST: &str = r#"{"id":"test.pack","name":"Pack","version":"1.2.0","author":"Me","engines":{"tessera":"^0.1.0"},"contributes":{"widgets":[{"id":"main","title":"Main","entry":"widget.html"}]}}"#;

    fn sha(data: &[u8]) -> String {
        hex::encode(Sha256::digest(data))
    }

    fn build(path: &Path, files: &[(&str, &[u8])], index: Option<String>) {
        let mut zip = ZipWriter::new(fs::File::create(path).unwrap());
        for (name, data) in files {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(data).unwrap();
        }
        let index = index.unwrap_or_else(|| {
            let hashes: BTreeMap<&str, String> = files.iter().map(|(n, d)| (*n, sha(d))).collect();
            serde_json::json!({ "formatVersion": 1, "id": "test.pack", "version": "1.2.0", "files": hashes }).to_string()
        });
        zip.start_file(PACKAGE_INDEX, SimpleFileOptions::default()).unwrap();
        zip.write_all(index.as_bytes()).unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn unpacks_a_valid_package() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("p.tessera-plugin");
        build(&file, &[("manifest.json", MANIFEST.as_bytes()), ("widget.html", b"<p>hi</p>"), ("pkg/a.wasm", b"\0asm")], None);
        let manifest = unpack(&file, &dir.path().join("staging")).unwrap();
        assert_eq!(manifest.id, "test.pack");
        assert!(!dir.path().join("staging").join(PACKAGE_INDEX).exists());
        assert!(dir.path().join("staging/pkg/a.wasm").exists());
    }

    #[test]
    fn refuses_modified_extra_or_unindexed_packages() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("p.tessera-plugin");
        let staging = dir.path().join("staging");
        let wrong = serde_json::json!({ "formatVersion": 1, "id": "test.pack", "version": "1.2.0", "files": { "manifest.json": sha(MANIFEST.as_bytes()), "widget.html": sha(b"other") } }).to_string();
        build(&file, &[("manifest.json", MANIFEST.as_bytes()), ("widget.html", b"<p>hi</p>")], Some(wrong));
        assert_eq!(unpack(&file, &staging).unwrap_err().message, "Modified file: widget.html");

        let partial = serde_json::json!({ "formatVersion": 1, "id": "test.pack", "version": "1.2.0", "files": { "manifest.json": sha(MANIFEST.as_bytes()) } }).to_string();
        build(&file, &[("manifest.json", MANIFEST.as_bytes()), ("widget.html", b"<p>hi</p>")], Some(partial));
        assert_eq!(unpack(&file, &staging).unwrap_err().message, "Unexpected file: widget.html");

        let other = serde_json::json!({ "formatVersion": 1, "id": "test.other", "version": "1.2.0", "files": { "manifest.json": sha(MANIFEST.as_bytes()), "widget.html": sha(b"<p>hi</p>") } }).to_string();
        build(&file, &[("manifest.json", MANIFEST.as_bytes()), ("widget.html", b"<p>hi</p>")], Some(other));
        assert!(unpack(&file, &staging).unwrap_err().message.contains("does not match"));

        let mut zip = ZipWriter::new(fs::File::create(&file).unwrap());
        zip.start_file("manifest.json", SimpleFileOptions::default()).unwrap();
        zip.write_all(MANIFEST.as_bytes()).unwrap();
        zip.finish().unwrap();
        assert!(unpack(&file, &staging).unwrap_err().message.contains("missing"));
    }

    #[test]
    fn refuses_escaping_entries() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("p.tessera-plugin");
        build(&file, &[("manifest.json", MANIFEST.as_bytes()), ("../evil.txt", b"x")], None);
        assert!(unpack(&file, &dir.path().join("staging")).unwrap_err().message.contains("unsafe path"));
        assert!(!dir.path().join("evil.txt").exists());
    }
}
