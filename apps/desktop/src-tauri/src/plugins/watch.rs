use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

use crate::projects::files::TESSERA_DIR;
use crate::util::paths::relative_slash;

const DEBOUNCE: Duration = Duration::from_millis(300);
const MAX_PATHS: usize = 200;

type Emit = Arc<dyn Fn(&str, Vec<String>) + Send + Sync>;

struct Pending {
    paths: Vec<String>,
    scheduled: bool,
}

struct Watch {
    _watcher: RecommendedWatcher,
    users: HashSet<String>,
}

pub struct ProjectWatcher {
    emit: Emit,
    watches: Arc<Mutex<HashMap<String, Watch>>>,
}

impl ProjectWatcher {
    pub fn new(emit: impl Fn(&str, Vec<String>) + Send + Sync + 'static) -> Self {
        ProjectWatcher { emit: Arc::new(emit), watches: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub fn start(&self, project_id: &str, root: &Path, user: &str) -> crate::util::Result<()> {
        let mut watches = self.watches.lock().unwrap();
        if let Some(existing) = watches.get_mut(project_id) {
            existing.users.insert(user.to_string());
            return Ok(());
        }
        let root: PathBuf = crate::util::paths::realpath(root).unwrap_or_else(|_| root.to_path_buf());
        let pending = Arc::new(Mutex::new(Pending { paths: vec![], scheduled: false }));
        let emit = self.emit.clone();
        let id = project_id.to_string();
        let watch_root = root.clone();
        let all = self.watches.clone();
        let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            let event = match event {
                Ok(event) => event,
                Err(_) => {
                    let all = all.clone();
                    let id = id.clone();
                    thread::spawn(move || {
                        all.lock().unwrap().remove(&id);
                    });
                    return;
                }
            };
            let mut state = pending.lock().unwrap();
            let mut touched = false;
            for path in &event.paths {
                let rel = relative_slash(&watch_root, path);
                if rel.is_empty() || rel.split('/').next() == Some(TESSERA_DIR) {
                    continue;
                }
                touched = true;
                if state.paths.len() < MAX_PATHS && !state.paths.contains(&rel) {
                    state.paths.push(rel);
                }
            }
            if !touched || state.scheduled {
                return;
            }
            state.scheduled = true;
            let pending = pending.clone();
            let emit = emit.clone();
            let id = id.clone();
            thread::spawn(move || {
                thread::sleep(DEBOUNCE);
                let paths = {
                    let mut state = pending.lock().unwrap();
                    state.scheduled = false;
                    std::mem::take(&mut state.paths)
                };
                emit(&id, paths);
            });
        })
        .map_err(|e| crate::util::Error::new(e.to_string()))?;
        watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| crate::util::Error::new(e.to_string()))?;
        watches.insert(project_id.to_string(), Watch { _watcher: watcher, users: HashSet::from([user.to_string()]) });
        Ok(())
    }

    pub fn stop(&self, project_id: &str, user: &str) {
        let mut watches = self.watches.lock().unwrap();
        let Some(entry) = watches.get_mut(project_id) else { return };
        entry.users.remove(user);
        if entry.users.is_empty() {
            watches.remove(project_id);
        }
    }

    pub fn stop_all(&self) {
        self.watches.lock().unwrap().clear();
    }
}
