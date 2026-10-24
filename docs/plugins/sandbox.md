# Sandbox

Each widget is an iframe loaded from `tessera-plugin://<plugin id>/<entry>` (on Windows, WebView2 serves it as `http://tessera-plugin.<plugin id>.localhost/<entry>`; the origin is still one per plugin), with two layers of restrictions: the iframe's own attributes (`sandbox="allow-scripts"`, `allow=""`) and a Content Security Policy sent with every file.

## What's blocked, and what to use instead

| Blocked | Why | Instead |
| --- | --- | --- |
| inline `<script>`, `onclick="…"`, `eval`, `new Function` | CSP `script-src 'self'` | a `.js` file in the plugin folder, `addEventListener` |
| scripts from a CDN | CSP `script-src 'self'` | copy the library into the plugin folder |
| `fetch`, `XMLHttpRequest`, WebSocket, `EventSource` to anything but your own files | CSP `connect-src 'self'` | for the network, ask for [`net`](permissions.md#net) and use `tessera.net.fetch` |
| `localStorage`, `sessionStorage`, IndexedDB, cookies | the iframe has no origin of its own | `tessera.widget.getState` / `setState` |
| Web Workers | the iframe has no origin of its own | keep heavy work short or split it into chunks |
| `alert`, `confirm`, `prompt` | no `allow-modals` | an in-page dialog, or `tessera.ui.toast` |
| submitting a `<form>` | `form-action 'none'`, no `allow-forms` | listen to `submit` and call `event.preventDefault()` |
| `window.open`, `target="_blank"` links, navigating the parent window | no `allow-popups` or `allow-top-navigation` | none for now |
| `<iframe>`, `<object>`, `<embed>` | `frame-src 'none'`, `default-src 'none'` | none |
| external images or fonts | `img-src` and `font-src` are restricted | plugin files, `data:` or `blob:` |
| camera, microphone, geolocation, fullscreen… | iframe with `allow=""` | none |
| `<base href>` | `base-uri 'none'` | relative paths |

Allowed:

- ES modules (`<script type="module">`, `import`) from the plugin folder
- `fetch` of the plugin's own files (JSON data, `.wasm`…)
- WebAssembly (`'wasm-unsafe-eval'`), see [Plugins in Rust](rust.md)
- inline styles (`style="…"`, `<style>`) and the plugin's own stylesheets
- plugin images, `data:` and `blob:` (so `canvas.toDataURL` and `URL.createObjectURL` work)
- plugin fonts and `data:` fonts

Files are served with no caching: reloading the widget always reads from disk.

## Styles and theme

The SDK loads `/__tessera/atrium.css` and `/__tessera/bootstrap-icons.css`, so you can use:

- [Atrium-UI](https://github.com/CompagesWorks/Atrium-UI) classes: `atrium-btn`, `atrium-btn-primary`, `atrium-btn-secondary`, `atrium-input`…
- icons: `<i class="bi bi-stars"></i>`
- the theme: `<html data-atrium-theme="dark|light">` is kept up to date for you

Using Atrium makes your widget look like the rest of Tessera and follow the theme with no code.

## Keyboard

Tessera's shortcuts (`Ctrl+K`…) keep working while focus is inside your widget: they are read from the real keyboard by the main process. Your widget still gets its own keyboard events normally, but it cannot trigger a Tessera shortcut by simulating keys.

## Watchdog

Tessera pings the widget every 3 seconds; the SDK answers on its own. With no answer for 8 seconds, the widget is covered by "not responding" with a **Reload** button.

Usual causes:

- a long synchronous loop (parsing a big file, a heavy computation) blocking the page: split the work with `await new Promise((r) => setTimeout(r))` between chunks;
- the SDK isn't loaded, or is loaded after a script that crashes.

The widget runs in its own process, so a stuck widget does not freeze Tessera's UI.
