use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use super::Result;

pub fn read_value(file: &Path) -> Option<Value> {
    let raw = fs::read_to_string(file).ok()?;
    serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok()
}

pub fn read<T>(file: &Path, parse: impl FnOnce(Value) -> Result<T>) -> Option<T> {
    parse(read_value(file)?).ok()
}

pub fn write(file: &Path, value: &impl Serialize) -> Result<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(value)?;
    text.push('\n');
    let tmp = tmp_of(file);
    fs::write(&tmp, text)?;
    fs::rename(&tmp, file)?;
    Ok(())
}

pub fn tmp_of(file: &Path) -> std::path::PathBuf {
    let mut name = file.as_os_str().to_owned();
    name.push(".tmp");
    name.into()
}
