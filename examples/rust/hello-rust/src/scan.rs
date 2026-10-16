use std::collections::BTreeMap;

use tessera_plugin::files;

pub struct Summary {
    pub files: usize,
    pub bytes: u64,
    pub extensions: BTreeMap<String, usize>,
}

impl Summary {
    pub fn lines(&self) -> Vec<String> {
        let mut lines = vec![format!("{} fichier(s), {}", self.files, human(self.bytes))];
        let mut sorted: Vec<(&String, &usize)> = self.extensions.iter().collect();
        sorted.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
        lines.extend(sorted.into_iter().take(5).map(|(ext, count)| format!(".{ext} : {count}")));
        lines
    }
}

fn human(bytes: u64) -> String {
    match bytes {
        b if b >= 1 << 20 => format!("{:.1} Mo", b as f64 / (1u64 << 20) as f64),
        b if b >= 1 << 10 => format!("{:.1} Ko", b as f64 / (1u64 << 10) as f64),
        b => format!("{b} o"),
    }
}

pub async fn summarize(root: &str) -> tessera_plugin::Result<Summary> {
    let mut summary = Summary { files: 0, bytes: 0, extensions: BTreeMap::new() };
    let mut pending = vec![root.to_string()];
    while let Some(dir) = pending.pop() {
        for entry in files::project().list(&dir).await? {
            if entry.is_dir() {
                pending.push(entry.path);
                continue;
            }
            summary.files += 1;
            summary.bytes += entry.size;
            let ext = entry.name.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_else(|| "sans extension".into());
            *summary.extensions.entry(ext).or_default() += 1;
        }
    }
    Ok(summary)
}
