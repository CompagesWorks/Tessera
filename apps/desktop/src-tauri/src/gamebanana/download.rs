use std::fs::File;
use std::io::{BufWriter, Read, Write};
use std::path::Path;
use std::time::Duration;

use base64::Engine;
use md5::{Digest, Md5};
use url::Url;

use crate::util::{Error, Result};

const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

pub fn allowed(url: &Url) -> bool {
    url.scheme() == "https" && url.host_str().is_some_and(|host| host == "gamebanana.com" || host.ends_with(".gamebanana.com"))
}

fn checked(url: &str) -> Result<Url> {
    let url = Url::parse(url).map_err(|_| Error::new("gamebanana: invalid link"))?;
    if !allowed(&url) {
        return Err(Error::new("gamebanana: link outside GameBanana"));
    }
    Ok(url)
}

pub fn download(url: &str, destination: &Path, size: u64, md5: Option<&str>, mut progress: impl FnMut(u64)) -> Result<()> {
    let mut response = super::api::client(Duration::from_secs(60 * 60))?
        .get(checked(url)?)
        .send()
        .map_err(|_| Error::new("gamebanana: download failed"))?;
    if !response.status().is_success() || !allowed(response.url()) {
        return Err(Error::new(format!("gamebanana: download failed ({})", response.status().as_u16())));
    }
    let mut out = BufWriter::new(File::create(destination)?);
    let mut hasher = Md5::new();
    let mut buffer = vec![0u8; 256 * 1024];
    let mut received = 0u64;
    loop {
        let n = response.read(&mut buffer).map_err(|_| Error::new("gamebanana: download interrupted"))?;
        if n == 0 {
            break;
        }
        received += n as u64;
        if received > size {
            return Err(Error::new("gamebanana: file larger than announced"));
        }
        hasher.update(&buffer[..n]);
        out.write_all(&buffer[..n])?;
        progress(received);
    }
    out.flush()?;
    let digest: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if md5.is_some_and(|expected| !expected.is_empty() && expected != digest) {
        return Err(Error::new("gamebanana: checksum mismatch, the download is corrupted"));
    }
    Ok(())
}

pub fn image_data_url(url: &str) -> Result<String> {
    let url = checked(url)?;
    let kind = match url.path().rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => return Err(Error::new("gamebanana: not an image")),
    };
    let response = super::api::client(Duration::from_secs(20))?.get(url).send().map_err(|_| Error::new("gamebanana: image unavailable"))?;
    if !response.status().is_success() || !allowed(response.url()) {
        return Err(Error::new("gamebanana: image unavailable"));
    }
    let mut bytes = vec![];
    response.take(MAX_IMAGE_BYTES + 1).read_to_end(&mut bytes).map_err(|_| Error::new("gamebanana: image unavailable"))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(Error::new("gamebanana: image too large"));
    }
    Ok(format!("data:{kind};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

pub fn download_image(url: &str, destination: &Path) -> Result<()> {
    download(url, destination, MAX_IMAGE_BYTES, None, |_| {})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_gamebanana_over_https() {
        assert!(allowed(&Url::parse("https://files.gamebanana.com/mods/a.rar").unwrap()));
        assert!(allowed(&Url::parse("https://filecache35.gamebanana.com/mods/a.rar").unwrap()));
        assert!(!allowed(&Url::parse("https://evilgamebanana.com/a.rar").unwrap()));
        assert!(!allowed(&Url::parse("http://gamebanana.com/dl/1").unwrap()));
        assert!(!allowed(&Url::parse("https://gamebanana.com.evil.com/dl/1").unwrap()));
        assert!(checked("https://evil.com/x").is_err());
    }
}


