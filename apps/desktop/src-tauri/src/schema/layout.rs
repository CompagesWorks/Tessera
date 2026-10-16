use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::check::{self, fail, matches, NODE_ID, WIDGET_TYPE};
use crate::util::Result;

pub const MAX_LAYOUT_BYTES: usize = 512 * 1024;
pub const MAX_NOTE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitDir {
    Row,
    Col,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum LayoutNode {
    Panel {
        id: String,
        tabs: Vec<String>,
        active: u32,
    },
    Split {
        id: String,
        dir: SplitDir,
        sizes: Vec<f64>,
        children: Vec<LayoutNode>,
    },
}

impl LayoutNode {
    pub fn id(&self) -> &str {
        match self {
            LayoutNode::Panel { id, .. } | LayoutNode::Split { id, .. } => id,
        }
    }

    fn validate(&self, path: &str) -> Result<()> {
        match self {
            LayoutNode::Panel { id, tabs, .. } => {
                matches(&format!("{path}.id"), &NODE_ID, id)?;
                if tabs.len() > 32 {
                    return fail(&format!("{path}.tabs"), "too many tabs");
                }
                for tab in tabs {
                    matches(&format!("{path}.tabs"), &NODE_ID, tab)?;
                }
            }
            LayoutNode::Split { id, sizes, children, .. } => {
                matches(&format!("{path}.id"), &NODE_ID, id)?;
                if !(2..=12).contains(&sizes.len()) || sizes.iter().any(|s| s.is_nan() || *s <= 0.0 || !s.is_finite()) {
                    return fail(&format!("{path}.sizes"), "invalid sizes");
                }
                if !(2..=12).contains(&children.len()) {
                    return fail(&format!("{path}.children"), "invalid children");
                }
                for (index, child) in children.iter().enumerate() {
                    child.validate(&format!("{path}.children.{index}"))?;
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WidgetInstance {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub state: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub root: LayoutNode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLayout {
    pub format_version: u8,
    pub active: String,
    pub workspaces: Vec<Workspace>,
    pub widgets: Map<String, Value>,
}

impl ProjectLayout {
    pub fn parse(value: Value) -> Result<Self> {
        let mut layout: ProjectLayout = serde_json::from_value(value)?;
        layout.validate()?;
        Ok(layout)
    }

    pub fn validate(&mut self) -> Result<()> {
        if self.format_version != 1 {
            return fail("formatVersion", "invalid version");
        }
        matches("active", &NODE_ID, &self.active)?;
        if !(1..=30).contains(&self.workspaces.len()) {
            return fail("workspaces", "invalid count");
        }
        for (index, workspace) in self.workspaces.iter_mut().enumerate() {
            let path = format!("workspaces.{index}");
            matches(&format!("{path}.id"), &NODE_ID, &workspace.id)?;
            check::trimmed(&format!("{path}.name"), &mut workspace.name, 1, 40)?;
            matches(&format!("{path}.icon"), &check::ICON, &workspace.icon)?;
            workspace.root.validate(&format!("{path}.root"))?;
        }
        let mut widgets = Map::new();
        for (id, value) in std::mem::take(&mut self.widgets) {
            matches("widgets", &NODE_ID, &id)?;
            let widget: WidgetInstance = serde_json::from_value(value).map_err(|e| crate::util::Error::new(format!("widgets.{id}: {e}")))?;
            matches(&format!("widgets.{id}.type"), &WIDGET_TYPE, &widget.kind)?;
            widgets.insert(id, serde_json::to_value(widget)?);
        }
        self.widgets = widgets;
        Ok(())
    }

    pub fn has_widget(&self, id: &str) -> bool {
        self.widgets.contains_key(id)
    }
}

pub fn default_layout() -> ProjectLayout {
    ProjectLayout {
        format_version: 1,
        active: "ws-main".into(),
        workspaces: vec![Workspace {
            id: "ws-main".into(),
            name: "Principal".into(),
            icon: "grid-1x2".into(),
            root: LayoutNode::Panel { id: "p-main".into(), tabs: vec![], active: 0 },
        }],
        widgets: Map::new(),
    }
}
