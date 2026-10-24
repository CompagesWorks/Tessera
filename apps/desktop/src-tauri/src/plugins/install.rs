use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use sha2::{Digest, Sha256};

use crate::backups::zip::extract_zip;
use crate::schema::plugins::ProgramDownload;
use crate::util::paths::from_slash;
use crate::util::{Error, Result};

const MAX_DOWNLOAD_BYTES: u64 = 200 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(300);
pub const SOURCE_FILE: &str = ".source";

pub fn download(url: &str, progress: impl Fn(u64, Option<u64>)) -> Result<Vec<u8>> {
    let client = Client::builder()
        .redirect(Policy::custom(|attempt| {
            if attempt.previous().len() > 5 || attempt.url().scheme() != "https" { attempt.stop() } else { attempt.follow() }
        }))
        .timeout(TIMEOUT)
        .user_agent("Tessera")
        .build()
        .map_err(|e| Error::new(e.to_string()))?;
    let response = client.get(url).send().map_err(|e| Error::new(format!("download failed: {e}")))?;
    if !response.status().is_success() {
        return Err(Error::new(format!("download failed: {}", response.status())));
    }
    let total = response.content_length();
    let mut reader = response.take(MAX_DOWNLOAD_BYTES + 1);
    let mut data = Vec::new();
    let mut chunk = vec![0; 64 * 1024];
    let mut reported = 0;
    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..read]);
        if data.len() as u64 > MAX_DOWNLOAD_BYTES {
            return Err(Error::new("download too large"));
        }
        if data.len() - reported >= 256 * 1024 {
            reported = data.len();
            progress(reported as u64, total);
        }
    }
    progress(data.len() as u64, total);
    Ok(data)
}

pub fn install(data: &[u8], download: &ProgramDownload, dir: &Path) -> Result<PathBuf> {
    if hex::encode(Sha256::digest(data)) != download.sha256 {
        return Err(Error::new("downloaded file does not match its sha256"));
    }
    if dir.exists() {
        fs::remove_dir_all(dir)?;
    }
    fs::create_dir_all(dir)?;
    let file = from_slash(dir, &download.file);
    if download.url.split(['?', '#']).next().unwrap_or_default().to_lowercase().ends_with(".zip") {
        let archive = dir.with_extension("zip");
        fs::write(&archive, data)?;
        let extracted = extract_zip(&archive, dir);
        let _ = fs::remove_file(&archive);
        extracted?;
    } else {
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&file, data)?;
    }
    if !file.is_file() {
        return Err(Error::new(format!("{} not found in the download", download.file)));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755))?;
    }
    fs::write(dir.join(SOURCE_FILE), &download.sha256)?;
    Ok(file)
}
