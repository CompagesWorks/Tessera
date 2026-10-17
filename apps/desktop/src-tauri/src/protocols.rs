use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use percent_encoding::percent_decode_str;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::schema::check;
use crate::plugins::scoped_fs::{scoped_reveal, Scope};
use crate::projects::files::TESSERA_DIR;
use crate::schema::plugins::{Permission, COVER_SCHEME, MEDIA_SCHEME, PLUGIN_SCHEME, PROVIDER_SCHEME};
use crate::state::AppState;
use crate::util::paths::{inside, normalize};

type Handler = fn(&AppState, &RuntimeFiles, &Request<Vec<u8>>) -> Response<Vec<u8>>;

const RUNTIME_PREFIX: &str = "__tessera/";

const PLUGIN_CSP: &str = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'";

pub fn scheme_base(scheme: &str) -> String {
    if cfg!(windows) {
        format!("http://{scheme}.localhost")
    } else {
        format!("{scheme}://localhost")
    }
}

fn content_type(file: &Path) -> &'static str {
    match file.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("wasm") => "application/wasm",
        Some("mjs") => "text/javascript; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap()
}

fn serve(file: Option<PathBuf>, cors: bool) -> Response<Vec<u8>> {
    let Some(file) = file else { return not_found() };
    let Ok(data) = fs::read(&file) else { return not_found() };
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type(&file))
        .header("Content-Security-Policy", PLUGIN_CSP)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "no-store");
    if cors {
        builder = builder.header("Access-Control-Allow-Origin", "*");
    }
    builder.body(data).unwrap_or_else(|_| not_found())
}

fn serve_plain(file: Option<PathBuf>) -> Response<Vec<u8>> {
    let Some(file) = file else { return not_found() };
    let Ok(data) = fs::read(&file) else { return not_found() };
    Response::builder().status(StatusCode::OK).header("Content-Type", content_type(&file)).header("Cache-Control", "no-store").body(data).unwrap_or_else(|_| not_found())
}

struct Target {
    host: String,
    path: String,
}

fn target_of(request: &Request<Vec<u8>>) -> Target {
    let uri = request.uri();
    let host = uri.host().unwrap_or_default().to_lowercase();
    let host = host.strip_suffix(".localhost").map(str::to_string).unwrap_or(host);
    let path = percent_decode_str(uri.path()).decode_utf8_lossy().trim_start_matches('/').to_string();
    Target { host, path }
}

pub struct RuntimeFiles {
    sdk: PathBuf,
    atrium: PathBuf,
    icons: PathBuf,
    fonts: PathBuf,
}

impl RuntimeFiles {
    pub fn locate<R: Runtime>(app: &AppHandle<R>) -> RuntimeFiles {
        if cfg!(debug_assertions) {
            let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
            let modules = manifest.join("../../../node_modules");
            return RuntimeFiles {
                sdk: normalize(&manifest.join("../resources/plugin-sdk.js")),
                atrium: normalize(&modules.join("atrium-ui/dist/atrium-ui.css")),
                icons: normalize(&modules.join("bootstrap-icons/font/bootstrap-icons.min.css")),
                fonts: normalize(&modules.join("bootstrap-icons/font/fonts")),
            };
        }
        let base = app.path().resource_dir().unwrap_or_default().join("resources");
        RuntimeFiles { sdk: base.join("plugin-sdk.js"), atrium: base.join("atrium.css"), icons: base.join("bootstrap-icons.css"), fonts: base.join("fonts") }
    }

    fn resolve(&self, name: &str) -> Option<PathBuf> {
        match name {
            "sdk.js" => Some(self.sdk.clone()),
            "atrium.css" => Some(self.atrium.clone()),
            "bootstrap-icons.css" => Some(self.icons.clone()),
            _ => {
                let font = name.strip_prefix("fonts/")?;
                if crate::util::paths::has_parent_segment(font) {
                    return None;
                }
                let file = normalize(&self.fonts.join(font));
                inside(&self.fonts, &file).then_some(file)
            }
        }
    }
}

fn state<R: Runtime>(app: &AppHandle<R>) -> Option<Arc<AppState>> {
    app.try_state::<Arc<AppState>>().map(|s| s.inner().clone())
}

fn plugin_response(state: &AppState, runtime: &RuntimeFiles, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let target = target_of(request);
    if let Some(name) = target.path.strip_prefix(RUNTIME_PREFIX) {
        let cors = name.starts_with("fonts/");
        return serve(runtime.resolve(name), cors);
    }
    if !check::is_plugin_id(&target.host) {
        return not_found();
    }
    let path = if target.path.is_empty() { "index.html".to_string() } else { target.path };
    serve(state.plugins.resolve_file(&target.host, &path), true)
}

fn provider_response(state: &AppState, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let target = target_of(request);
    let mut parts = target.path.splitn(2, '/');
    let id = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    if !check::is_plugin_id(&id) || state.active_provider().as_deref() != Some(id.as_str()) || !state.plugins.has_grant(&id, Permission::UiProvider) || path.is_empty() {
        return serve(None, true);
    }
    serve(state.plugins.resolve_file(&id, &path), true)
}

fn cover_response(state: &AppState, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let target = target_of(request);
    let id = target.path.split('/').next().unwrap_or_default();
    if !check::is_uuid(id) {
        return not_found();
    }
    serve_plain(state.projects.cover_path(id))
}

const MEDIA_CHUNK: u64 = 4 * 1024 * 1024;
const MEDIA_WHOLE: u64 = 64 * 1024 * 1024;

fn media_type(path: &str) -> Option<&'static str> {
    match Path::new(path).extension()?.to_string_lossy().to_lowercase().as_str() {
        "mp4" | "m4v" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"),
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "ogg" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        "m4a" => Some("audio/mp4"),
        "h264" => Some("video/h264"),
        _ => None,
    }
}

fn byte_range(header: Option<&str>, len: u64) -> Option<(u64, u64)> {
    let Some(header) = header else { return (len > 0).then(|| (0, len.min(MEDIA_WHOLE) - 1)) };
    let (start, end) = header.strip_prefix("bytes=")?.split(',').next()?.trim().split_once('-')?;
    let (start, end) = if start.is_empty() {
        let suffix: u64 = end.parse().ok()?;
        (len.checked_sub(suffix.min(len))?, len - 1)
    } else {
        let start: u64 = start.parse().ok()?;
        let end = if end.is_empty() { start + MEDIA_CHUNK - 1 } else { end.parse().ok()? };
        (start, end.min(len - 1).min(start + MEDIA_CHUNK - 1))
    };
    (start <= end && start < len).then_some((start, end))
}

fn app_origin(request: &Request<Vec<u8>>) -> Option<&str> {
    let origin = request.headers().get("origin")?.to_str().ok()?;
    let app = matches!(origin, "http://tauri.localhost" | "https://tauri.localhost" | "tauri://localhost") || (cfg!(debug_assertions) && origin == "http://localhost:5173");
    app.then_some(origin)
}

fn media_response(state: &AppState, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let target = target_of(request);
    let Some((id, path)) = target.path.split_once('/') else { return not_found() };
    let Some(kind) = media_type(path).filter(|_| check::is_uuid(id)) else { return not_found() };
    let Ok(root) = state.projects.root_of(id) else { return not_found() };
    let Ok(file) = scoped_reveal(&Scope { root, hidden: Some(TESSERA_DIR.into()), trash: None }, path) else { return not_found() };
    let Ok(mut handle) = File::open(&file) else { return not_found() };
    let len = handle.metadata().map(|m| m.len()).unwrap_or(0);
    let range = request.headers().get("range").and_then(|v| v.to_str().ok());
    let Some((start, end)) = byte_range(range, len) else {
        return Response::builder().status(StatusCode::RANGE_NOT_SATISFIABLE).header("Content-Range", format!("bytes */{len}")).body(Vec::new()).unwrap();
    };
    let mut data = vec![0; (end - start + 1) as usize];
    if handle.seek(SeekFrom::Start(start)).and_then(|_| handle.read_exact(&mut data)).is_err() {
        return not_found();
    }
    let whole = start == 0 && end + 1 == len && range.is_none();
    let mut builder = Response::builder();
    if let Some(origin) = app_origin(request) {
        builder = builder.header("Access-Control-Allow-Origin", origin).header("Vary", "Origin");
    }
    builder
        .status(if whole { StatusCode::OK } else { StatusCode::PARTIAL_CONTENT })
        .header("Content-Type", kind)
        .header("Accept-Ranges", "bytes")
        .header("Content-Range", format!("bytes {start}-{end}/{len}"))
        .header("Cache-Control", "no-store")
        .body(data)
        .unwrap_or_else(|_| not_found())
}

fn spawn<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder, handle: Handler) {
    let app = ctx.app_handle().clone();
    std::thread::spawn(move || {
        let response = match state(&app) {
            Some(state) => {
                let runtime = RuntimeFiles::locate(&app);
                handle(&state, &runtime, &request)
            }
            None => not_found(),
        };
        responder.respond(response);
    });
}

pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder
        .register_asynchronous_uri_scheme_protocol(PLUGIN_SCHEME, |ctx, request, responder| spawn(ctx, request, responder, plugin_response))
        .register_asynchronous_uri_scheme_protocol(PROVIDER_SCHEME, |ctx, request, responder| spawn(ctx, request, responder, |s, _, r| provider_response(s, r)))
        .register_asynchronous_uri_scheme_protocol(COVER_SCHEME, |ctx, request, responder| spawn(ctx, request, responder, |s, _, r| cover_response(s, r)))
        .register_asynchronous_uri_scheme_protocol(MEDIA_SCHEME, |ctx, request, responder| spawn(ctx, request, responder, |s, _, r| media_response(s, r)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn byte_ranges_stay_inside_the_file() {
        assert_eq!(byte_range(Some("bytes=0-"), 10), Some((0, 9)));
        assert_eq!(byte_range(Some("bytes=2-5"), 10), Some((2, 5)));
        assert_eq!(byte_range(Some("bytes=8-100"), 10), Some((8, 9)));
        assert_eq!(byte_range(Some("bytes=-3"), 10), Some((7, 9)));
        assert_eq!(byte_range(Some("bytes=10-"), 10), None);
        assert_eq!(byte_range(Some("items=0-1"), 10), None);
        assert_eq!(byte_range(None, 10), Some((0, 9)));
        assert_eq!(byte_range(None, 0), None);
        assert_eq!(byte_range(None, 100 * MEDIA_CHUNK), Some((0, MEDIA_WHOLE - 1)));
        assert_eq!(byte_range(Some("bytes=0-"), 100 * MEDIA_CHUNK), Some((0, MEDIA_CHUNK - 1)));
        assert_eq!(media_type("a/b.MP4"), Some("video/mp4"));
        assert_eq!(media_type("a/b.txt"), None);
    }
}
