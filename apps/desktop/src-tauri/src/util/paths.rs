use std::ffi::OsString;
use std::io;
use std::path::{Component, Path, PathBuf};

pub fn realpath(path: &Path) -> io::Result<PathBuf> {
    dunce::canonicalize(path)
}

pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                let popped = matches!(out.components().next_back(), Some(Component::Normal(_)));
                if popped {
                    out.pop();
                } else if !out.has_root() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

pub fn resolve(root: &Path, path: &str) -> PathBuf {
    let path = if path.is_empty() { "." } else { path };
    normalize(&root.join(path))
}

fn key(component: &Component<'_>) -> OsString {
    let raw = component.as_os_str();
    if cfg!(windows) {
        OsString::from(raw.to_string_lossy().to_lowercase())
    } else {
        raw.to_owned()
    }
}

pub fn relative_parts(root: &Path, target: &Path) -> Option<Vec<String>> {
    let root = normalize(root);
    let target = normalize(target);
    let mut root_parts = root.components();
    let mut target_parts = target.components();
    loop {
        match (root_parts.next(), target_parts.clone().next()) {
            (None, _) => break,
            (Some(a), Some(b)) if key(&a) == key(&b) => {
                target_parts.next();
            }
            _ => return None,
        }
    }
    Some(target_parts.map(|c| c.as_os_str().to_string_lossy().into_owned()).collect())
}

pub fn inside(root: &Path, target: &Path) -> bool {
    matches!(relative_parts(root, target), Some(parts) if !parts.is_empty())
}

pub fn inside_or_same(root: &Path, target: &Path) -> bool {
    relative_parts(root, target).is_some()
}

pub fn relative_slash(root: &Path, target: &Path) -> String {
    relative_parts(root, target).map(|parts| parts.join("/")).unwrap_or_default()
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    let a = normalize(a);
    let b = normalize(b);
    let a: Vec<_> = a.components().map(|c| key(&c)).collect();
    let b: Vec<_> = b.components().map(|c| key(&c)).collect();
    a == b
}

pub fn from_slash(root: &Path, rel: &str) -> PathBuf {
    let mut out = root.to_path_buf();
    for part in rel.split('/') {
        out.push(part);
    }
    out
}

pub fn has_parent_segment(path: &str) -> bool {
    path.split(['\\', '/']).any(|part| part == "..")
}

pub fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

pub fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_and_inside() {
        let root = Path::new("/a/b");
        assert!(inside(root, Path::new("/a/b/c")));
        assert!(!inside(root, Path::new("/a/b")));
        assert!(inside_or_same(root, Path::new("/a/b")));
        assert!(!inside(root, &resolve(root, "../c")));
        assert!(!inside(root, Path::new("/a/bc")));
        assert_eq!(relative_slash(root, Path::new("/a/b/c/d.txt")), "c/d.txt");
    }
}
