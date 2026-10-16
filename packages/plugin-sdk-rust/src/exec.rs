use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::bridge::{get, text, to_js};
use crate::error::Result;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[derive(Serialize)]
struct Options {
    #[serde(skip_serializing_if = "Option::is_none")]
    timeout: Option<u64>,
}

pub async fn run(args: &[&str], timeout_ms: Option<u64>) -> Result<Output> {
    get(&["exec", "run"], &[to_js(args)?, to_js(&Options { timeout: timeout_ms })?]).await
}

pub async fn run_system(program: &str, args: &[&str], timeout_ms: Option<u64>) -> Result<Output> {
    get(&["exec", "runSystem"], &[text(program), to_js(args)?, to_js(&Options { timeout: timeout_ms })?]).await
}

pub async fn pick_system(program: &str) -> Result<bool> {
    get(&["exec", "pickSystem"], &[text(program)]).await
}

pub async fn system_info() -> Result<BTreeMap<String, bool>> {
    get(&["exec", "systemInfo"], &[]).await
}
