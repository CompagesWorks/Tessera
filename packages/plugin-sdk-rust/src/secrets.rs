use crate::bridge::{self, run, text};
use crate::error::Result;

pub async fn get(key: &str) -> Result<Option<String>> {
    bridge::get(&["secrets", "get"], &[text(key)]).await
}

pub async fn set(key: &str, value: &str) -> Result<()> {
    run(&["secrets", "set"], &[text(key), text(value)]).await
}

pub async fn delete(key: &str) -> Result<()> {
    run(&["secrets", "delete"], &[text(key)]).await
}

pub async fn keys() -> Result<Vec<String>> {
    bridge::get(&["secrets", "keys"], &[]).await
}
