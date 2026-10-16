use crate::bridge::{run, text};
use crate::error::Result;

pub async fn write_text(value: &str) -> Result<()> {
    run(&["clipboard", "writeText"], &[text(value)]).await
}
