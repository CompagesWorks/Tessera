use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::projects::files_list::{sort_entries, DirEntry, MAX_ENTRIES};
use crate::schema::plugins::{MAX_BINARY_BYTES, MAX_TEXT_READ, MAX_TEXT_WRITE};
use crate::util::paths::{inside_or_same, realpath, relative_slash, resolve};
use crate::util::{Error, Result};

pub type Trash = Arc<dyn Fn(&Path) -> Result<()> + Send + Sync>;

#[derive(Clone)]
pub struct Scope {
    pub root: PathBuf,
    pub hidden: Option<String>,
    pub trash: Option<Trash>,
}

fn outside() -> Error {
    Error::new("outside scope")
}

fn first(rel: &str) -> &str {
    rel.split('/').next().unwrap_or_default()
}

fn nearest_existing(path: &Path) -> Result<PathBuf> {
    let mut current = path.to_path_buf();
    loop {
        if let Ok(real) = realpath(&current) {
            return Ok(real);
        }
        match current.parent() {
            Some(parent) if parent != current => current = parent.to_path_buf(),
            _ => return Err(outside()),
        }
    }
}

struct Located {
    root: PathBuf,
    target: PathBuf,
}

fn locate(scope: &Scope, path: &str, allow_root: bool) -> Result<Located> {
    let root = realpath(&scope.root)?;
    let target = resolve(&root, path);
    if !inside_or_same(&root, &target) {
        return Err(outside());
    }
    let rel = relative_slash(&root, &target);
    if !allow_root && rel.is_empty() {
        return Err(outside());
    }
    if scope.hidden.as_deref().is_some_and(|h| first(&rel) == h) {
        return Err(outside());
    }
    let real = nearest_existing(&target)?;
    if !inside_or_same(&root, &real) {
        return Err(outside());
    }
    if scope.hidden.as_deref().is_some_and(|h| first(&relative_slash(&root, &real)) == h) {
        return Err(outside());
    }
    Ok(Located { root, target })
}

fn existing(scope: &Scope, path: &str, allow_root: bool) -> Result<(Located, PathBuf)> {
    let located = locate(scope, path, allow_root)?;
    let real = realpath(&located.target)?;
    if !inside_or_same(&located.root, &real) {
        return Err(outside());
    }
    Ok((located, real))
}

pub fn scoped_list(scope: &Scope, path: &str) -> Result<Vec<DirEntry>> {
    let (located, real) = existing(scope, path, true)?;
    let mut result = vec![];
    for entry in fs::read_dir(&real)?.flatten().take(MAX_ENTRIES) {
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() || (!kind.is_file() && !kind.is_dir()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let full = real.join(&name);
        let rel = relative_slash(&located.root, &full);
        if scope.hidden.as_deref().is_some_and(|h| first(&rel) == h) {
            continue;
        }
        let size = if kind.is_file() { fs::metadata(&full).map(|m| m.len()).unwrap_or(0) } else { 0 };
        result.push(DirEntry { name, path: rel, kind: if kind.is_dir() { "dir" } else { "file" }, size });
    }
    sort_entries(&mut result);
    Ok(result)
}

pub fn scoped_read_text(scope: &Scope, path: &str) -> Result<String> {
    let (_, real) = existing(scope, path, false)?;
    let info = fs::metadata(&real)?;
    if !info.is_file() || info.len() > MAX_TEXT_READ {
        return Err(Error::new("file too large"));
    }
    Ok(String::from_utf8_lossy(&fs::read(&real)?).into_owned())
}

pub fn scoped_read_bytes(scope: &Scope, path: &str) -> Result<Vec<u8>> {
    let (_, real) = existing(scope, path, false)?;
    let info = fs::metadata(&real)?;
    if !info.is_file() || info.len() > MAX_BINARY_BYTES {
        return Err(Error::new("file too large"));
    }
    Ok(fs::read(&real)?)
}

pub fn write(scope: &Scope, path: &str, data: &[u8]) -> Result<()> {
    let located = locate(scope, path, false)?;
    if let Ok(info) = fs::symlink_metadata(&located.target) {
        if !info.is_file() {
            return Err(Error::new("not a file"));
        }
    }
    let parent = located.target.parent().ok_or_else(outside)?;
    fs::create_dir_all(parent)?;
    if !inside_or_same(&located.root, &realpath(parent)?) {
        return Err(outside());
    }
    fs::write(&located.target, data)?;
    Ok(())
}

pub fn scoped_write_text(scope: &Scope, path: &str, content: &str) -> Result<()> {
    if content.len() > MAX_TEXT_WRITE {
        return Err(Error::new("file too large"));
    }
    write(scope, path, content.as_bytes())
}

pub fn scoped_write_bytes(scope: &Scope, path: &str, data: &[u8]) -> Result<()> {
    if data.len() as u64 > MAX_BINARY_BYTES {
        return Err(Error::new("file too large"));
    }
    write(scope, path, data)
}

pub fn scoped_reveal(scope: &Scope, path: &str) -> Result<PathBuf> {
    Ok(existing(scope, path, true)?.0.target)
}

pub fn scoped_mkdir(scope: &Scope, path: &str) -> Result<()> {
    let located = locate(scope, path, false)?;
    fs::create_dir_all(&located.target)?;
    if !inside_or_same(&located.root, &realpath(&located.target)?) {
        return Err(outside());
    }
    Ok(())
}

pub fn scoped_remove(scope: &Scope, path: &str) -> Result<()> {
    let (located, _) = existing(scope, path, false)?;
    let info = fs::symlink_metadata(&located.target)?;
    if info.file_type().is_symlink() {
        return Err(outside());
    }
    match &scope.trash {
        Some(trash) => trash(&located.target),
        None if info.is_dir() => Ok(fs::remove_dir_all(&located.target)?),
        None => Ok(fs::remove_file(&located.target)?),
    }
}

pub fn scoped_rename(scope: &Scope, from: &str, to: &str) -> Result<()> {
    let (source, _) = existing(scope, from, false)?;
    let destination = locate(scope, to, false)?;
    if fs::symlink_metadata(&destination.target).is_ok() {
        return Err(Error::new("already exists"));
    }
    let parent = destination.target.parent().ok_or_else(outside)?;
    fs::create_dir_all(parent)?;
    if !inside_or_same(&destination.root, &realpath(parent)?) {
        return Err(outside());
    }
    fs::rename(&source.target, &destination.target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(root: &Path) -> Scope {
        Scope { root: root.to_path_buf(), hidden: Some(".tessera".into()), trash: None }
    }

    #[test]
    fn stays_inside_and_hides_tessera() {
        let dir = tempfile::tempdir().unwrap();
        let s = scope(dir.path());
        fs::create_dir(dir.path().join(".tessera")).unwrap();
        scoped_write_text(&s, "a/b.txt", "hi").unwrap();
        assert_eq!(scoped_read_text(&s, "a/b.txt").unwrap(), "hi");
        assert_eq!(scoped_list(&s, "").unwrap().iter().map(|e| e.name.clone()).collect::<Vec<_>>(), vec!["a"]);
        assert_eq!(scoped_write_text(&s, "../x.txt", "no").unwrap_err().0, "outside scope");
        assert_eq!(scoped_read_text(&s, ".tessera/project.json").unwrap_err().0, "outside scope");
        assert_eq!(scoped_remove(&s, "").unwrap_err().0, "outside scope");
        scoped_rename(&s, "a/b.txt", "c.txt").unwrap();
        assert_eq!(scoped_rename(&s, "c.txt", "c.txt").unwrap_err().0, "already exists");
        scoped_remove(&s, "c.txt").unwrap();
        assert!(!dir.path().join("c.txt").exists());
    }

    #[cfg(windows)]
    #[test]
    fn refuses_junction_escape() {
        let dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        fs::write(outside_dir.path().join("secret.txt"), "x").unwrap();
        let status = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(dir.path().join("escape")).arg(outside_dir.path()).output().unwrap();
        assert!(status.status.success());
        let s = scope(dir.path());
        assert_eq!(scoped_read_text(&s, "escape/secret.txt").unwrap_err().0, "outside scope");
        assert_eq!(scoped_write_text(&s, "escape/new.txt", "x").unwrap_err().0, "outside scope");
        assert!(scoped_list(&s, "").unwrap().is_empty());
    }
}
