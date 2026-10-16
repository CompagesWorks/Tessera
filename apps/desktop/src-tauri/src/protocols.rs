use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use percent_encoding::percent_decode_str;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::schema::check;
use crate::schema::plugins::{Permission, COVER_SCHEME, PLUGIN_SCHEME, PROVIDER_SCHEME};
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
}
