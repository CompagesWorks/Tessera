use crate::bridge::{run, text};
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Toast {
    Success,
    Info,
    Warning,
    Error,
}

impl Toast {
    fn as_str(&self) -> &'static str {
        match self {
            Toast::Success => "success",
            Toast::Info => "info",
            Toast::Warning => "warning",
            Toast::Error => "error",
        }
    }
}

pub async fn toast(kind: Toast, message: &str) -> Result<()> {
    run(&["ui", "toast"], &[text(kind.as_str()), text(message)]).await
}
