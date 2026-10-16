use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::schema::plugins::PluginSetting;
use crate::util::{json, Error, Result};

type Definitions = Box<dyn Fn(&str) -> Option<Vec<PluginSetting>> + Send + Sync>;
type Changed = Box<dyn Fn(&str, &Map<String, Value>) + Send + Sync>;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsFile {
    format_version: u8,
    values: Map<String, Value>,
}

pub struct PluginSettingsStore {
    file: PathBuf,
    definitions: Definitions,
    changed: Changed,
    stored: Mutex<Map<String, Value>>,
}

fn setting_error(message: &str) -> Error {
    Error::new(format!("plugin-settings:{}", message.replace(' ', "-")))
}

fn valid_values(value: &Value) -> bool {
    value.as_object().is_some_and(|plugins| {
        plugins.values().all(|values| values.as_object().is_some_and(|v| v.values().all(|x| matches!(x, Value::Bool(_) | Value::String(_) | Value::Number(_)))))
    })
}

impl PluginSettingsStore {
    pub fn new(file: PathBuf, definitions: impl Fn(&str) -> Option<Vec<PluginSetting>> + Send + Sync + 'static, changed: impl Fn(&str, &Map<String, Value>) + Send + Sync + 'static) -> Self {
        PluginSettingsStore { file, definitions: Box::new(definitions), changed: Box::new(changed), stored: Mutex::new(Map::new()) }
    }

    pub fn load(&self) {
        let values = json::read(&self.file, |v| {
            let file: SettingsFile = serde_json::from_value(v)?;
            if file.format_version != 1 || !valid_values(&Value::Object(file.values.clone())) {
                return Err(Error::new("invalid"));
            }
            Ok(file.values)
        });
        *self.stored.lock().unwrap() = values.unwrap_or_default();
    }

    fn values_from(&self, stored: &Map<String, Value>, plugin_id: &str) -> Map<String, Value> {
        let saved = stored.get(plugin_id).and_then(Value::as_object).cloned().unwrap_or_default();
        let mut result = Map::new();
        for def in (self.definitions)(plugin_id).unwrap_or_default() {
            let value = saved.get(def.id()).and_then(|v| def.coerce(v)).unwrap_or_else(|| def.default_value());
            result.insert(def.id().to_string(), value);
        }
        result
    }

    pub fn values(&self, plugin_id: &str) -> Map<String, Value> {
        let stored = self.stored.lock().unwrap();
        self.values_from(&stored, plugin_id)
    }

    pub fn all(&self) -> Map<String, Value> {
        let stored = self.stored.lock().unwrap();
        let mut out = Map::new();
        for id in stored.keys() {
            let values = self.values_from(&stored, id);
            if !values.is_empty() {
                out.insert(id.clone(), Value::Object(values));
            }
        }
        out
    }

    pub fn set(&self, plugin_id: &str, key: &str, value: &Value) -> Result<Map<String, Value>> {
        let defs = (self.definitions)(plugin_id).unwrap_or_default();
        let def = defs.iter().find(|d| d.id() == key).ok_or_else(|| setting_error("unknown setting"))?;
        let checked = def.coerce(value).ok_or_else(|| setting_error("invalid value"))?;
        self.commit(plugin_id, |saved| {
            saved.insert(key.to_string(), checked);
        })
    }

    pub fn set_many(&self, plugin_id: &str, values: &Map<String, Value>) -> Result<usize> {
        let defs = (self.definitions)(plugin_id).unwrap_or_default();
        let accepted: Vec<(String, Value)> = values.iter().filter_map(|(key, value)| defs.iter().find(|d| d.id() == key).and_then(|d| d.coerce(value)).map(|v| (key.clone(), v))).collect();
        let applied = accepted.len();
        if applied > 0 {
            self.commit(plugin_id, |saved| {
                for (key, value) in accepted {
                    saved.insert(key, value);
                }
            })?;
        }
        Ok(applied)
    }

    pub fn reset(&self, plugin_id: &str, key: Option<&str>) -> Result<Map<String, Value>> {
        self.commit(plugin_id, |saved| match key {
            None => saved.clear(),
            Some(key) => {
                saved.remove(key);
            }
        })
    }

    pub fn forget(&self, plugin_id: &str) -> Result<()> {
        let mut stored = self.stored.lock().unwrap();
        if stored.remove(plugin_id).is_some() {
            self.save(&stored)?;
        }
        Ok(())
    }

    fn commit(&self, plugin_id: &str, change: impl FnOnce(&mut Map<String, Value>)) -> Result<Map<String, Value>> {
        let values = {
            let mut stored = self.stored.lock().unwrap();
            let mut next = stored.get(plugin_id).and_then(Value::as_object).cloned().unwrap_or_default();
            change(&mut next);
            if next.is_empty() {
                stored.remove(plugin_id);
            } else {
                stored.insert(plugin_id.to_string(), Value::Object(next));
            }
            self.save(&stored)?;
            self.values_from(&stored, plugin_id)
        };
        (self.changed)(plugin_id, &values);
        Ok(values)
    }

    fn save(&self, stored: &Map<String, Value>) -> Result<()> {
        json::write(&self.file, &SettingsFile { format_version: 1, values: stored.clone() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::plugins::parse_manifest;
    use serde_json::json;
    use std::sync::Arc;

    fn defs(max: i64) -> Vec<PluginSetting> {
        parse_manifest(json!({
            "id": "dev.lab", "name": "Lab", "version": "1.0.0", "author": "me", "engines": { "tessera": ">=0.1.0" },
            "contributes": { "settings": [
                { "id": "on", "type": "boolean", "title": "On", "default": true },
                { "id": "name", "type": "string", "title": "Name", "default": "x", "maxLength": 5 },
                { "id": "size", "type": "number", "title": "Size", "default": 2, "min": 1, "max": max },
                { "id": "mode", "type": "select", "title": "Mode", "default": "a", "options": [{ "value": "a", "label": "A" }, { "value": "b", "label": "B" }] }
            ] }
        }))
        .unwrap()
        .contributes
        .settings
    }

    fn store(file: PathBuf, max: i64, seen: Arc<Mutex<usize>>) -> PluginSettingsStore {
        PluginSettingsStore::new(file, move |id| (id == "dev.lab").then(|| defs(max)), move |_, _| *seen.lock().unwrap() += 1)
    }

    #[test]
    fn rejects_bad_definitions() {
        let bad = |settings: serde_json::Value| parse_manifest(json!({ "id": "dev.lab", "name": "Lab", "version": "1.0.0", "author": "me", "engines": { "tessera": "1" }, "contributes": { "settings": settings } })).unwrap_err().0;
        assert!(bad(json!([{ "id": "speed", "type": "number", "title": "Speed", "default": 50, "min": 0, "max": 10 }])).contains("default"));
        assert!(bad(json!([{ "id": "mode", "type": "select", "title": "Mode", "default": "x", "options": [{ "value": "a", "label": "A" }] }])).contains("default"));
        assert!(bad(json!([{ "id": "a", "type": "boolean", "title": "A", "default": true }, { "id": "a", "type": "boolean", "title": "A2", "default": false }])).contains("duplicate"));
    }

    #[test]
    fn stores_validated_values() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("s.json");
        let seen = Arc::new(Mutex::new(0));
        let s = store(file.clone(), 4, seen.clone());
        assert_eq!(Value::Object(s.values("dev.lab")), json!({ "on": true, "name": "x", "size": 2, "mode": "a" }));
        s.set("dev.lab", "size", &json!(3)).unwrap();
        assert_eq!(s.set("dev.lab", "size", &json!(9)).unwrap_err().0, "plugin-settings:invalid-value");
        assert_eq!(s.set("dev.lab", "mode", &json!("z")).unwrap_err().0, "plugin-settings:invalid-value");
        assert_eq!(s.set("dev.lab", "name", &json!("toolong")).unwrap_err().0, "plugin-settings:invalid-value");
        assert_eq!(s.set("dev.lab", "nope", &json!(1)).unwrap_err().0, "plugin-settings:unknown-setting");
        assert_eq!(s.values("dev.lab")["size"], json!(3));
        assert_eq!(*seen.lock().unwrap(), 1);
        let reloaded = store(file.clone(), 4, seen.clone());
        reloaded.load();
        assert_eq!(reloaded.values("dev.lab")["size"], json!(3));
        reloaded.reset("dev.lab", Some("size")).unwrap();
        assert_eq!(reloaded.values("dev.lab")["size"], json!(2));
        reloaded.set("dev.lab", "size", &json!(4)).unwrap();
        let narrower = store(file, 3, seen);
        narrower.load();
        assert_eq!(narrower.values("dev.lab")["size"], json!(2));
    }

    #[test]
    fn applies_only_valid_imported_values() {
        let dir = tempfile::tempdir().unwrap();
        let s = store(dir.path().join("s.json"), 4, Arc::new(Mutex::new(0)));
        let values = json!({ "on": false, "size": 99, "ghost": 1, "mode": "b" });
        assert_eq!(s.set_many("dev.lab", values.as_object().unwrap()).unwrap(), 2);
        let current = s.values("dev.lab");
        assert_eq!((current["on"].clone(), current["mode"].clone(), current["size"].clone()), (json!(false), json!("b"), json!(2)));
    }
}
