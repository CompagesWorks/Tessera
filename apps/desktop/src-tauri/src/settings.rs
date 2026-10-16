use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use serde_json::{Map, Value};

use crate::schema::settings::{Accounts, Settings};
use crate::util::{json, Result};

type Listener = Box<dyn Fn(&Settings) + Send + Sync>;

pub struct SettingsStore {
    file: PathBuf,
    current: RwLock<Settings>,
    write: Mutex<()>,
    listeners: Mutex<Vec<Listener>>,
}

impl SettingsStore {
    pub fn new(user_data: &Path) -> Arc<Self> {
        Arc::new(SettingsStore {
            file: user_data.join("settings.json"),
            current: RwLock::new(Settings::default()),
            write: Mutex::new(()),
            listeners: Mutex::new(vec![]),
        })
    }

    pub fn load(&self) -> Settings {
        if let Ok(raw) = fs::read_to_string(&self.file) {
            let parsed = serde_json::from_str::<Value>(&raw).map_err(Into::into).and_then(Settings::parse);
            match parsed {
                Ok(settings) => *self.current.write().unwrap() = settings,
                Err(error) => {
                    eprintln!("[settings] invalid settings.json, using defaults: {error}");
                    let _ = fs::rename(&self.file, self.file.with_file_name("settings.invalid.json"));
                }
            }
        }
        self.current()
    }

    pub fn current(&self) -> Settings {
        self.current.read().unwrap().clone()
    }

    pub fn on_change(&self, listener: impl Fn(&Settings) + Send + Sync + 'static) {
        self.listeners.lock().unwrap().push(Box::new(listener));
    }

    pub fn update(&self, patch: &Map<String, Value>) -> Result<Settings> {
        let _guard = self.write.lock().unwrap();
        let next = self.current().apply_patch(patch)?;
        self.commit(next)
    }

    pub fn set_accounts(&self, accounts: Accounts) -> Result<Settings> {
        let _guard = self.write.lock().unwrap();
        let mut next = self.current();
        next.accounts = accounts;
        next.validate()?;
        self.commit(next)
    }

    fn commit(&self, next: Settings) -> Result<Settings> {
        json::write(&self.file, &next)?;
        *self.current.write().unwrap() = next.clone();
        for listener in self.listeners.lock().unwrap().iter() {
            listener(&next);
        }
        Ok(next)
    }
}
