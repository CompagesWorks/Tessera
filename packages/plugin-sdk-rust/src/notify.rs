use crate::bridge::{run, text};
use crate::error::Result;

pub async fn show(title: &str, body: &str) -> Result<()> {
    run(&["notify", "show"], &[text(title), text(body)]).await
}
