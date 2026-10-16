use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use regex::Regex;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

use crate::util::paths::{from_slash, inside, normalize};
use crate::util::{Error, Result};

pub const MAX_ZIP_BYTES: u64 = 4 * 1024 * 1024 * 1024 - 1;
const MAX_ENTRIES: usize = 65_000;
static STORED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\.(png|jpe?g|webp|gif|zip|7z|rar|mp4|webm|mkv|ogg|mp3|opus|m4a)$").unwrap());

#[derive(Debug, Clone)]
pub struct ZipSource {
    pub path: String,
    pub size: u64,
    pub mtime: f64,
}

#[derive(Debug, Clone)]
pub struct ZipEntry {
    pub path: String,
    pub directory: bool,
    pub size: u64,
}

fn zip_error(message: impl Into<String>) -> Error {
    Error::new(message.into())
}

fn zip_time(mtime: f64) -> DateTime {
    let seconds = (mtime / 1000.0) as i64;
    chrono::DateTime::from_timestamp(seconds, 0)
        .map(|t| t.with_timezone(&chrono::Local).naive_local())
        .and_then(|t| {
            use chrono::{Datelike, Timelike};
            DateTime::from_date_and_time(t.year().clamp(1980, 2107) as u16, t.month() as u8, t.day() as u8, t.hour() as u8, t.minute() as u8, t.second() as u8).ok()
        })
        .unwrap_or_default()
}

pub fn write_zip(root: &Path, files: &[ZipSource], destination: &Path) -> Result<()> {
    if files.len() > MAX_ENTRIES {
        return Err(zip_error("too many files"));
    }
    if files.iter().map(|f| f.size).sum::<u64>() > MAX_ZIP_BYTES {
        return Err(zip_error("project too large for a backup (4 GB max)"));
    }
    let mut zip = ZipWriter::new(BufWriter::new(File::create(destination)?));
    for file in files {
        let method = if STORED.is_match(&file.path) { CompressionMethod::Stored } else { CompressionMethod::Deflated };
        let mut options = SimpleFileOptions::default().compression_method(method).last_modified_time(zip_time(file.mtime)).large_file(file.size > u32::MAX as u64);
        if method == CompressionMethod::Deflated {
            options = options.compression_level(Some(6));
        }
        zip.start_file(file.path.as_str(), options).map_err(|e| zip_error(e.to_string()))?;
        let mut source = File::open(from_slash(root, &file.path))?;
        io::copy(&mut source, &mut zip)?;
    }
    zip.finish().map_err(|e| zip_error(e.to_string()))?.flush()?;
    Ok(())
}

pub fn safe_entry_path(name: &str) -> Result<String> {
    let path = name.replace('\\', "/");
    let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    let drive = path.len() >= 2 && path.as_bytes()[0].is_ascii_alphabetic() && path.as_bytes()[1] == b':';
    if parts.is_empty() || path.starts_with('/') || drive || parts.iter().any(|p| *p == ".." || *p == ".") {
        return Err(zip_error(format!("unsafe path in archive: {name}")));
    }
    Ok(parts.join("/"))
}

pub fn read_zip_entries(file: &Path) -> Result<Vec<ZipEntry>> {
    let mut archive = ZipArchive::new(File::open(file)?).map_err(|_| zip_error("not a zip archive"))?;
    let mut entries = vec![];
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(|_| zip_error("corrupted archive"))?;
        let name = String::from_utf8_lossy(entry.name_raw()).into_owned();
        if !matches!(entry.compression(), CompressionMethod::Stored | CompressionMethod::Deflated) {
            return Err(zip_error(format!("unsupported compression in {name}")));
        }
        entries.push(ZipEntry { path: safe_entry_path(&name)?, directory: name.ends_with('/'), size: entry.size() });
    }
    Ok(entries)
}

pub fn extract_zip(file: &Path, destination: &Path) -> Result<usize> {
    let entries = read_zip_entries(file)?;
    let root = normalize(destination);
    let mut archive = ZipArchive::new(File::open(file)?).map_err(|_| zip_error("not a zip archive"))?;
    let mut count = 0;
    for (index, entry) in entries.iter().enumerate() {
        let target: PathBuf = normalize(&from_slash(&root, &entry.path));
        if !inside(&root, &target) {
            return Err(zip_error(format!("unsafe path in archive: {}", entry.path)));
        }
        if entry.directory {
            fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut item = archive.by_index(index).map_err(|_| zip_error("corrupted archive"))?;
        let declared = item.size();
        let mut out = BufWriter::new(File::create(&target)?);
        let mut limited = (&mut item).take(declared + 1);
        let written = io::copy(&mut limited, &mut out)?;
        if written > declared {
            return Err(zip_error("archive entry larger than declared"));
        }
        out.flush()?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_zip(path: &Path, files: &[(&str, &[u8], CompressionMethod)]) {
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        for (name, data, method) in files {
            zip.start_file(*name, SimpleFileOptions::default().compression_method(*method)).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn refuses_escaping_entries() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("evil.zip");
        make_zip(&file, &[("../escape.txt", b"x", CompressionMethod::Stored)]);
        assert!(extract_zip(&file, &dir.path().join("out")).unwrap_err().0.contains("unsafe path"));
        make_zip(&file, &[("C:/escape.txt", b"x", CompressionMethod::Stored)]);
        assert!(extract_zip(&file, &dir.path().join("out")).unwrap_err().0.contains("unsafe path"));
    }

    #[test]
    fn reads_other_archives() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("other.zip");
        let text = "deflated ".repeat(100);
        make_zip(&file, &[("a/b.txt", text.as_bytes(), CompressionMethod::Deflated), ("c.txt", b"stored", CompressionMethod::Stored)]);
        extract_zip(&file, &dir.path().join("out")).unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("out/a/b.txt")).unwrap(), text);
        assert_eq!(fs::read_to_string(dir.path().join("out/c.txt")).unwrap(), "stored");
    }
}
