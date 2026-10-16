use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::schema::check;
use crate::util::collate::compare_numeric_base;
use crate::util::time::iso_of;
use crate::util::{json, Error, Result};

use super::files::TESSERA_DIR;

const EXT: &str = ".md";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteInfo {
    pub name: String,
    pub updated_at: String,
    pub size: u64,
}

pub fn notes_dir(root: &Path) -> PathBuf {
    root.join(TESSERA_DIR).join("notes")
}

fn valid(name: &str) -> Option<String> {
    let mut checked = name.to_string();
    check::note_name("", &mut checked).ok().map(|_| checked)
}

pub fn note_file(root: &Path, name: &str) -> Result<PathBuf> {
    let name = valid(name).ok_or_else(|| Error::new("invalid note name"))?;
    Ok(notes_dir(root).join(format!("{name}{EXT}")))
}

pub fn list_notes(root: &Path) -> Vec<NoteInfo> {
    let mut notes = vec![];
    let Ok(entries) = fs::read_dir(notes_dir(root)) else { return notes };
    for entry in entries.flatten() {
        let file = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) || !file.to_lowercase().ends_with(EXT) {
            continue;
        }
        let name = file[..file.len() - EXT.len()].to_string();
        if valid(&name).as_deref() != Some(name.as_str()) {
            continue;
        }
        let Ok(info) = entry.metadata() else { continue };
        notes.push(NoteInfo { name, updated_at: info.modified().map(iso_of).unwrap_or_default(), size: info.len() });
    }
    notes.sort_by(|a, b| compare_numeric_base(&a.name, &b.name));
    notes
}

pub fn read_note(root: &Path, name: &str) -> Result<String> {
    let file = note_file(root, name)?;
    Ok(fs::read(file).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default())
}

pub fn write_note(root: &Path, name: &str, content: &str) -> Result<()> {
    let file = note_file(root, name)?;
    fs::create_dir_all(notes_dir(root))?;
    let tmp = json::tmp_of(&file);
    fs::write(&tmp, content)?;
    fs::rename(&tmp, &file)?;
    Ok(())
}

pub fn create_note(root: &Path, name: &str, content: &str) -> Result<String> {
    let existing: Vec<String> = list_notes(root).into_iter().map(|n| n.name.to_lowercase()).collect();
    let base = check::js_trim(name);
    let mut candidate = base.clone();
    let mut i = 2;
    while existing.contains(&candidate.to_lowercase()) {
        candidate = format!("{base} {i}");
        i += 1;
    }
    write_note(root, &candidate, content)?;
    Ok(candidate)
}

pub fn delete_note(root: &Path, name: &str) -> Result<()> {
    let file = note_file(root, name)?;
    match fs::remove_file(file) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_notes_as_markdown() {
        let dir = tempfile::tempdir().unwrap();
        let name = create_note(dir.path(), "Idées", "# Titre\n\n- normal map").unwrap();
        assert_eq!(name, "Idées");
        assert_eq!(fs::read_to_string(dir.path().join(".tessera/notes/Idées.md")).unwrap(), "# Titre\n\n- normal map");
        assert!(read_note(dir.path(), "Idées").unwrap().contains("normal map"));
    }

    #[test]
    fn never_overwrites_on_create() {
        let dir = tempfile::tempdir().unwrap();
        create_note(dir.path(), "Todo", "").unwrap();
        assert_eq!(create_note(dir.path(), "todo", "").unwrap(), "todo 2");
        assert_eq!(list_notes(dir.path()).into_iter().map(|n| n.name).collect::<Vec<_>>(), vec!["Todo", "todo 2"]);
    }

    #[test]
    fn updates_deletes_and_lists() {
        let dir = tempfile::tempdir().unwrap();
        write_note(dir.path(), "b", "x").unwrap();
        write_note(dir.path(), "a", "yy").unwrap();
        assert_eq!(list_notes(dir.path()).into_iter().map(|n| (n.name, n.size)).collect::<Vec<_>>(), vec![("a".to_string(), 2), ("b".to_string(), 1)]);
        delete_note(dir.path(), "a").unwrap();
        assert_eq!(list_notes(dir.path()).into_iter().map(|n| n.name).collect::<Vec<_>>(), vec!["b"]);
    }

    #[test]
    fn refuses_escaping_names() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(write_note(dir.path(), "../escape", "x").unwrap_err().0, "invalid note name");
        assert_eq!(write_note(dir.path(), "..", "x").unwrap_err().0, "invalid note name");
        assert_eq!(read_note(dir.path(), "a/b").unwrap_err().0, "invalid note name");
        assert!(list_notes(dir.path()).is_empty());
    }
}
