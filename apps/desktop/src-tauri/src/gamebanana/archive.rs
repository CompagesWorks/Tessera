use std::fs::{self, File};
use std::io::{self, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use crate::backups::zip::{extract_zip, safe_entry_path};
use crate::util::paths::{inside, inside_or_same, normalize, realpath};
use crate::util::{Error, Result};

const MAX_TOTAL_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 200_000;
const MAX_DEPTH: usize = 6;
const ARC_FOLDERS: [&str; 16] = [
    "fighter", "ui", "sound", "stream;", "effect", "stage", "item", "assist", "boss", "enemy", "camera", "param", "prebuilt;", "render", "spirits", "standard",
];

fn archive_error(message: impl Into<String>) -> Error {
    Error::new(format!("archive: {}", message.into()))
}

struct Budget {
    root: PathBuf,
    bytes: u64,
    entries: usize,
}

impl Budget {
    fn target(&mut self, name: &str) -> Result<PathBuf> {
        self.entries += 1;
        if self.entries > MAX_ENTRIES {
            return Err(archive_error("too many files"));
        }
        let target = normalize(&self.root.join(safe_entry_path(name)?));
        let mut existing = target.parent().map(Path::to_path_buf);
        while let Some(dir) = existing.as_ref().filter(|dir| !dir.exists()) {
            existing = dir.parent().map(Path::to_path_buf);
        }
        let real_parent = existing.and_then(|dir| realpath(&dir).ok());
        let real_root = realpath(&self.root)?;
        if !inside(&self.root, &target) || !real_parent.is_some_and(|dir| inside_or_same(&real_root, &dir)) {
            return Err(archive_error(format!("unsafe path {name}")));
        }
        Ok(target)
    }

    fn write(&mut self, target: &Path, reader: &mut dyn Read) -> Result<()> {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = BufWriter::new(File::create(target)?);
        let left = MAX_TOTAL_BYTES.saturating_sub(self.bytes);
        let written = io::copy(&mut reader.take(left + 1), &mut out)?;
        self.bytes += written;
        if written > left {
            return Err(archive_error("archive too large once extracted"));
        }
        out.flush()?;
        Ok(())
    }
}

fn extract_7z(file: &Path, budget: &mut Budget) -> Result<()> {
    let mut reader = sevenz_rust2::ArchiveReader::open(file, sevenz_rust2::Password::empty()).map_err(|e| archive_error(e.to_string()))?;
    let mut failure = None;
    reader
        .for_each_entries(|entry, data| {
            let result = budget.target(entry.name()).and_then(|target| {
                if entry.is_directory() {
                    Ok(fs::create_dir_all(&target)?)
                } else {
                    budget.write(&target, data)
                }
            });
            match result {
                Ok(()) => Ok(true),
                Err(error) => {
                    failure = Some(error);
                    Ok(false)
                }
            }
        })
        .map_err(|e| archive_error(e.to_string()))?;
    failure.map_or(Ok(()), Err)
}

fn extract_rar(file: &Path, budget: &mut Budget) -> Result<()> {
    let mut archive = unrar::Archive::new(file).open_for_processing().map_err(|e| archive_error(e.to_string()))?;
    while let Some(header) = archive.read_header().map_err(|e| archive_error(e.to_string()))? {
        let entry = header.entry();
        let name = entry.filename.to_string_lossy().into_owned();
        let target = budget.target(&name)?;
        archive = if entry.is_directory() {
            fs::create_dir_all(&target)?;
            header.skip().map_err(|e| archive_error(e.to_string()))?
        } else {
            budget.bytes += entry.unpacked_size;
            if budget.bytes > MAX_TOTAL_BYTES {
                return Err(archive_error("archive too large once extracted"));
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            header.extract_to(&target).map_err(|e| archive_error(e.to_string()))?
        };
    }
    Ok(())
}

pub fn extract_archive(file: &Path, destination: &Path) -> Result<()> {
    fs::create_dir_all(destination)?;
    let mut magic = [0u8; 6];
    let read = File::open(file)?.read(&mut magic)?;
    let magic = &magic[..read];
    let mut budget = Budget { root: normalize(destination), bytes: 0, entries: 0 };
    if magic.starts_with(b"PK\x03\x04") {
        extract_zip(file, destination).map(|_| ())
    } else if magic.starts_with(b"7z\xBC\xAF\x27\x1C") {
        extract_7z(file, &mut budget)
    } else if magic.starts_with(b"Rar!\x1A\x07") {
        extract_rar(file, &mut budget)
    } else {
        Err(archive_error("unsupported format, expected .zip, .7z or .rar"))
    }
}

fn is_mod_root(dir: &Path) -> bool {
    dir.join("info.toml").is_file() || ARC_FOLDERS.iter().any(|name| dir.join(name).is_dir())
}

pub fn find_mod_roots(dir: &Path) -> Vec<PathBuf> {
    let mut roots = vec![];
    let mut level = vec![dir.to_path_buf()];
    for _ in 0..MAX_DEPTH {
        let mut next = vec![];
        for current in level {
            if is_mod_root(&current) {
                roots.push(current);
                continue;
            }
            let mut children: Vec<PathBuf> = fs::read_dir(&current).into_iter().flatten().flatten().filter(|e| e.file_type().is_ok_and(|t| t.is_dir())).map(|e| e.path()).collect();
            children.sort();
            next.extend(children);
        }
        level = next;
    }
    roots
}

pub fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)?.flatten() {
        let kind = entry.file_type()?;
        let target = to.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_mod_folder_and_its_options() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("Devil Jin/fighter/kazuya")).unwrap();
        fs::create_dir_all(dir.path().join("Optional/Nameplate/ui/replace")).unwrap();
        fs::create_dir_all(dir.path().join("Readme")).unwrap();
        let roots = find_mod_roots(dir.path());
        assert_eq!(roots, vec![dir.path().join("Devil Jin"), dir.path().join("Optional/Nameplate")]);
        assert_eq!(find_mod_roots(&dir.path().join("Devil Jin")), vec![dir.path().join("Devil Jin")]);
    }

    #[test]
    fn refuses_unknown_formats_and_unsafe_paths() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.bin");
        fs::write(&file, b"hello").unwrap();
        assert!(extract_archive(&file, &dir.path().join("out")).is_err());
        let mut budget = Budget { root: normalize(&realpath(dir.path()).unwrap()), bytes: 0, entries: 0 };
        assert!(budget.target("../evil.txt").is_err());
        assert!(budget.target("C:/evil.txt").is_err());
        assert!(budget.target("ok/fine.txt").is_ok());
    }
}

