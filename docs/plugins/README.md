# Tessera plugin documentation

A plugin adds widgets to a project's workspace. Each widget is an HTML page running in an isolated iframe, and it talks to Tessera only through the `window.tessera` SDK. You write it in JavaScript, or in Rust compiled to WebAssembly ([Plugins in Rust](rust.md)): both run in the same sandbox with the same permissions.

A plugin has no Node, no direct network access and no access to Tessera's own UI. It only sees what the SDK gives it, with the permissions the user granted. The one exception is [`ui.provider`](permissions.md#uiprovider), which runs outside the sandbox behind a danger warning.

## What a plugin can add

| Where | How |
| --- | --- |
| Widgets in the project workspace | [`contributes.widgets`](manifest.md) |
| Entries in the Explorer right-click menu and in other plugins' file menus (for example "Convert…" on `.nutexb` files) | [`contributes.fileActions`](manifest.md#file-actions) + the `ui.menus` permission + the `fileAction` event |
| A right-click menu in your widget that also shows other plugins' actions | [`tessera.ui.contextMenu`](sdk.md#tesserauicontextmenuspec) |
| Buttons in the project titlebar, next to Export | [`contributes.titlebar`](manifest.md#titlebar-buttons) + the `titlebar` event |
| A modal that asks the user for options | [`tessera.ui.form`](sdk.md#tesserauiformspec) |
| Files dragged from the Explorer onto your widget | the [`files.dropped`](sdk.md) event |
| Translations of the manifest and your pages | [`locales/*.json`](manifest.md#translations) + [`tessera.i18n`](sdk.md#translations) |
| Themes and settings | [`contributes.themes`](manifest.md), [`contributes.settings`](manifest.md#settings) |

The built-in [Textures plugin](../../apps/desktop/plugins/textures) uses a widget, a right-click action and a form: read it as a complete example.

## Contents

| Page | What's inside |
| --- | --- |
| [Your first plugin](getting-started.md) | Create, load, iterate on and share a plugin step by step |
| [manifest.json](manifest.md) | Every field, its rules and its limits |
| [SDK](sdk.md) | Every `window.tessera` method: parameters, return values, errors |
| [Plugins in Rust](rust.md) | The `tessera-plugin` crate, building to WebAssembly, the Rust example |
| [Packaging](packaging.md) | The `tessera-plugin` tool (new, build, check, pack) and the `.tessera-plugin` format |
| [Lifecycle and size](lifecycle.md) | When a widget reloads, how to survive it, and how to handle any panel size |
| [Permissions](permissions.md) | Every permission, its limits, and how users manage them |
| [Sandbox](sandbox.md) | What a widget page cannot do, and what to use instead |
| [Installation and integrity](installation.md) | Packages, verified copy, development link, updates |
| [Debugging](debugging.md) | The plugin lab and the WebView developer tools |
| [Troubleshooting](troubleshooting.md) | Common error messages and a pre-release checklist |

Full examples: [`examples/plugins/hello-counter`](../../examples/plugins/hello-counter) (JavaScript) and [`examples/plugins/hello-rust`](../../examples/plugins/hello-rust) (Rust, source in [`examples/rust/hello-rust`](../../examples/rust/hello-rust)).

## At a glance

Start from a template with the [`tessera-plugin` tool](packaging.md):

```bash
npm run plugin -- new my-plugin
```

```bash
npm run plugin -- new my-plugin --rust
```

A JavaScript plugin is one folder:

```
my-plugin/
  manifest.json     identity, permissions, widgets
  widget.html       the widget page
  widget.js         its script (no inline scripts)
  widget.css        its styles
```

```html
<script src="/__tessera/sdk.js"></script>
```

```js
await tessera.ready;
const state = await tessera.widget.getState();
await tessera.widget.setState({ ...state, open: true });
await tessera.ui.toast('success', 'Ready');
```

A Rust plugin adds a crate next to the plugin folder, compiled into `pkg/` by `tessera-plugin build`:

```rust
tessera_plugin::ready().await?;
let state: State = widget::get_state().await?;
widget::set_state(&State { open: true, ..state }).await?;
ui::toast(Toast::Success, "Ready").await?;
```

While you work, load the folder as a **Development link** (Plugins → **Load a folder**). To share it, pack it into one file that users install with Plugins → **Install a package**:

```bash
npm run plugin -- pack my-plugin
```

## Compatibility

This documentation covers the API of Tessera 0.1. The SDK has a single version: everything listed in [SDK](sdk.md) is available as soon as `tessera.ready` resolves.
