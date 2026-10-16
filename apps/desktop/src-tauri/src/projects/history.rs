use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::schema::tools::{HistoryItem, HistoryKind, HistoryState};
use crate::util::paths::{inside, realpath};
use crate::util::time::{millis_of, now_iso, now_millis};
use crate::util::{Error, Result};

pub const MAX_TRACKED_FILE: u64 = 2 * 1024 * 1024;
pub const MAX_HISTORY_ENTRIES: usize = 100;
pub const MAX_HISTORY_BYTES: usize = 64 * 1024 * 1024;

fn coalesce_ms(kind: HistoryKind) -> Option<i64> {
    match kind {
        HistoryKind::NoteWrite => Some(15_000),
        HistoryKind::FileWrite => Some(3_000),
        _ => None,
    }
}

#[derive(Debug, Clone)]
pub struct FileChange {
    pub path: PathBuf,
    pub before: Option<Vec<u8>>,
    pub after: Option<Vec<u8>>,
}

#[derive(Clone)]
pub struct Meta {
    pub kind: HistoryKind,
    pub target: String,
    pub source: Option<String>,
}

impl Meta {
    pub fn new(kind: HistoryKind, target: impl Into<String>) -> Self {
        Meta { kind, target: target.into(), source: None }
    }
}

struct Entry {
    item: HistoryItem,
    changes: Vec<FileChange>,
    bytes: usize,
}

struct Stack {
    root: PathBuf,
    undo: Vec<Entry>,
    redo: Vec<Entry>,
}

enum Snapshot {
    Missing,
    Data(Vec<u8>),
    Skip,
}

impl Snapshot {
    fn data(&self) -> Option<Vec<u8>> {
        match self {
            Snapshot::Data(data) => Some(data.clone()),
            _ => None,
        }
    }
}

fn snapshot(path: &Path) -> Snapshot {
    match fs::symlink_metadata(path) {
        Err(_) => Snapshot::Missing,
        Ok(info) if !info.is_file() || info.len() > MAX_TRACKED_FILE => Snapshot::Skip,
        Ok(_) => fs::read(path).map(Snapshot::Data).unwrap_or(Snapshot::Skip),
    }
}

fn size(data: &Option<Vec<u8>>) -> usize {
    data.as_ref().map(Vec::len).unwrap_or(0)
}

pub struct HistoryService {
    stacks: Mutex<HashMap<String, Stack>>,
    changed: Box<dyn Fn(&str) + Send + Sync>,
}

impl HistoryService {
    pub fn new(changed: impl Fn(&str) + Send + Sync + 'static) -> Self {
        HistoryService { stacks: Mutex::new(HashMap::new()), changed: Box::new(changed) }
    }

    pub fn track<T>(&self, project_id: &str, root: &Path, meta: Meta, paths: &[PathBuf], action: impl FnOnce() -> Result<T>) -> Result<T> {
        let before: Vec<Snapshot> = paths.iter().map(|p| snapshot(p)).collect();
        let result = action()?;
        let after: Vec<Snapshot> = paths.iter().map(|p| snapshot(p)).collect();
        if before.iter().chain(after.iter()).any(|s| matches!(s, Snapshot::Skip)) {
            return Ok(result);
        }
        let changes: Vec<FileChange> = paths
            .iter()
            .zip(before.iter().zip(after.iter()))
            .filter_map(|(path, (a, b))| {
                let (a, b) = (a.data(), b.data());
                (a != b).then(|| FileChange { path: path.clone(), before: a, after: b })
            })
            .collect();
        self.record(project_id, root, meta, changes);
        Ok(result)
    }

    pub fn record(&self, project_id: &str, root: &Path, meta: Meta, changes: Vec<FileChange>) {
        if changes.is_empty() {
            return;
        }
        {
            let mut stacks = self.stacks.lock().unwrap();
            let stack = stack_of(&mut stacks, project_id, root);
            if let Some(last) = stack.undo.last_mut() {
                let window = coalesce_ms(meta.kind);
                let fits = window.is_some_and(|w| {
                    changes.len() == 1
                        && last.changes.len() == 1
                        && last.item.kind == meta.kind
                        && last.item.target == meta.target
                        && last.item.source == meta.source
                        && last.changes[0].path == changes[0].path
                        && now_millis() - millis_of(&last.item.time).unwrap_or(0) < w
                        && last.changes[0].after == changes[0].before
                });
                if fits {
                    let first = &mut last.changes[0];
                    if first.before == changes[0].after {
                        stack.undo.pop();
                    } else {
                        first.after = changes[0].after.clone();
                        last.bytes = size(&first.before) + size(&first.after);
                        last.item.time = now_iso();
                    }
                    stack.redo.clear();
                    drop(stacks);
                    (self.changed)(project_id);
                    return;
                }
            }
            let bytes = changes.iter().map(|c| size(&c.before) + size(&c.after)).sum();
            stack.undo.push(Entry {
                item: HistoryItem { kind: meta.kind, target: meta.target, source: meta.source, time: now_iso(), files: changes.len() },
                changes,
                bytes,
            });
            stack.redo.clear();
            trim(stack);
        }
        (self.changed)(project_id);
    }

    pub fn state(&self, project_id: &str) -> HistoryState {
        let stacks = self.stacks.lock().unwrap();
        let items = |list: &Vec<Entry>| list.iter().rev().map(|e| e.item.clone()).collect();
        match stacks.get(project_id) {
            Some(stack) => HistoryState { undo: items(&stack.undo), redo: items(&stack.redo) },
            None => HistoryState { undo: vec![], redo: vec![] },
        }
    }

    pub fn undo(&self, project_id: &str) -> Result<Option<HistoryItem>> {
        self.step(project_id, true)
    }

    pub fn redo(&self, project_id: &str) -> Result<Option<HistoryItem>> {
        self.step(project_id, false)
    }

    pub fn clear(&self, project_id: &str) {
        let removed = self.stacks.lock().unwrap().remove(project_id).is_some();
        if removed {
            (self.changed)(project_id);
        }
    }

    fn step(&self, project_id: &str, undo: bool) -> Result<Option<HistoryItem>> {
        let item = {
            let mut stacks = self.stacks.lock().unwrap();
            let Some(stack) = stacks.get_mut(project_id) else { return Ok(None) };
            let source = if undo { &stack.undo } else { &stack.redo };
            let Some(entry) = source.last() else { return Ok(None) };
            apply(&stack.root, entry, undo)?;
            let entry = if undo { stack.undo.pop() } else { stack.redo.pop() }.expect("entry");
            let item = entry.item.clone();
            if undo {
                stack.redo.push(entry);
            } else {
                stack.undo.push(entry);
            }
            item
        };
        (self.changed)(project_id);
        Ok(Some(item))
    }
}

fn stack_of<'a>(stacks: &'a mut HashMap<String, Stack>, project_id: &str, root: &Path) -> &'a mut Stack {
    let fresh = stacks.get(project_id).is_none_or(|s| s.root != root);
    if fresh {
        stacks.insert(project_id.to_string(), Stack { root: root.to_path_buf(), undo: vec![], redo: vec![] });
    }
    stacks.get_mut(project_id).unwrap()
}

fn trim(stack: &mut Stack) {
    let total = |s: &Stack| s.undo.iter().map(|e| e.bytes).sum::<usize>() + s.redo.iter().map(|e| e.bytes).sum::<usize>();
    while stack.undo.len() > MAX_HISTORY_ENTRIES || (stack.undo.len() > 1 && total(stack) > MAX_HISTORY_BYTES) {
        stack.undo.remove(0);
    }
}

fn history_error(code: &str) -> Error {
    Error::new(format!("history:{code}"))
}

fn apply(root: &Path, entry: &Entry, undo: bool) -> Result<()> {
    let real_root = realpath(root)?;
    for change in &entry.changes {
        if !inside(&real_root, &change.path) {
            return Err(history_error("outside"));
        }
        if let Some(parent) = change.path.parent().and_then(|p| realpath(p).ok()) {
            if parent != real_root && !inside(&real_root, &parent) {
                return Err(history_error("outside"));
            }
        }
        let expected = if undo { &change.after } else { &change.before };
        match snapshot(&change.path) {
            Snapshot::Skip => return Err(history_error("conflict")),
            current if &current.data() != expected => return Err(history_error("conflict")),
            _ => {}
        }
    }
    for change in &entry.changes {
        let target = if undo { &change.before } else { &change.after };
        match target {
            None => {
                let _ = fs::remove_file(&change.path);
            }
            Some(data) => {
                if let Some(parent) = change.path.parent() {
                    fs::create_dir_all(parent)?;
                }
                let mut tmp = change.path.as_os_str().to_owned();
                tmp.push(".tessera-undo");
                fs::write(&tmp, data)?;
                fs::rename(&tmp, &change.path)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, PathBuf, HistoryService) {
        let dir = tempfile::tempdir().unwrap();
        let root = realpath(dir.path()).unwrap();
        (dir, root, HistoryService::new(|_| {}))
    }

    fn write(root: &Path, name: &str, content: &str) -> Result<()> {
        Ok(fs::write(root.join(name), content)?)
    }

    fn read(root: &Path, name: &str) -> String {
        fs::read_to_string(root.join(name)).unwrap()
    }

    fn meta() -> Meta {
        Meta::new(HistoryKind::FileWrite, "a.txt")
    }

    #[test]
    fn undoes_and_redoes_a_write() {
        let (_d, root, history) = setup();
        let file = root.join("a.txt");
        write(&root, "a.txt", "one").unwrap();
        history.track("p", &root, meta(), std::slice::from_ref(&file), || write(&root, "a.txt", "two")).unwrap();
        assert_eq!(history.state("p").undo.len(), 1);
        assert_eq!(history.undo("p").unwrap().unwrap().target, "a.txt");
        assert_eq!(read(&root, "a.txt"), "one");
        assert_eq!(history.state("p").redo.len(), 1);
        history.redo("p").unwrap();
        assert_eq!(read(&root, "a.txt"), "two");
    }

    #[test]
    fn restores_deleted_and_removes_created() {
        let (_d, root, history) = setup();
        let file = root.join("a.txt");
        write(&root, "a.txt", "keep").unwrap();
        history.track("p", &root, Meta::new(HistoryKind::FileRemove, "a.txt"), std::slice::from_ref(&file), || Ok(fs::remove_file(&file)?)).unwrap();
        history.undo("p").unwrap();
        assert_eq!(read(&root, "a.txt"), "keep");
        let created = root.join("new.txt");
        history.track("p", &root, meta(), std::slice::from_ref(&created), || write(&root, "new.txt", "x")).unwrap();
        history.undo("p").unwrap();
        assert!(!created.exists());
    }

    #[test]
    fn refuses_when_file_changed() {
        let (_d, root, history) = setup();
        let file = root.join("a.txt");
        write(&root, "a.txt", "one").unwrap();
        history.track("p", &root, meta(), std::slice::from_ref(&file), || write(&root, "a.txt", "two")).unwrap();
        write(&root, "a.txt", "someone else").unwrap();
        assert_eq!(history.undo("p").unwrap_err().0, "history:conflict");
        assert_eq!(read(&root, "a.txt"), "someone else");
        assert_eq!(history.state("p").undo.len(), 1);
    }

    #[test]
    fn drops_redo_on_new_change() {
        let (_d, root, history) = setup();
        let file = root.join("a.txt");
        write(&root, "a.txt", "1").unwrap();
        history.track("p", &root, meta(), std::slice::from_ref(&file), || write(&root, "a.txt", "2")).unwrap();
        history.undo("p").unwrap();
        history.track("p", &root, meta(), std::slice::from_ref(&file), || write(&root, "a.txt", "3")).unwrap();
        assert!(history.state("p").redo.is_empty());
    }

    #[test]
    fn ignores_noops_dirs_and_failures() {
        let (_d, root, history) = setup();
        let file = root.join("a.txt");
        write(&root, "a.txt", "same").unwrap();
        history.track("p", &root, meta(), std::slice::from_ref(&file), || write(&root, "a.txt", "same")).unwrap();
        fs::create_dir(root.join("dir")).unwrap();
        history.track("p", &root, meta(), &[root.join("dir")], || Ok(())).unwrap();
        assert!(history.track("p", &root, meta(), std::slice::from_ref(&file), || Err::<(), _>(Error::new("boom"))).is_err());
        assert!(history.state("p").undo.is_empty());
    }

    #[test]
    fn tracks_rename_as_one_entry() {
        let (_d, root, history) = setup();
        let from = root.join("a.txt");
        let to = root.join("b.txt");
        write(&root, "a.txt", "data").unwrap();
        history
            .track("p", &root, Meta::new(HistoryKind::FileRename, "a.txt -> b.txt"), &[from.clone(), to.clone()], || {
                fs::write(&to, "data")?;
                fs::remove_file(&from)?;
                Ok(())
            })
            .unwrap();
        assert_eq!(history.state("p").undo[0].files, 2);
        history.undo("p").unwrap();
        assert_eq!(read(&root, "a.txt"), "data");
        assert!(!to.exists());
    }

    #[test]
    fn refuses_paths_outside() {
        let (_d, root, history) = setup();
        let outside = tempfile::tempdir().unwrap();
        history.record("p", &root, meta(), vec![FileChange { path: outside.path().join("x.txt"), before: None, after: Some(b"x".to_vec()) }]);
        assert_eq!(history.undo("p").unwrap_err().0, "history:outside");
    }

    #[test]
    fn keeps_at_most_100_entries() {
        let (_d, root, history) = setup();
        let file = root.join("a.txt");
        write(&root, "a.txt", "0").unwrap();
        for i in 1..=105 {
            let mut m = meta();
            m.target = i.to_string();
            history.track("p", &root, m, std::slice::from_ref(&file), || write(&root, "a.txt", &i.to_string())).unwrap();
        }
        assert_eq!(history.state("p").undo.len(), 100);
    }

    #[test]
    fn coalesces_quick_note_saves() {
        let (_d, root, history) = setup();
        let file = root.join("n.md");
        fs::write(&file, "start").unwrap();
        for text in ["s", "st", "sta", "star"] {
            history.track("p", &root, Meta::new(HistoryKind::NoteWrite, "n"), std::slice::from_ref(&file), || Ok(fs::write(&file, text)?)).unwrap();
        }
        assert_eq!(history.state("p").undo.len(), 1);
        history.undo("p").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "start");
    }

    #[test]
    fn drops_step_when_back_to_start_and_keeps_notes_apart() {
        let (_d, root, history) = setup();
        let file = root.join("n.md");
        fs::write(&file, "same").unwrap();
        history.track("p", &root, Meta::new(HistoryKind::NoteWrite, "n"), std::slice::from_ref(&file), || Ok(fs::write(&file, "other")?)).unwrap();
        history.track("p", &root, Meta::new(HistoryKind::NoteWrite, "n"), std::slice::from_ref(&file), || Ok(fs::write(&file, "same")?)).unwrap();
        assert!(history.state("p").undo.is_empty());
        let a = root.join("a.md");
        let b = root.join("b.md");
        fs::write(&a, "1").unwrap();
        fs::write(&b, "1").unwrap();
        history.track("p", &root, Meta::new(HistoryKind::NoteWrite, "a"), std::slice::from_ref(&a), || Ok(fs::write(&a, "2")?)).unwrap();
        history.track("p", &root, Meta::new(HistoryKind::NoteWrite, "b"), std::slice::from_ref(&b), || Ok(fs::write(&b, "2")?)).unwrap();
        assert_eq!(history.state("p").undo.len(), 2);
    }
}
