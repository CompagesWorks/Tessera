use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::projects::files::TESSERA_DIR;
use crate::schema::check;
use crate::schema::settings::BackupSettings;
use crate::util::collate::compare;
use crate::util::paths::{inside_or_same, normalize, relative_parts};
use crate::util::time::{mtime_ms, now_iso};
use crate::util::{json, Error, Result};

use super::zip::{extract_zip, write_zip, ZipSource};

const BACKUPS_DIR: &str = "backups";
const STAGING_DIR: &str = "restore-staging";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackupReason {
    Manual,
    Auto,
    Restore,
    Export,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub id: String,
    pub number: u64,
    pub created_at: String,
    pub reason: BackupReason,
    pub note: String,
    pub files: usize,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    number: u64,
    created_at: String,
    reason: BackupReason,
    note: String,
    files: usize,
    size: f64,
    file: String,
    signature: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    format_version: u8,
    next: u64,
    backups: Vec<Entry>,
}

impl Index {
    fn empty() -> Self {
        Index { format_version: 1, next: 1, backups: vec![] }
    }

    fn parse(value: serde_json::Value) -> Result<Index> {
        let index: Index = serde_json::from_value(value)?;
        let file_ok = |f: &str| f.starts_with("backup-") && f.ends_with(".zip") && f[7..f.len() - 4].chars().all(|c| c.is_ascii_digit()) && f.len() > 11;
        if index.format_version != 1 || index.next < 1 || index.backups.iter().any(|b| b.number < 1 || !file_ok(&b.file)) {
            return Err(Error::new("invalid index"));
        }
        Ok(index)
    }
}

fn info(entry: &Entry) -> BackupInfo {
    BackupInfo {
        id: entry.id.clone(),
        number: entry.number,
        created_at: entry.created_at.clone(),
        reason: entry.reason,
        note: entry.note.clone(),
        files: entry.files,
        size: entry.size as u64,
    }
}

fn backup_error(message: &str) -> Error {
    Error::new(message)
}

type RootOf = Box<dyn Fn(&str) -> Result<PathBuf> + Send + Sync>;
type SettingsOf = Box<dyn Fn() -> BackupSettings + Send + Sync>;
type Changed = Box<dyn Fn(&str) + Send + Sync>;

pub struct BackupService {
    root_of: RootOf,
    settings: SettingsOf,
    changed: Changed,
    queues: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl BackupService {
    pub fn new(
        root_of: impl Fn(&str) -> Result<PathBuf> + Send + Sync + 'static,
        settings: impl Fn() -> BackupSettings + Send + Sync + 'static,
        changed: impl Fn(&str) + Send + Sync + 'static,
    ) -> Self {
        BackupService { root_of: Box::new(root_of), settings: Box::new(settings), changed: Box::new(changed), queues: Mutex::new(HashMap::new()) }
    }

    fn serial<T>(&self, project_id: &str, run: impl FnOnce() -> Result<T>) -> Result<T> {
        let lock = self.queues.lock().unwrap().entry(project_id.to_string()).or_default().clone();
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        run()
    }

    pub fn folder_of(&self, project_id: &str) -> Result<PathBuf> {
        if let Some(custom) = (self.settings)().folder {
            return Ok(PathBuf::from(custom).join(project_id));
        }
        Ok((self.root_of)(project_id)?.join(TESSERA_DIR).join(BACKUPS_DIR))
    }

    pub fn list(&self, project_id: &str) -> Result<Vec<BackupInfo>> {
        let index = read_index(&self.folder_of(project_id)?);
        Ok(index.backups.iter().rev().map(info).collect())
    }

    pub fn create(&self, project_id: &str, reason: BackupReason, note: &str) -> Result<Option<BackupInfo>> {
        self.serial(project_id, || self.create_now(project_id, reason, note, false))
    }

    pub fn restore(&self, project_id: &str, backup_id: &str) -> Result<BackupInfo> {
        self.serial(project_id, || {
            let root = (self.root_of)(project_id)?;
            let folder = self.folder_of(project_id)?;
            let target = entry(&folder, backup_id)?;
            let safety = self.create_now(project_id, BackupReason::Restore, &format!("#{}", target.number), true)?.ok_or_else(|| backup_error("could not create the safety backup"))?;
            let staging = root.join(TESSERA_DIR).join(STAGING_DIR);
            let _ = fs::remove_dir_all(&staging);
            fs::create_dir_all(&staging)?;
            let result = (|| -> Result<()> {
                extract_zip(&folder.join(&target.file), &staging)?;
                for file in collect(&root, &folder)? {
                    let _ = fs::remove_file(crate::util::paths::from_slash(&root, &file.path));
                }
                prune_empty_dirs(&root, &folder)?;
                move_into(&staging, &root)
            })();
            let _ = fs::remove_dir_all(&staging);
            result?;
            (self.changed)(project_id);
            Ok(safety)
        })
    }

    pub fn extract(&self, project_id: &str, backup_id: &str, destination: &Path) -> Result<PathBuf> {
        let folder = self.folder_of(project_id)?;
        let item = entry(&folder, backup_id)?;
        let root = (self.root_of)(project_id)?;
        let base = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "project".into());
        let name = format!("{base}-backup-{}", item.number);
        let mut target = destination.join(&name);
        let mut i = 2;
        while fs::symlink_metadata(&target).is_ok() {
            target = destination.join(format!("{name}-{i}"));
            i += 1;
        }
        fs::create_dir_all(&target)?;
        extract_zip(&folder.join(&item.file), &target)?;
        Ok(target)
    }

    pub fn delete(&self, project_id: &str, backup_id: &str) -> Result<()> {
        self.serial(project_id, || {
            let folder = self.folder_of(project_id)?;
            let mut index = read_index(&folder);
            let position = index.backups.iter().position(|b| b.id == backup_id).ok_or_else(|| backup_error("unknown backup"))?;
            let removed = index.backups.remove(position);
            let _ = fs::remove_file(folder.join(&removed.file));
            json::write(&folder.join("index.json"), &index)?;
            (self.changed)(project_id);
            Ok(())
        })
    }

    pub fn file_of(&self, project_id: &str, backup_id: &str) -> Result<PathBuf> {
        let folder = self.folder_of(project_id)?;
        Ok(folder.join(entry(&folder, backup_id)?.file))
    }

    fn create_now(&self, project_id: &str, reason: BackupReason, note: &str, force: bool) -> Result<Option<BackupInfo>> {
        let root = (self.root_of)(project_id)?;
        let folder = self.folder_of(project_id)?;
        fs::create_dir_all(&folder)?;
        let mut index = read_index(&folder);
        let files = collect(&root, &folder)?;
        let mut hasher = Sha256::new();
        let joined = files.iter().map(|f| format!("{}\0{}\0{}", f.path, f.size, js_number(f.mtime))).collect::<Vec<_>>().join("\n");
        hasher.update(joined.as_bytes());
        let signature = hex::encode(hasher.finalize());
        if reason == BackupReason::Auto && !force && index.backups.last().is_some_and(|b| b.signature == signature) {
            return Ok(None);
        }
        let number = index.next;
        let file = format!("backup-{number}.zip");
        let temp = folder.join(format!("{file}.tmp"));
        if let Err(error) = write_zip(&root, &files, &temp).and_then(|_| Ok(fs::rename(&temp, folder.join(&file))?)) {
            let _ = fs::remove_file(&temp);
            return Err(error);
        }
        let item = Entry {
            id: number.to_string(),
            number,
            created_at: now_iso(),
            reason,
            note: note.to_string(),
            files: files.len(),
            size: fs::metadata(folder.join(&file))?.len() as f64,
            file,
            signature,
        };
        index.next = number + 1;
        index.backups.push(item.clone());
        let keep = (self.settings)().keep;
        if keep > 0 {
            while index.backups.len() > keep as usize {
                let oldest = index.backups.remove(0);
                let _ = fs::remove_file(folder.join(&oldest.file));
            }
        }
        json::write(&folder.join("index.json"), &index)?;
        (self.changed)(project_id);
        Ok(Some(info(&item)))
    }
}

fn js_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

fn read_index(folder: &Path) -> Index {
    json::read(&folder.join("index.json"), Index::parse).unwrap_or_else(Index::empty)
}

fn entry(folder: &Path, backup_id: &str) -> Result<Entry> {
    if !check::BACKUP_ID.is_match(backup_id) {
        return Err(backup_error("unknown backup"));
    }
    read_index(folder).backups.into_iter().find(|b| b.id == backup_id).ok_or_else(|| backup_error("unknown backup"))
}

fn skipped(rel: &[String]) -> bool {
    (rel.len() == 1 && rel[0] == "build") || (rel.len() == 2 && rel[0] == TESSERA_DIR && (rel[1] == BACKUPS_DIR || rel[1] == STAGING_DIR))
}

fn collect(root: &Path, backup_folder: &Path) -> Result<Vec<ZipSource>> {
    let real_root = normalize(root);
    let skip_folder = normalize(backup_folder);
    let mut files = vec![];
    fn walk(dir: &Path, root: &Path, skip: &Path, files: &mut Vec<ZipSource>) -> Result<()> {
        for item in fs::read_dir(dir)?.flatten() {
            let Ok(kind) = item.file_type() else { continue };
            let full = dir.join(item.file_name());
            let rel = relative_parts(root, &full).unwrap_or_default();
            if kind.is_symlink() || skipped(&rel) || inside_or_same(skip, &full) {
                continue;
            }
            if kind.is_dir() {
                walk(&full, root, skip, files)?;
            } else if kind.is_file() {
                let meta = fs::metadata(&full)?;
                files.push(ZipSource { path: rel.join("/"), size: meta.len(), mtime: meta.modified().map(mtime_ms).unwrap_or(0.0) });
            }
        }
        Ok(())
    }
    walk(&real_root, &real_root, &skip_folder, &mut files)?;
    files.sort_by(|a, b| compare(&a.path, &b.path));
    Ok(files)
}

fn prune_empty_dirs(root: &Path, backup_folder: &Path) -> Result<()> {
    let root = normalize(root);
    let skip = normalize(backup_folder);
    fn sweep(dir: &Path, root: &Path, skip: &Path) -> Result<bool> {
        let mut empty = true;
        for item in fs::read_dir(dir)?.flatten() {
            let Ok(kind) = item.file_type() else { continue };
            let full = dir.join(item.file_name());
            let rel = relative_parts(root, &full).unwrap_or_default();
            let kept = kind.is_symlink()
                || !kind.is_dir()
                || (rel.len() == 1 && (rel[0] == "build" || rel[0] == TESSERA_DIR))
                || inside_or_same(skip, &full)
                || !sweep(&full, root, skip)?;
            if kept {
                empty = false;
            } else {
                let _ = fs::remove_dir_all(&full);
            }
        }
        Ok(empty)
    }
    sweep(&root, &root, &skip)?;
    Ok(())
}

fn move_into(from: &Path, to: &Path) -> Result<()> {
    for item in fs::read_dir(from)?.flatten() {
        let source = from.join(item.file_name());
        let target = to.join(item.file_name());
        if item.file_type()?.is_dir() {
            fs::create_dir_all(&target)?;
            move_into(&source, &target)?;
        } else {
            let _ = fs::remove_file(&target);
            fs::rename(&source, &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backups::zip::read_zip_entries;
    use crate::schema::settings::default_backups;

    const PROJECT: &str = "00000000-0000-4000-8000-000000000001";

    struct Setup {
        dir: tempfile::TempDir,
        root: PathBuf,
        settings: Arc<Mutex<BackupSettings>>,
        changes: Arc<Mutex<usize>>,
    }

    fn setup() -> Setup {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("mario");
        fs::create_dir_all(root.join("sources/textures")).unwrap();
        fs::create_dir_all(root.join(".tessera")).unwrap();
        fs::create_dir_all(root.join("build")).unwrap();
        fs::write(root.join("sources/textures/body.png"), [137, 80, 78, 71, 1, 2, 3]).unwrap();
        fs::write(root.join("sources/notes é.txt"), "hello").unwrap();
        fs::write(root.join(".tessera/project.json"), "{\"id\":\"x\"}").unwrap();
        fs::write(root.join("build/out.zip"), "built").unwrap();
        Setup { dir, root, settings: Arc::new(Mutex::new(default_backups())), changes: Arc::new(Mutex::new(0)) }
    }

    fn service(s: &Setup) -> BackupService {
        let root = s.root.clone();
        let settings = s.settings.clone();
        let changes = s.changes.clone();
        BackupService::new(move |_| Ok(root.clone()), move || settings.lock().unwrap().clone(), move |_| *changes.lock().unwrap() += 1)
    }

    #[test]
    fn zips_without_build_and_backups() {
        let s = setup();
        let backups = service(&s);
        let first = backups.create(PROJECT, BackupReason::Manual, "first").unwrap().unwrap();
        assert_eq!((first.number, first.reason, first.note.as_str(), first.files), (1, BackupReason::Manual, "first", 3));
        let second = backups.create(PROJECT, BackupReason::Manual, "").unwrap().unwrap();
        let mut paths: Vec<String> = read_zip_entries(&s.root.join(".tessera/backups/backup-2.zip")).unwrap().into_iter().map(|e| e.path).collect();
        paths.sort();
        assert_eq!(paths, vec![".tessera/project.json", "sources/notes é.txt", "sources/textures/body.png"]);
        assert_eq!(second.number, 2);
        assert_eq!(backups.list(PROJECT).unwrap().iter().map(|b| b.number).collect::<Vec<_>>(), vec![2, 1]);
        assert_eq!(*s.changes.lock().unwrap(), 2);
    }

    #[test]
    fn skips_unchanged_auto_backup() {
        let s = setup();
        let backups = service(&s);
        backups.create(PROJECT, BackupReason::Auto, "").unwrap();
        assert!(backups.create(PROJECT, BackupReason::Auto, "").unwrap().is_none());
        fs::write(s.root.join("sources/new.txt"), "new").unwrap();
        assert_eq!(backups.create(PROJECT, BackupReason::Auto, "").unwrap().unwrap().number, 2);
    }

    #[test]
    fn keeps_newest() {
        let s = setup();
        s.settings.lock().unwrap().keep = 2;
        let backups = service(&s);
        for _ in 0..4 {
            backups.create(PROJECT, BackupReason::Manual, "").unwrap();
        }
        assert_eq!(backups.list(PROJECT).unwrap().iter().map(|b| b.number).collect::<Vec<_>>(), vec![4, 3]);
        let mut names: Vec<String> = fs::read_dir(s.root.join(".tessera/backups")).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        assert_eq!(names, vec!["backup-3.zip", "backup-4.zip", "index.json"]);
    }

    #[test]
    fn restores_after_safety_backup() {
        let s = setup();
        let backups = service(&s);
        backups.create(PROJECT, BackupReason::Manual, "").unwrap();
        fs::write(s.root.join("sources/notes é.txt"), "changed").unwrap();
        fs::write(s.root.join("sources/extra.txt"), "extra").unwrap();
        fs::remove_dir_all(s.root.join("sources/textures")).unwrap();
        let safety = backups.restore(PROJECT, "1").unwrap();
        assert_eq!((safety.number, safety.reason, safety.note.as_str()), (2, BackupReason::Restore, "#1"));
        assert_eq!(fs::read_to_string(s.root.join("sources/notes é.txt")).unwrap(), "hello");
        assert_eq!(fs::read(s.root.join("sources/textures/body.png")).unwrap(), vec![137, 80, 78, 71, 1, 2, 3]);
        assert!(!s.root.join("sources/extra.txt").exists());
        assert_eq!(fs::read_to_string(s.root.join("build/out.zip")).unwrap(), "built");
        assert_eq!(backups.list(PROJECT).unwrap().iter().map(|b| b.number).collect::<Vec<_>>(), vec![2, 1]);
    }

    #[test]
    fn extracts_and_uses_custom_folder() {
        let s = setup();
        s.settings.lock().unwrap().folder = Some(s.dir.path().join("all-backups").to_string_lossy().into_owned());
        let backups = service(&s);
        backups.create(PROJECT, BackupReason::Manual, "").unwrap();
        assert!(s.dir.path().join("all-backups").join(PROJECT).join("backup-1.zip").exists());
        let target = backups.extract(PROJECT, "1", &s.dir.path().join("out")).unwrap();
        assert_eq!(target, s.dir.path().join("out").join("mario-backup-1"));
        assert_eq!(fs::read_to_string(target.join("sources/notes é.txt")).unwrap(), "hello");
    }

    #[test]
    fn deletes_a_backup() {
        let s = setup();
        let backups = service(&s);
        backups.create(PROJECT, BackupReason::Manual, "").unwrap();
        backups.delete(PROJECT, "1").unwrap();
        assert!(backups.list(PROJECT).unwrap().is_empty());
    }
}
