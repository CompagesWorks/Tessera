use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::schema::tools::{FileIndex, SearchMatch, SearchResponse, SearchResult};
use crate::util::collate::compare_numeric;
use crate::util::paths::relative_slash;

use super::files::TESSERA_DIR;
use super::notes::notes_dir;

pub const MAX_SCANNED: usize = 30_000;
pub const MAX_CONTENT_BYTES: u64 = 512 * 1024;
pub const SEARCH_BUDGET_MS: i64 = 4000;
pub const MAX_INDEXED: usize = 5000;
const MAX_MATCHES: usize = 3;
const MAX_LINE: usize = 200;
const SKIPPED_DIRS: [&str; 2] = [".git", "node_modules"];
const TEXT_EXTENSIONS: [&str; 19] = ["txt", "md", "json", "toml", "xml", "yml", "yaml", "csv", "ini", "cfg", "conf", "lua", "js", "ts", "html", "css", "log", "tsv", "svg"];

pub struct SearchOptions {
    pub query: String,
    pub content: bool,
    pub limit: usize,
    pub budget_ms: i64,
}

struct Candidate {
    result: SearchResult,
    rank: i32,
}

fn extension_of(name: &str) -> String {
    name.rfind('.').map(|i| name[i + 1..].to_lowercase()).unwrap_or_default()
}

fn read_head(path: &Path, size: u64) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut buffer = vec![0u8; size.min(MAX_CONTENT_BYTES) as usize];
    let mut read = 0;
    while read < buffer.len() {
        match file.read(&mut buffer[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(_) => return None,
        }
    }
    buffer.truncate(read);
    if buffer[..buffer.len().min(4096)].contains(&0) {
        return None;
    }
    Some(String::from_utf8_lossy(&buffer).into_owned())
}

fn truncate16(text: &str, max: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().take(max).collect();
    String::from_utf16_lossy(&units)
}

fn match_lines(text: &str, needle: &str) -> Vec<SearchMatch> {
    let mut matches = vec![];
    for (index, line) in text.split('\n').enumerate() {
        if matches.len() >= MAX_MATCHES {
            break;
        }
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.to_lowercase().contains(needle) {
            matches.push(SearchMatch { line: index + 1, text: truncate16(line.trim(), MAX_LINE) });
        }
    }
    matches
}

fn deadline(budget_ms: i64) -> Option<Instant> {
    if budget_ms < 0 {
        None
    } else {
        Some(Instant::now() + Duration::from_millis(budget_ms as u64))
    }
}

fn expired(deadline: Option<Instant>) -> bool {
    deadline.is_none_or(|d| Instant::now() > d)
}

fn sorted_entries(dir: &Path) -> Vec<fs::DirEntry> {
    fs::read_dir(dir).map(|it| it.flatten().collect()).unwrap_or_default()
}

pub fn search_project(root: &Path, options: &SearchOptions) -> SearchResponse {
    let needle = options.query.trim().to_lowercase();
    let tokens: Vec<&str> = needle.split_whitespace().collect();
    let deadline = deadline(options.budget_ms);
    let mut found: Vec<Candidate> = vec![];
    let mut scanned = 0usize;
    let mut truncated = false;

    let name_rank = |path: &str, name: &str| -> i32 {
        let lower = name.to_lowercase();
        if lower == needle {
            return 0;
        }
        if lower.starts_with(&needle) {
            return 1;
        }
        if lower.contains(&needle) {
            return 2;
        }
        let lower_path = path.to_lowercase();
        if tokens.iter().all(|t| lower_path.contains(t)) {
            3
        } else {
            -1
        }
    };

    let visit = |found: &mut Vec<Candidate>, full: &Path, name: &str, kind: &'static str, label: &str, size: u64| {
        let path = relative_slash(root, full);
        let rank = name_rank(&if label == name { path.clone() } else { format!("{path} {label}") }, label);
        let mut matches = vec![];
        if options.content && kind != "dir" && size > 0 && size <= MAX_CONTENT_BYTES && (kind == "note" || TEXT_EXTENSIONS.contains(&extension_of(name).as_str())) {
            if let Some(text) = read_head(full, size) {
                matches = match_lines(&text, &needle);
            }
        }
        if rank < 0 && matches.is_empty() {
            return;
        }
        found.push(Candidate { result: SearchResult { path, name: label.to_string(), kind, size, name_hit: rank >= 0, matches }, rank: if rank >= 0 { rank } else { 10 } });
    };

    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    'walk: while let Some(dir) = stack.pop() {
        for entry in sorted_entries(&dir) {
            if expired(deadline) || scanned >= MAX_SCANNED {
                truncated = true;
                break 'walk;
            }
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let full = dir.join(&name);
            if kind.is_dir() {
                if SKIPPED_DIRS.contains(&name.as_str()) || (dir == root && name == TESSERA_DIR) {
                    continue;
                }
                scanned += 1;
                stack.push(full.clone());
                visit(&mut found, &full, &name, "dir", &name, 0);
            } else if kind.is_file() {
                scanned += 1;
                let size = fs::metadata(&full).map(|m| m.len()).unwrap_or(0);
                visit(&mut found, &full, &name, "file", &name, size);
            }
        }
    }

    if !truncated {
        for entry in sorted_entries(&notes_dir(root)) {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) || !name.to_lowercase().ends_with(".md") {
                continue;
            }
            let full = notes_dir(root).join(&name);
            let size = fs::metadata(&full).map(|m| m.len()).unwrap_or(0);
            scanned += 1;
            let label = name[..name.len() - 3].to_string();
            visit(&mut found, &full, &name, "note", &label, size);
        }
    }

    found.sort_by(|a, b| a.rank.cmp(&b.rank).then_with(|| compare_numeric(&a.result.path, &b.result.path)));
    let total = found.len();
    SearchResponse { results: found.into_iter().take(options.limit).map(|c| c.result).collect(), scanned, truncated: truncated || total > options.limit }
}

pub fn list_project_files(root: &Path, limit: usize, budget_ms: i64) -> FileIndex {
    let mut files = vec![];
    let deadline = deadline(budget_ms);
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    let mut truncated = false;
    'walk: while let Some(dir) = stack.pop() {
        for entry in sorted_entries(&dir) {
            if files.len() >= limit || expired(deadline) {
                truncated = true;
                break 'walk;
            }
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if kind.is_dir() {
                if !(SKIPPED_DIRS.contains(&name.as_str()) || (dir == root && name == TESSERA_DIR)) {
                    stack.push(dir.join(&name));
                }
            } else if kind.is_file() {
                files.push(relative_slash(root, &dir.join(&name)));
            }
        }
    }
    for entry in sorted_entries(&notes_dir(root)) {
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) && name.to_lowercase().ends_with(".md") {
            files.push(format!("{TESSERA_DIR}/notes/{name}"));
        }
    }
    files.sort_by(|a, b| compare_numeric(a, b));
    FileIndex { files, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::notes::create_note;

    fn setup() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("sounds")).unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::write(root.join("mario_body.png"), [0x89, 0x50, 0, 0]).unwrap();
        fs::write(root.join("sounds").join("jump.txt"), "line one\nthe Mario jump sound\nlast").unwrap();
        fs::write(root.join("node_modules").join("mario.txt"), "mario").unwrap();
        fs::write(root.join("bin.dat"), [0, 1, 2, 3, 109, 97, 114, 105, 111]).unwrap();
        dir
    }

    fn run(root: &Path, query: &str, content: bool) -> SearchResponse {
        search_project(root, &SearchOptions { query: query.into(), content, limit: 50, budget_ms: SEARCH_BUDGET_MS })
    }

    #[test]
    fn finds_by_name_and_content() {
        let dir = setup();
        let names = run(dir.path(), "MARIO", false);
        assert_eq!(names.results.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(), vec!["mario_body.png"]);
        let content = run(dir.path(), "the Mario jump", true);
        let hit = content.results.iter().find(|r| r.path == "sounds/jump.txt").unwrap();
        assert_eq!(hit.matches.len(), 1);
        assert_eq!(hit.matches[0].line, 2);
        assert_eq!(hit.matches[0].text, "the Mario jump sound");
        assert!(!hit.name_hit);
    }

    #[test]
    fn skips_binary_node_modules_and_tessera() {
        let dir = setup();
        fs::create_dir(dir.path().join(".tessera")).unwrap();
        fs::write(dir.path().join(".tessera").join("project.json"), "{\"mario\":1}").unwrap();
        let paths: Vec<String> = run(dir.path(), "mario", true).results.into_iter().map(|r| r.path).collect();
        assert!(paths.contains(&"mario_body.png".to_string()));
        assert!(!paths.contains(&"bin.dat".to_string()));
        assert!(!paths.iter().any(|p| p.starts_with("node_modules") || p.starts_with(".tessera/project")));
    }

    #[test]
    fn searches_notes() {
        let dir = setup();
        create_note(dir.path(), "Idées", "refaire la normal map de Mario").unwrap();
        let response = run(dir.path(), "normal map", true);
        let note = response.results.iter().find(|r| r.kind == "note").unwrap();
        assert_eq!(note.name, "Idées");
        assert_eq!(note.path, ".tessera/notes/Idées.md");
        assert_eq!(note.matches[0].line, 1);
    }

    #[test]
    fn ranks_exact_first_and_truncates() {
        let dir = setup();
        fs::write(dir.path().join("mario"), "x").unwrap();
        let response = search_project(dir.path(), &SearchOptions { query: "mario".into(), content: false, limit: 1, budget_ms: SEARCH_BUDGET_MS });
        assert_eq!(response.results[0].path, "mario");
        assert!(response.truncated);
        let spent = search_project(dir.path(), &SearchOptions { query: "mario".into(), content: true, limit: 10, budget_ms: -1 });
        assert!(spent.truncated);
    }
}
