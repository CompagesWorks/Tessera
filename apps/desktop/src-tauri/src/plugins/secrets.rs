use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::schema::check;
use crate::util::{json, Error, Result};

pub const MAX_SECRETS: usize = 64;
pub const MAX_SECRET_BYTES: usize = 16 * 1024;
const PREFIX: &[u8] = b"v10";

pub trait Cipher: Send + Sync {
    fn available(&self) -> bool;
    fn encrypt(&self, value: &str) -> Result<Vec<u8>>;
    fn decrypt(&self, data: &[u8]) -> Result<String>;
}

pub fn secret_error(message: &str) -> Error {
    Error::new(message)
}

pub struct AesCipher {
    key: Option<[u8; 32]>,
}

impl AesCipher {
    pub fn new(key: Option<[u8; 32]>) -> Self {
        AesCipher { key }
    }
}

impl Cipher for AesCipher {
    fn available(&self) -> bool {
        self.key.is_some()
    }

    fn encrypt(&self, value: &str) -> Result<Vec<u8>> {
        let key = self.key.ok_or_else(|| secret_error("encryption unavailable on this system"))?;
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| secret_error("encryption failed"))?;
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        let sealed = cipher.encrypt(Nonce::from_slice(&nonce), value.as_bytes()).map_err(|_| secret_error("encryption failed"))?;
        Ok([PREFIX, &nonce, &sealed].concat())
    }

    fn decrypt(&self, data: &[u8]) -> Result<String> {
        let key = self.key.ok_or_else(|| secret_error("encryption unavailable on this system"))?;
        if data.len() < PREFIX.len() + 12 || &data[..PREFIX.len()] != PREFIX {
            return Err(secret_error("cannot decrypt secret"));
        }
        let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| secret_error("cannot decrypt secret"))?;
        let nonce = &data[PREFIX.len()..PREFIX.len() + 12];
        let plain = cipher.decrypt(Nonce::from_slice(nonce), &data[PREFIX.len() + 12..]).map_err(|_| secret_error("cannot decrypt secret"))?;
        String::from_utf8(plain).map_err(|_| secret_error("cannot decrypt secret"))
    }
}

#[cfg(windows)]
mod platform {
    use std::path::Path;

    use base64::Engine;
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};

    fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
        CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
    }

    unsafe fn take(out: CRYPT_INTEGER_BLOB) -> Vec<u8> {
        let data = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut _)));
        data
    }

    pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe { CryptProtectData(&blob(data), None, None, None, None, 0, &mut out).ok()? };
        Some(unsafe { take(out) })
    }

    pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe { CryptUnprotectData(&blob(data), None, None, None, None, 0, &mut out).ok()? };
        Some(unsafe { take(out) })
    }

    pub fn electron_key(user_data: &Path) -> Option<Vec<u8>> {
        let raw = std::fs::read_to_string(user_data.join("Local State")).ok()?;
        let state: serde_json::Value = serde_json::from_str(&raw).ok()?;
        let encoded = state.get("os_crypt")?.get("encrypted_key")?.as_str()?;
        let wrapped = base64::engine::general_purpose::STANDARD.decode(encoded).ok()?;
        unprotect(wrapped.strip_prefix(b"DPAPI")?)
    }
}

#[cfg(windows)]
pub fn load_key(user_data: &Path) -> Option<[u8; 32]> {
    let file = user_data.join("secret-key");
    if let Ok(stored) = fs::read(&file) {
        return platform::unprotect(&stored).and_then(|k| k.try_into().ok());
    }
    let key: [u8; 32] = match platform::electron_key(user_data).and_then(|k| k.try_into().ok()) {
        Some(key) => key,
        None => {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            key
        }
    };
    let protected = platform::protect(&key)?;
    fs::create_dir_all(user_data).ok()?;
    fs::write(&file, protected).ok()?;
    Some(key)
}

#[cfg(not(windows))]
pub fn load_key(_user_data: &Path) -> Option<[u8; 32]> {
    let entry = keyring::Entry::new("Tessera", "secrets").ok()?;
    if let Ok(stored) = entry.get_password() {
        return base64::engine::general_purpose::STANDARD.decode(stored).ok()?.try_into().ok();
    }
    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    entry.set_password(&base64::engine::general_purpose::STANDARD.encode(key)).ok()?;
    Some(key)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretFile {
    format_version: u8,
    secrets: BTreeMap<String, String>,
}

pub struct SecretStore {
    dir: PathBuf,
    cipher: Arc<dyn Cipher>,
    lock: Mutex<()>,
}

impl SecretStore {
    pub fn new(dir: PathBuf, cipher: Arc<dyn Cipher>) -> Self {
        SecretStore { dir, cipher, lock: Mutex::new(()) }
    }

    fn file(&self, owner: &str) -> PathBuf {
        self.dir.join(format!("{owner}.json"))
    }

    fn read(&self, owner: &str) -> BTreeMap<String, String> {
        json::read(&self.file(owner), |v| {
            let file: SecretFile = serde_json::from_value(v)?;
            if file.format_version != 1 || !file.secrets.keys().all(|k| check::SECRET_KEY.is_match(k)) {
                return Err(Error::new("invalid secrets"));
            }
            Ok(file.secrets)
        })
        .unwrap_or_default()
    }

    fn write(&self, owner: &str, secrets: BTreeMap<String, String>) -> Result<()> {
        json::write(&self.file(owner), &SecretFile { format_version: 1, secrets })
    }

    pub fn get(&self, owner: &str, key: &str) -> Result<Option<String>> {
        match self.read(owner).get(key) {
            None => Ok(None),
            Some(stored) => {
                let data = base64::engine::general_purpose::STANDARD.decode(stored).map_err(|_| secret_error("cannot decrypt secret"))?;
                Ok(Some(self.cipher.decrypt(&data)?))
            }
        }
    }

    pub fn keys(&self, owner: &str) -> Vec<String> {
        self.read(owner).into_keys().collect()
    }

    pub fn set(&self, owner: &str, key: &str, value: &str) -> Result<()> {
        if !self.cipher.available() {
            return Err(secret_error("encryption unavailable on this system"));
        }
        if value.len() > MAX_SECRET_BYTES {
            return Err(secret_error("secret too large"));
        }
        let _guard = self.lock.lock().unwrap();
        let mut secrets = self.read(owner);
        if !secrets.contains_key(key) && secrets.len() >= MAX_SECRETS {
            return Err(secret_error("too many secrets"));
        }
        secrets.insert(key.to_string(), base64::engine::general_purpose::STANDARD.encode(self.cipher.encrypt(value)?));
        self.write(owner, secrets)
    }

    pub fn delete(&self, owner: &str, key: &str) -> Result<()> {
        let _guard = self.lock.lock().unwrap();
        let mut secrets = self.read(owner);
        if secrets.remove(key).is_none() {
            return Ok(());
        }
        self.write(owner, secrets)
    }

    pub fn clear(&self, owner: &str) {
        let _guard = self.lock.lock().unwrap();
        let _ = fs::remove_file(self.file(owner));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stores_encrypted_values() {
        let dir = tempfile::tempdir().unwrap();
        let store = SecretStore::new(dir.path().to_path_buf(), Arc::new(AesCipher::new(Some([7u8; 32]))));
        store.set("dev.lab", "token", "abc").unwrap();
        assert_eq!(store.get("dev.lab", "token").unwrap().as_deref(), Some("abc"));
        assert!(!fs::read_to_string(dir.path().join("dev.lab.json")).unwrap().contains("abc"));
        assert_eq!(store.keys("dev.lab"), vec!["token"]);
        store.delete("dev.lab", "token").unwrap();
        assert_eq!(store.get("dev.lab", "token").unwrap(), None);
        let off = SecretStore::new(dir.path().to_path_buf(), Arc::new(AesCipher::new(None)));
        assert_eq!(off.set("dev.lab", "x", "y").unwrap_err().0, "encryption unavailable on this system");
    }
}
