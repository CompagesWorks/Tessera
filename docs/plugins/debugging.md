# Debugging a plugin

## Setup

1. Install your plugin as a **Development link**: Tessera reads your folder directly and files are never cached.
2. Run Tessera from the repository. In a development build, right-click anywhere and pick **Inspect** to open the WebView developer tools.

```bash
npm run dev
```

To keep your own projects and settings out of the way, add a separate profile folder (ignored in packaged builds):

```bash
cd apps/desktop && npx tauri dev -- -- --tessera-profile=C:/temp/tessera-plugin-dev
```

On Windows you can also open the remote debugging port of WebView2 before starting Tessera:

```bash
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
```

## The plugin lab

For quick checks you don't need the developer tools. Turn on **Settings > Advanced > Developer mode**, then open the **Plugin lab** (same page, or the command palette).

| Tab | Shows |
| --- | --- |
| Console | everything your widget prints with `console.log/info/warn/error/debug`, plus uncaught errors |
| Calls | each SDK call: method, result (ok, denied, error, rate limited), time in ms and the error text |
| Permissions | switches that **simulate a refusal** of a permission you were granted, to test your "permission denied" path. Nothing changes on disk. |
| Plugin | manifest summary, integrity check and a **Reload** button that re-reads a development link and reloads its open widgets |

The lab keeps the last 300 console lines and 300 calls per plugin while developer mode is on. Browsers hide the details of an uncaught error thrown by a sandboxed page (you only see "Script error."), so wrap risky code in `try/catch` and call `console.error(error)` to get the full message and stack.

## Open the developer tools

1. In Chrome or Edge, open `chrome://inspect` (or `edge://inspect`).
2. **Configure…** → add `localhost:9222` if it isn't listed.
3. Open a project in Tessera and place your widget.
4. Under **Remote Target**, Tessera appears with its page. Your widget is listed as an `iframe` target with a `http://tessera-plugin.<your id>.localhost/…` URL on Windows (`tessera-plugin://<your id>/…` on macOS and Linux): click **inspect**.

If your widget isn't listed on its own, inspect the **Tessera** page instead and pick your iframe in the console's context selector (the dropdown that says `top`).

You get the usual tools: console, breakpoints, network panel (useful to see which file failed to load), elements, performance.

Remember that the widget [reloads on every layout change](lifecycle.md): the developer tools window may detach when that happens. Reopen it from `chrome://inspect`.

## Edit, reload, repeat

| You changed | Do |
| --- | --- |
| `.html`, `.js`, `.css`, images | anything that [rebuilds the layout](lifecycle.md): switch tab and back, nudge a panel size, or reopen the project |
| `manifest.json` | Plugins → **Load a folder** → same folder again |

## Reading the signals

| Where | What you learn |
| --- | --- |
| widget console | your errors, CSP violations (`Refused to execute inline script`, `Refused to connect`) |
| widget network panel | files returning 404 (wrong path, or a verified copy that was modified) |
| Plugins → your plugin → Recent activity | every file access, allowed or denied, and permission changes |
| Plugins → your plugin | "Needs review", "Modified", "Dev" status and the integrity error if any |
| the "not responding" overlay | the page blocked the main thread for 8 seconds or more, see [Watchdog](sandbox.md#watchdog) |

## Logging

`console.log` from your widget goes to the widget's own console, not Tessera's. For messages the user should see, use `tessera.ui.toast`, and keep them rare: a toast per error, not per retry.
