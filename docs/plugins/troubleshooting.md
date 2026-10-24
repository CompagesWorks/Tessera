# Troubleshooting

## Install errors

| Message | Fix |
| --- | --- |
| `Folder not found` | The folder was moved or deleted. Pick it again. |
| `manifest.json missing or too large` | The manifest must be at the root of the folder you pick, and under 64 KB. |
| `manifest.json is not valid JSON` | Check for trailing commas and comments: JSON allows neither. |
| `id: Invalid string: must match pattern …` | Use `author.name` in lowercase, digits and `-` only, e.g. `yourname.my-plugin`. |
| `id: reserved id` | `core.*` and `tessera.*` are reserved. Use your own author prefix. |
| `version: Invalid string: must match pattern …` | Use semver: `1.0.0`, not `1.0` or `v1.0.0`. |
| `permissions.0: Invalid input` | Unknown permission. See [Permissions](permissions.md) for the list. |
| `contributes.widgets.0.entry: invalid path` | Relative path without `..`, leading `/` or double `/`. |
| `Widget "<id>": <entry> not found` | The file named in `entry` doesn't exist, isn't a file, or resolves outside the plugin folder. Paths are case sensitive on some systems. |
| `Links are not allowed: <path>` | Replace the symbolic link with a real copy of the file. |
| `Too many files (max 2000)` / `Plugin too large (max 50 MB)` | Remove `node_modules`, build output, source maps and test assets you don't need at runtime. |
| `Cannot install a plugin from its own install folder` | Install from your source folder, not from Tessera's data folder. |

## Package errors

| Message | Fix |
| --- | --- |
| `tessera-package.json missing` | The file is a plain zip. Build it with `tessera-plugin pack` (see [Packaging](packaging.md)). |
| `Unexpected file: <path>` / `Missing file: <path>` / `Modified file: <path>` | The package was changed or damaged after `pack`. Pack it again and share the new file. |
| `tessera-package.json does not match manifest.json` | The manifest was edited after packing. Pack it again. |
| `unsafe path in archive: <path>` | The archive contains `..`, an absolute path or a drive letter. Use `tessera-plugin pack`, not a hand-made zip. |
| `Package too large (max 50 MB)` | Same limits as a folder: remove what the plugin doesn't need at runtime. |
| `wasm-bindgen not found` / `cargo not found` | Install the Rust tools listed in [Plugins in Rust](rust.md#what-you-need). |

## The widget stays blank

- Open the [developer tools](debugging.md) on the widget's iframe and look at the console.
- `Refused to execute inline script` → move the script into a `.js` file.
- `Refused to connect` → `fetch` is blocked, even for your own files. Use `tessera.net.fetch` with the `net` permission. See [Sandbox](sandbox.md).
- `tessera is not defined` → `<script src="/__tessera/sdk.js"></script>` is missing or comes after your script.
- Nothing happens after `await tessera.ready` → the page was opened outside Tessera, or the SDK was not loaded.

## The widget shows "not responding"

The page stopped answering the watchdog for 8 seconds. Look for a long synchronous loop and split it. See [Watchdog](sandbox.md#watchdog).

## The widget loses what the user did

The widget reloads on every layout change (tab switch, resize, drag…). Keep everything that matters in `tessera.widget.setState` and restore it on start. See [Lifecycle and size](lifecycle.md).

## The plugin got disabled on its own

It was installed as a verified copy and a file in the copy changed. The Plugins page shows the reason. Click "Reinstall from source". While developing, use a development link instead.

## SDK errors

See the [error table](sdk.md#errors) in the SDK reference.

## Before you release

- [ ] `id` is final and starts with your own author name
- [ ] `version` is bumped
- [ ] `engines.tessera` matches the version you tested on
- [ ] `description` says what the plugin does and why it needs each permission
- [ ] only the permissions you actually use are listed
- [ ] the widget works, with a clear message, when a permission is denied or revoked
- [ ] `getState` values are type-checked, and an old state from a previous version doesn't break the widget
- [ ] `setState` calls are debounced and stay well below 64 KB
- [ ] switching tab and back, resizing and dragging the widget restore it exactly as it was
- [ ] the widget is usable in a tiny panel and in a full window
- [ ] no inline scripts, no `fetch` outside your own files, no `localStorage`, no CDN
- [ ] UI uses Atrium classes and looks right in both dark and light themes
- [ ] widget text uses `language` from `tessera.ready` if you support several languages
- [ ] `tessera-plugin check` shows no warning
- [ ] packed with `tessera-plugin pack`, installed once with **Install a package**, and it still works
- [ ] no leftover dev files (`node_modules`, `.git`, source maps, notes)
