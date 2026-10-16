use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde_json::Map;

use crate::schema::layout::{default_layout, LayoutNode, ProjectLayout, Workspace};
use crate::util::{json, Result};

use super::files::TESSERA_DIR;

pub fn layout_file(root: &Path) -> PathBuf {
    root.join(TESSERA_DIR).join("layout.json")
}

struct Fixer<'a> {
    layout: &'a ProjectLayout,
    seen: HashSet<String>,
    used: Vec<String>,
}

impl Fixer<'_> {
    fn fix(&mut self, node: &LayoutNode) -> Option<LayoutNode> {
        if !self.seen.insert(node.id().to_string()) {
            return None;
        }
        match node {
            LayoutNode::Panel { id, tabs, active } => {
                let mut kept: Vec<String> = vec![];
                for tab in tabs {
                    if !kept.contains(tab) && self.layout.has_widget(tab) && !self.used.contains(tab) {
                        kept.push(tab.clone());
                    }
                }
                self.used.extend(kept.iter().cloned());
                let max = kept.len().saturating_sub(1) as u32;
                Some(LayoutNode::Panel { id: id.clone(), active: (*active).min(max), tabs: kept })
            }
            LayoutNode::Split { id, dir, sizes, children } => {
                let mut kept_children = vec![];
                let mut kept_sizes = vec![];
                for (index, child) in children.iter().enumerate() {
                    if let Some(fixed) = self.fix(child) {
                        kept_children.push(fixed);
                        kept_sizes.push(sizes.get(index).copied().unwrap_or(1.0));
                    }
                }
                match kept_children.len() {
                    0 => None,
                    1 => kept_children.pop(),
                    _ => Some(LayoutNode::Split { id: id.clone(), dir: dir.clone(), sizes: kept_sizes, children: kept_children }),
                }
            }
        }
    }
}

pub fn normalize_layout(layout: &ProjectLayout) -> ProjectLayout {
    let mut fixer = Fixer { layout, seen: HashSet::new(), used: vec![] };
    let mut workspaces = vec![];
    for workspace in &layout.workspaces {
        if !fixer.seen.insert(workspace.id.clone()) {
            continue;
        }
        let root = fixer.fix(&workspace.root).unwrap_or_else(|| LayoutNode::Panel { id: format!("p-{}", workspace.id), tabs: vec![], active: 0 });
        workspaces.push(Workspace { root, ..workspace.clone() });
    }
    if workspaces.is_empty() {
        return default_layout();
    }
    let mut widgets = Map::new();
    for (id, widget) in &layout.widgets {
        if fixer.used.contains(id) {
            widgets.insert(id.clone(), widget.clone());
        }
    }
    let active = if workspaces.iter().any(|w| w.id == layout.active) { layout.active.clone() } else { workspaces[0].id.clone() };
    ProjectLayout { format_version: 1, active, workspaces, widgets }
}

pub fn read_layout(root: &Path, template: Option<&ProjectLayout>) -> ProjectLayout {
    if let Some(layout) = json::read(&layout_file(root), ProjectLayout::parse) {
        return normalize_layout(&layout);
    }
    template.map(normalize_layout).unwrap_or_else(default_layout)
}

pub fn write_layout(root: &Path, layout: &ProjectLayout) -> Result<()> {
    json::write(&layout_file(root), &normalize_layout(layout))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::layout::SplitDir;
    use serde_json::json;

    fn panel(id: &str, tabs: &[&str], active: u32) -> LayoutNode {
        LayoutNode::Panel { id: id.into(), tabs: tabs.iter().map(|s| s.to_string()).collect(), active }
    }

    #[test]
    fn drops_missing_duplicate_and_unused_widgets() {
        let mut layout = default_layout();
        layout.active = "nope".into();
        layout.workspaces = vec![Workspace {
            id: "ws-a".into(),
            name: "A".into(),
            icon: "grid".into(),
            root: LayoutNode::Split { id: "s-1".into(), dir: SplitDir::Row, sizes: vec![30.0, 70.0], children: vec![panel("p-1", &["w-1", "w-ghost", "w-1"], 5), panel("p-2", &["w-1"], 0)] },
        }];
        layout.widgets.insert("w-1".into(), json!({ "type": "core/notes", "state": {} }));
        layout.widgets.insert("w-unused".into(), json!({ "type": "core/notes", "state": {} }));
        let result = normalize_layout(&layout);
        assert_eq!(result.active, "ws-a");
        assert_eq!(result.widgets.keys().cloned().collect::<Vec<_>>(), vec!["w-1".to_string()]);
        let LayoutNode::Split { children, .. } = &result.workspaces[0].root else { panic!("split expected") };
        assert_eq!(children[0], panel("p-1", &["w-1"], 0));
        assert_eq!(children[1], panel("p-2", &[], 0));
    }

    #[test]
    fn collapses_split_with_one_child() {
        let mut layout = default_layout();
        layout.workspaces[0].root = LayoutNode::Split { id: "s-1".into(), dir: SplitDir::Row, sizes: vec![50.0, 50.0], children: vec![panel("p-1", &[], 0), panel("p-1", &[], 0)] };
        assert_eq!(normalize_layout(&layout).workspaces[0].root, panel("p-1", &[], 0));
    }

    #[test]
    fn round_trips_and_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_layout(dir.path(), None), default_layout());
        std::fs::create_dir_all(dir.path().join(".tessera")).unwrap();
        std::fs::write(layout_file(dir.path()), "{ broken").unwrap();
        assert_eq!(read_layout(dir.path(), None), default_layout());
        let mut layout = default_layout();
        layout.widgets.insert("w-1".into(), json!({ "type": "core/notes", "state": { "text": "hi" } }));
        layout.workspaces[0].root = panel("p-main", &["w-1"], 0);
        write_layout(dir.path(), &layout).unwrap();
        assert_eq!(read_layout(dir.path(), None), layout);
    }
}
