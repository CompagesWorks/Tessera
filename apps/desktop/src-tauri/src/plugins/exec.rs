use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::LazyLock;
use std::thread;
use std::time::{Duration, Instant};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::schema::check;
use crate::schema::plugins::{ExecProgram, SystemProgram};
use crate::util::paths::{inside, realpath, resolve};
use crate::util::{Error, Result};

use super::package::hash_file;

const MAX_OUTPUT: usize = 1024 * 1024;
const DEFAULT_TIMEOUT: u64 = 60_000;
const MAX_TIMEOUT: u64 = 10 * 60_000;
static SAFE_ARG: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9_./:=@\\-]+$").unwrap());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecParams {
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    #[serde(default)]
    pub program: Option<String>,
}

fn default_timeout() -> u64 {
    DEFAULT_TIMEOUT
}

impl ExecParams {
    pub fn parse(value: Value, with_program: bool) -> Result<ExecParams> {
        let params: ExecParams = serde_json::from_value(value)?;
        if params.args.len() > 64 || params.args.iter().any(|a| check::len(a) > 2000 || a.contains('\0')) {
            return Err(Error::new("invalid argument"));
        }
        if !(1000..=MAX_TIMEOUT).contains(&params.timeout) {
            return Err(Error::new("invalid timeout"));
        }
        match (&params.program, with_program) {
            (Some(name), true) if check::PROGRAM_NAME.is_match(name) => {}
            (None, false) => {}
            _ => return Err(Error::new("invalid program")),
        }
        Ok(params)
    }
}

fn exec_error(message: &str) -> Error {
    Error::new(message)
}

fn windows_exe(path: &Path) -> bool {
    !cfg!(windows) || path.extension().map(|e| e.eq_ignore_ascii_case("exe") || e.eq_ignore_ascii_case("com")).unwrap_or(false)
}

pub fn resolve_program(plugin_root: &Path, program: &ExecProgram) -> Result<PathBuf> {
    let root = realpath(plugin_root)?;
    let real = realpath(&resolve(&root, &program.program)).map_err(|_| exec_error("program not found"))?;
    if !inside(&root, &real) || !std::fs::metadata(&real).map(|m| m.is_file()).unwrap_or(false) {
        return Err(exec_error("program not found"));
    }
    if hash_file(&real)? != program.sha256 {
        return Err(exec_error("program hash mismatch"));
    }
    if !windows_exe(&real) {
        return Err(exec_error("only .exe programs can run on Windows"));
    }
    Ok(real)
}

pub fn describe_program(file: &Path) -> Result<SystemProgram> {
    let real = realpath(file).map_err(|_| exec_error("program not found"))?;
    if !std::fs::metadata(&real).map(|m| m.is_file()).unwrap_or(false) {
        return Err(exec_error("program not found"));
    }
    if !windows_exe(&real) {
        return Err(exec_error("only .exe programs can run on Windows"));
    }
    Ok(SystemProgram { path: real.to_string_lossy().into_owned(), sha256: hash_file(&real)? })
}

pub fn check_system_program(program: &SystemProgram) -> Result<PathBuf> {
    let current = describe_program(Path::new(&program.path))?;
    if current.sha256 != program.sha256 {
        return Err(exec_error("program changed since it was picked, pick it again in Plugins"));
    }
    Ok(PathBuf::from(current.path))
}

pub fn command_line(program: &str, args: &[String]) -> String {
    std::iter::once(program)
        .chain(args.iter().map(String::as_str))
        .map(|value| if SAFE_ARG.is_match(value) { value.to_string() } else { format!("\"{}\"", value.replace('"', "\\\"")) })
        .collect::<Vec<_>>()
        .join(" ")
}

fn safe_env(command: &mut Command) {
    command.env_clear();
    for key in ["PATH", "SystemRoot", "windir", "TEMP", "TMP", "HOME", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            command.env(key, value);
        }
    }
}

fn capped(mut reader: impl Read + Send + 'static) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut kept = Vec::new();
        let mut buffer = [0u8; 8192];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            if kept.len() < MAX_OUTPUT {
                kept.extend_from_slice(&buffer[..n]);
            }
        }
        kept.truncate(MAX_OUTPUT);
        kept
    })
}

pub fn run_program(file: &Path, args: &[String], cwd: &Path, timeout_ms: u64) -> Result<ExecResult> {
    let mut command = Command::new(file);
    command.args(args).current_dir(cwd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    safe_env(&mut command);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| exec_error(&e.to_string()))?;
    let stdout = capped(child.stdout.take().expect("stdout"));
    let stderr = capped(child.stderr.take().expect("stderr"));
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if started.elapsed() >= Duration::from_millis(timeout_ms) {
            timed_out = true;
            let _ = child.kill();
            break child.wait().ok();
        }
        thread::sleep(Duration::from_millis(20));
    };
    let out = stdout.join().unwrap_or_default();
    let err = stderr.join().unwrap_or_default();
    Ok(ExecResult {
        code: if timed_out { None } else { status.and_then(|s| s.code()) },
        stdout: String::from_utf8_lossy(&out).into_owned(),
        stderr: String::from_utf8_lossy(&err).into_owned(),
        timed_out,
    })
}
