use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::schema::check;
use crate::util::{Error, Result};

const TIMEOUT: Duration = Duration::from_millis(5000);
const OP_HANDSHAKE: i32 = 0;
const OP_FRAME: i32 = 1;
const OP_CLOSE: i32 = 2;
static IMAGE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^(https://[^\s]+|[a-z0-9_-]+)$").unwrap());

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Activity {
    pub details: Option<String>,
    pub state: Option<String>,
    pub start_timestamp: Option<u64>,
    pub end_timestamp: Option<u64>,
    pub large_image: Option<String>,
    pub large_text: Option<String>,
    pub small_image: Option<String>,
    pub small_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SetActivity {
    pub activity: Option<Activity>,
}

fn text(field: &mut Option<String>) -> Result<()> {
    if let Some(value) = field {
        check::trimmed("activity", value, 2, 128)?;
    }
    Ok(())
}

fn image(field: &Option<String>) -> Result<()> {
    if let Some(value) = field {
        check::text("activity", value, 1, 256)?;
        check::matches("activity", &IMAGE, value)?;
    }
    Ok(())
}

impl SetActivity {
    pub fn parse(value: Value) -> Result<SetActivity> {
        let mut params: SetActivity = serde_json::from_value(value)?;
        if let Some(activity) = &mut params.activity {
            text(&mut activity.details)?;
            text(&mut activity.state)?;
            text(&mut activity.large_text)?;
            text(&mut activity.small_text)?;
            image(&activity.large_image)?;
            image(&activity.small_image)?;
            if activity.start_timestamp == Some(0) || activity.end_timestamp == Some(0) {
                return Err(Error::new("invalid timestamp"));
            }
        }
        Ok(params)
    }
}

fn discord_error(message: impl Into<String>) -> Error {
    Error::new(message.into())
}

fn to_discord(activity: &Activity) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(d) = &activity.details {
        out.insert("details".into(), json!(d));
    }
    if let Some(s) = &activity.state {
        out.insert("state".into(), json!(s));
    }
    if activity.start_timestamp.is_some() || activity.end_timestamp.is_some() {
        let mut t = serde_json::Map::new();
        if let Some(v) = activity.start_timestamp {
            t.insert("start".into(), json!(v));
        }
        if let Some(v) = activity.end_timestamp {
            t.insert("end".into(), json!(v));
        }
        out.insert("timestamps".into(), Value::Object(t));
    }
    if activity.large_image.is_some() || activity.small_image.is_some() {
        let mut a = serde_json::Map::new();
        for (key, value) in [("large_image", &activity.large_image), ("large_text", &activity.large_text), ("small_image", &activity.small_image), ("small_text", &activity.small_text)] {
            if let Some(v) = value {
                a.insert(key.into(), json!(v));
            }
        }
        out.insert("assets".into(), Value::Object(a));
    }
    out.insert("instance".into(), json!(false));
    Value::Object(out)
}

fn encode(op: i32, payload: &Value) -> Vec<u8> {
    let body = serde_json::to_vec(payload).unwrap_or_default();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as i32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

trait Transport: Send {
    fn send(&mut self, data: &[u8]) -> std::io::Result<()>;
    fn read_exact_until(&mut self, buf: &mut [u8], deadline: Instant) -> std::io::Result<bool>;
}

#[cfg(windows)]
mod pipe {
    use std::fs::{File, OpenOptions};
    use std::io::{Read, Write};
        use std::os::windows::io::AsRawHandle;
    use std::time::Instant;

    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Pipes::PeekNamedPipe;

    pub struct Pipe(File);

    pub fn connect() -> Option<Pipe> {
        (0..10).find_map(|i| OpenOptions::new().read(true).write(true).open(format!(r"\\?\pipe\discord-ipc-{i}")).ok().map(Pipe))
    }

    impl super::Transport for Pipe {
        fn send(&mut self, data: &[u8]) -> std::io::Result<()> {
            self.0.write_all(data)?;
            self.0.flush()
        }

        fn read_exact_until(&mut self, buf: &mut [u8], deadline: Instant) -> std::io::Result<bool> {
            let mut filled = 0;
            while filled < buf.len() {
                let mut available = 0u32;
                let handle = HANDLE(self.0.as_raw_handle() as _);
                unsafe { PeekNamedPipe(handle, None, 0, None, Some(&mut available), None) }.map_err(|e| std::io::Error::other(e.to_string()))?;
                if available == 0 {
                    if Instant::now() > deadline {
                        return Ok(false);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    continue;
                }
                let want = (buf.len() - filled).min(available as usize);
                let n = self.0.read(&mut buf[filled..filled + want])?;
                if n == 0 {
                    return Err(std::io::ErrorKind::UnexpectedEof.into());
                }
                filled += n;
            }
            Ok(true)
        }
    }
}

#[cfg(unix)]
mod pipe {
    use std::io::{Read, Write};
    use std::os::unix::net::UnixStream;
    use std::path::PathBuf;
    use std::time::Instant;

    pub struct Pipe(UnixStream);

    pub fn connect() -> Option<Pipe> {
        let base = std::env::var("XDG_RUNTIME_DIR").or_else(|_| std::env::var("TMPDIR")).unwrap_or_else(|_| "/tmp".into());
        (0..10)
            .flat_map(|i| [PathBuf::from(&base).join(format!("discord-ipc-{i}")), PathBuf::from(&base).join("app/com.discordapp.Discord").join(format!("discord-ipc-{i}")), PathBuf::from(&base).join("snap.discord").join(format!("discord-ipc-{i}"))])
            .find_map(|path| UnixStream::connect(path).ok().map(Pipe))
    }

    impl super::Transport for Pipe {
        fn send(&mut self, data: &[u8]) -> std::io::Result<()> {
            self.0.write_all(data)
        }

        fn read_exact_until(&mut self, buf: &mut [u8], deadline: Instant) -> std::io::Result<bool> {
            let mut filled = 0;
            while filled < buf.len() {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    return Ok(false);
                }
                self.0.set_read_timeout(Some(left))?;
                match self.0.read(&mut buf[filled..]) {
                    Ok(0) => return Err(std::io::ErrorKind::UnexpectedEof.into()),
                    Ok(n) => filled += n,
                    Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => return Ok(false),
                    Err(e) => return Err(e),
                }
            }
            Ok(true)
        }
    }
}

struct Client {
    client_id: String,
    transport: Option<Box<dyn Transport>>,
}

impl Client {
    fn read_frame(transport: &mut dyn Transport, deadline: Instant) -> Result<Option<(i32, Value)>> {
        let mut header = [0u8; 8];
        let closed = |_| discord_error("discord closed the connection");
        if !transport.read_exact_until(&mut header, deadline).map_err(closed)? {
            return Ok(None);
        }
        let op = i32::from_le_bytes(header[0..4].try_into().unwrap());
        let length = i32::from_le_bytes(header[4..8].try_into().unwrap()).max(0) as usize;
        if length > 1024 * 1024 {
            return Err(discord_error("discord closed the connection"));
        }
        let mut body = vec![0u8; length];
        if !transport.read_exact_until(&mut body, deadline).map_err(closed)? {
            return Ok(None);
        }
        Ok(Some((op, serde_json::from_slice(&body).unwrap_or(Value::Null))))
    }

    fn wait(transport: &mut dyn Transport, matches: impl Fn(&Value) -> bool) -> Result<()> {
        let deadline = Instant::now() + TIMEOUT;
        loop {
            let Some((op, message)) = Self::read_frame(transport, deadline)? else {
                return Err(discord_error("discord did not answer"));
            };
            if op == OP_CLOSE {
                let reason = message.get("message").or_else(|| message.pointer("/data/message")).and_then(Value::as_str).unwrap_or("closed");
                return Err(discord_error(format!("discord refused: {reason}")));
            }
            if !matches(&message) {
                continue;
            }
            if message.get("evt").and_then(Value::as_str) == Some("ERROR") {
                return Err(discord_error(message.pointer("/data/message").and_then(Value::as_str).unwrap_or("discord error").to_string()));
            }
            return Ok(());
        }
    }

    fn connect(&mut self) -> Result<&mut Box<dyn Transport>> {
        if self.transport.is_none() {
            let mut transport: Box<dyn Transport> = Box::new(pipe::connect().ok_or_else(|| discord_error("discord is not running"))?);
            transport.send(&encode(OP_HANDSHAKE, &json!({ "v": 1, "client_id": self.client_id }))).map_err(|_| discord_error("discord closed the connection"))?;
            Self::wait(transport.as_mut(), |m| m.get("evt").and_then(Value::as_str) == Some("READY"))?;
            self.transport = Some(transport);
        }
        Ok(self.transport.as_mut().unwrap())
    }

    fn set_activity(&mut self, activity: Option<&Activity>) -> Result<()> {
        let result = (|| {
            let transport = self.connect()?;
            let nonce = uuid::Uuid::new_v4().to_string();
            let frame = json!({ "cmd": "SET_ACTIVITY", "args": { "pid": std::process::id(), "activity": activity.map(to_discord) }, "nonce": nonce });
            transport.send(&encode(OP_FRAME, &frame)).map_err(|_| discord_error("discord closed the connection"))?;
            Self::wait(transport.as_mut(), |m| m.get("nonce").and_then(Value::as_str) == Some(nonce.as_str()))
        })();
        if result.is_err() {
            self.transport = None;
        }
        result
    }

    fn close(&mut self) {
        if let Some(mut transport) = self.transport.take() {
            let _ = transport.send(&encode(OP_CLOSE, &json!({})));
        }
    }
}

#[derive(Default)]
pub struct DiscordPresence {
    clients: Mutex<HashMap<String, Client>>,
}

impl DiscordPresence {
    pub fn set(&self, plugin_id: &str, client_id: &str, activity: Option<&Activity>) -> Result<()> {
        let mut clients = self.clients.lock().unwrap();
        if clients.get(plugin_id).is_some_and(|c| c.client_id != client_id) {
            if let Some(mut old) = clients.remove(plugin_id) {
                old.close();
            }
        }
        let client = clients.entry(plugin_id.to_string()).or_insert_with(|| Client { client_id: client_id.to_string(), transport: None });
        client.set_activity(activity)
    }

    pub fn clear(&self, plugin_id: &str) {
        if let Some(mut client) = self.clients.lock().unwrap().remove(plugin_id) {
            client.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_activity() {
        assert!(SetActivity::parse(json!({ "activity": null })).is_ok());
        assert!(SetActivity::parse(json!({ "activity": { "details": "Editing Mario", "largeImage": "logo" } })).is_ok());
        assert!(SetActivity::parse(json!({ "activity": { "details": "x" } })).is_err());
        assert!(SetActivity::parse(json!({ "activity": { "largeImage": "http://x" } })).is_err());
        assert!(SetActivity::parse(json!({ "activity": { "nope": 1 } })).is_err());
        let frame = encode(OP_FRAME, &json!({}));
        assert_eq!(&frame[0..4], &1i32.to_le_bytes());
        assert_eq!(&frame[4..8], &2i32.to_le_bytes());
    }
}
