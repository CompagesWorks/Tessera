use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::schema::requests::SafeReason;
use crate::util::{json, Result};

pub const CRASHES_BEFORE_SAFE_MODE: u32 = 2;

#[derive(Serialize, Deserialize)]
struct Marker {
    pending: u32,
}

pub fn safe_reason_from_args(args: &[String]) -> Option<SafeReason> {
    if !args.iter().any(|a| a == "--safe-mode") {
        return None;
    }
    let reason = args.iter().find_map(|a| a.strip_prefix("--safe-reason=")).and_then(|r| r.split('=').next());
    Some(reason.and_then(SafeReason::parse).unwrap_or(SafeReason::Flag))
}

pub fn restart_args(args: &[String], safe: Option<SafeReason>) -> Vec<String> {
    let mut kept: Vec<String> = args.iter().filter(|a| *a != "--safe-mode" && !a.starts_with("--safe-reason=")).cloned().collect();
    if let Some(reason) = safe {
        kept.push("--safe-mode".into());
        kept.push(format!("--safe-reason={}", reason.as_str()));
    }
    kept
}

pub struct StartupGuard {
    file: PathBuf,
}

impl StartupGuard {
    pub fn new(file: PathBuf) -> Self {
        StartupGuard { file }
    }

    pub fn begin(&self) -> u32 {
        let pending = json::read(&self.file, |v| Ok(serde_json::from_value::<Marker>(v)?)).map(|m| m.pending).unwrap_or(0);
        let _ = json::write(&self.file, &Marker { pending: pending + 1 });
        pending
    }

    pub fn done(&self) -> Result<()> {
        json::write(&self.file, &Marker { pending: 0 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn reads_safe_mode_flags() {
        assert_eq!(safe_reason_from_args(&args(&["app"])), None);
        assert_eq!(safe_reason_from_args(&args(&["app", "--safe-mode"])), Some(SafeReason::Flag));
        assert_eq!(safe_reason_from_args(&args(&["--safe-mode", "--safe-reason=crash"])), Some(SafeReason::Crash));
        assert_eq!(safe_reason_from_args(&args(&["--safe-mode", "--safe-reason=nope"])), Some(SafeReason::Flag));
    }

    #[test]
    fn builds_restart_args() {
        assert_eq!(restart_args(&args(&["--x", "--safe-mode", "--safe-reason=flag"]), None), args(&["--x"]));
        assert_eq!(restart_args(&args(&["--x"]), Some(SafeReason::Shift)), args(&["--x", "--safe-mode", "--safe-reason=shift"]));
    }

    #[test]
    fn counts_unfinished_starts() {
        let dir = tempfile::tempdir().unwrap();
        let guard = StartupGuard::new(dir.path().join("startup.json"));
        assert_eq!(guard.begin(), 0);
        assert_eq!(guard.begin(), 1);
        guard.done().unwrap();
        assert_eq!(guard.begin(), 0);
    }
}
