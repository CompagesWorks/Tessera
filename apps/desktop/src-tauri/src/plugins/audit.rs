use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::schema::plugins::AuditEntry;
use crate::schema::tools::AuditList;
use crate::util::time::now_iso;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MEMORY: usize = 2000;

pub struct AuditLog {
    file: PathBuf,
    entries: Mutex<Vec<AuditEntry>>,
    write: Mutex<()>,
    on_record: Box<dyn Fn() + Send + Sync>,
}

pub struct Query<'a> {
    pub plugin_id: Option<&'a str>,
    pub allowed: Option<bool>,
    pub text: Option<&'a str>,
    pub limit: usize,
}

impl AuditLog {
    pub fn new(file: PathBuf, on_record: impl Fn() + Send + Sync + 'static) -> Self {
        AuditLog { file, entries: Mutex::new(vec![]), write: Mutex::new(()), on_record: Box::new(on_record) }
    }

    pub fn load(&self) {
        let raw = fs::read_to_string(&self.file).unwrap_or_default();
        let lines: Vec<&str> = raw.split('\n').filter(|l| !l.is_empty()).collect();
        let start = lines.len().saturating_sub(MEMORY);
        *self.entries.lock().unwrap() = lines[start..].iter().filter_map(|line| serde_json::from_str(line).ok()).collect();
    }

    pub fn record(&self, plugin_id: &str, action: &str, target: &str, allowed: bool) {
        let entry = AuditEntry { time: now_iso(), plugin_id: plugin_id.into(), action: action.into(), target: target.into(), allowed };
        {
            let mut entries = self.entries.lock().unwrap();
            entries.push(entry.clone());
            let excess = entries.len().saturating_sub(MEMORY);
            entries.drain(..excess);
        }
        if let Err(error) = self.append(&entry) {
            eprintln!("[audit] write failed {error}");
        }
        (self.on_record)();
    }

    pub fn query(&self, query: &Query<'_>) -> AuditList {
        let needle = query.text.map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty());
        let entries = self.entries.lock().unwrap();
        let matching: Vec<&AuditEntry> = entries
            .iter()
            .filter(|e| query.plugin_id.is_none_or(|id| e.plugin_id == id))
            .filter(|e| query.allowed.is_none_or(|a| e.allowed == a))
            .filter(|e| needle.as_ref().is_none_or(|n| format!("{} {} {}", e.action, e.target, e.plugin_id).to_lowercase().contains(n)))
            .collect();
        let total = matching.len();
        let start = total.saturating_sub(query.limit);
        AuditList { entries: matching[start..].iter().rev().map(|e| (*e).clone()).collect(), total }
    }

    pub fn clear(&self) {
        self.entries.lock().unwrap().clear();
        let _guard = self.write.lock().unwrap();
        let _ = fs::remove_file(&self.file);
        let _ = fs::remove_file(self.rotated());
    }

    pub fn for_plugin(&self, plugin_id: &str, limit: usize) -> Vec<AuditEntry> {
        let entries = self.entries.lock().unwrap();
        let mine: Vec<&AuditEntry> = entries.iter().filter(|e| e.plugin_id == plugin_id).collect();
        let start = mine.len().saturating_sub(limit);
        mine[start..].iter().rev().map(|e| (*e).clone()).collect()
    }

    fn rotated(&self) -> PathBuf {
        let mut name = self.file.as_os_str().to_owned();
        name.push(".1");
        name.into()
    }

    fn append(&self, entry: &AuditEntry) -> std::io::Result<()> {
        let _guard = self.write.lock().unwrap();
        if let Some(parent) = self.file.parent() {
            fs::create_dir_all(parent)?;
        }
        if fs::metadata(&self.file).map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
            let _ = fs::rename(&self.file, self.rotated());
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&self.file)?;
        writeln!(file, "{}", serde_json::to_string(entry)?)
    }
}
