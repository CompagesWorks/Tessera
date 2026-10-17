# Permissions

Without any permission, a widget can only: render a UI, show notifications, save its own state, and read the open project's name, kind and status. Everything else goes through a permission that is declared in the manifest **and** granted by the user.

## Overview

| Permission | Risk | What it allows |
| --- | --- | --- |
| [`fs.project.read`](#fsprojectread) | low | list, read and watch text files of the open project |
| [`fs.project.write`](#fsprojectwrite) | medium | create, modify and delete files in the open project, plus a private folder |
| [`fs.external`](#fsexternal) | medium | read and write one outside folder picked by the user |
| [`net`](#net) | medium | HTTPS requests to the domains listed in the manifest |
| [`secrets`](#secrets) | medium | store the plugin's own secrets (tokens) encrypted |
| [`ui.theme`](#uitheme) | low | provide Tessera themes |
| [`ui.menus`](#uimenus) | low | add entries to the Explorer right-click menu and to other plugins' file menus |
| [`ui.provider`](#uiprovider) | **high** | replace Tessera's UI engine, **outside the sandbox** |
| [`exec`](#exec) | **high** | run one specific program shipped with the plugin |
| [`exec.system`](#execsystem) | **high** | run programs installed on the PC (git…), picked by the user |
| [`discord.rpc`](#discordrpc) | medium | set the user's Discord status |
| [`clipboard.write`](#clipboardwrite) | low | put text in the clipboard |
| [`notify.system`](#notifysystem) | low | show system notifications |
| [`open.external`](#openexternal) | medium | open HTTPS links in the browser and show files in the explorer |
| [`projects.list`](#projectslist) | medium | read the name, kind, status and tags of every project |

An unknown permission makes the manifest invalid, and the plugin is rejected.

## Declaring permissions

Most permissions are a plain string. `net`, `exec`, `exec.system` and `discord.rpc` need extra data, so they are written as objects:

```json
"permissions": [
  "fs.project.read",
  "fs.project.write",
  { "id": "net", "domains": ["api.gamebanana.com", "*.githubusercontent.com"] },
  { "id": "exec", "program": "tools/converter.exe", "sha256": "3f2a…" },
  { "id": "exec.system", "programs": ["git"] },
  { "id": "discord.rpc", "clientId": "123456789012345678" },
  "secrets"
]
```

`{ "id": "secrets" }` is also accepted for the simple ones. A permission can only appear once.

## `fs.project.read`

| | |
| --- | --- |
| Risk | low |
| Asked | on install |
| SDK | [`tessera.files.list`, `readText`, `watch`](sdk.md#files) |

- limited to the **project open** in the window where the widget runs
- read only: text files up to 1 MB, binary files up to 20 MB
- the `.tessera/` folder (layouts, notes, internal settings) is never readable
- symbolic links are hidden and never followed outside the project
- every access, allowed or denied, is written to the log

Typical uses: a file browser, a preview of config files, stats about the project's sources, a linter.

## `fs.project.write`

| | |
| --- | --- |
| Risk | medium |
| Asked | on install |
| SDK | [`tessera.files.writeText`, `mkdir`, `remove`, `rename`](sdk.md#files), [`tessera.files.private.*`](sdk.md#private-folder) |

- same limits as `fs.project.read`: the open project only, `.tessera/` is off limits, links never lead outside
- text files up to 5 MB, binary files up to 20 MB per write
- **deleted files go to the system trash**, never deleted for good
- the plugin also gets a private folder `.tessera/plugins/<plugin id>/` in the project, for caches and generated files. Only `tessera.files.private` reaches it.

Writing does not include reading: to read the project's files, also ask for `fs.project.read`.

## `fs.external`

| | |
| --- | --- |
| Risk | medium |
| Asked | on install, then the user picks the folder |
| Scope | **one** folder outside the project, chosen by the user (an emulator's mod folder, an SD card…) |
| SDK | [`tessera.external.*`](sdk.md#outside-folder) |

The plugin never chooses the path: the user does, in the system folder picker, either when the plugin calls `tessera.external.pick()` or from Plugins → your plugin → Outside folder. They can change it or forget it at any time. The plugin never learns the full path, only the folder's name.

## `net`

| | |
| --- | --- |
| Risk | medium |
| Asked | on install |
| Scope | only the domains listed in the manifest (32 max) |
| SDK | [`tessera.net.fetch`](sdk.md#network) |

`fetch` stays blocked in the page: network calls go through the SDK and are made by Tessera's main process.

- HTTPS only, no IP address, no `user:password@` in the URL
- a domain is matched exactly; `*.example.com` matches every subdomain of `example.com` but not `example.com` itself
- **every redirect is checked again**: a redirect to an undeclared domain is refused
- cookies are never sent or kept; `Cookie`, `Host`, `Origin`, `Referer` and similar headers are dropped
- responses up to 10 MB, 30 s timeout

Changing the domain list in an update counts as a new permission: the user has to accept it again.

## `secrets`

| | |
| --- | --- |
| Risk | medium |
| Asked | on install |
| Scope | the plugin's own secrets only |
| SDK | [`tessera.secrets.*`](sdk.md#secrets) |

Stores API tokens and similar values encrypted by the operating system (DPAPI on Windows, Keychain on macOS, the secret service on Linux). A plugin can never read another plugin's secrets, secrets never appear in plain text in Tessera's files, and they are deleted when the plugin is removed. 64 secrets of 16 KB max per plugin.

## `ui.theme`

| | |
| --- | --- |
| Risk | low |
| Asked | on install |
| Scope | CSS tokens (colors, radii, fonts) |
| Manifest | [`contributes.themes`](manifest.md#themes) |

Lets a plugin ship themes for Tessera. A theme only changes `--atrium-*` design tokens: no script and no free CSS run in Tessera's UI, and values containing `url(…)` are refused. The user applies a theme from Plugins → your plugin → Themes. The theme also reaches every plugin widget, so `atrium-*` components inside widgets follow it.

## `ui.menus`

| | |
| --- | --- |
| Risk | low |
| Asked | on install |
| Scope | file context menus |
| Manifest | [`contributes.fileActions`](manifest.md#file-actions) |

Lets a plugin add entries to the Explorer right-click menu and to the file menus other plugins open with [`tessera.ui.contextMenu`](sdk.md#tesserauicontextmenuspec). An entry only shows for the extensions it lists. When the user picks it, the plugin's host page receives the `fileAction` event with the path of that file, and nothing else: reading or changing the file still needs `fs.project.read` / `fs.project.write`. Revoking the permission removes the entries at once.

## `ui.provider`

| | |
| --- | --- |
| Risk | **high** |
| Asked | on install, **unticked**, behind a danger warning the user must accept |
| Scope | Tessera's whole UI engine |
| Manifest | [`contributes.uiProvider`](manifest.md#ui-provider) |

> **Danger.** A UI provider is the only plugin code that runs **inside Tessera, outside the sandbox**. It can read and change every project and plugin, see everything the user types and call every Tessera feature. Treat it like installing a program.

Replaces the component library Tessera uses (Atrium-UI by default). Granting the permission is not enough: the user must also click **Use as UI engine** and accept a second warning; Tessera then reloads.

Safety nets:

- the module is only served while it is the selected engine **and** the permission is granted; revoking the permission or disabling the plugin takes effect at the next reload
- if the module fails to load, Tessera falls back to Atrium-UI and says so
- starting Tessera with `--safe-mode` ignores the plugin engine
- a toast reminds the user at each start that a plugin engine is active

## `exec`

| | |
| --- | --- |
| Risk | **high** |
| Asked | on install, **and** before each run (the user can allow it for the rest of the session) |
| Scope | one program shipped with the plugin, identified by path and sha256 hash |
| SDK | [`tessera.exec.run`](sdk.md#programs) |

Runs a converter or tool (for example a texture converter) shipped inside the plugin folder.

- the program's sha256 is checked against the manifest **before every run**
- on Windows, only `.exe` and `.com` files (no `.bat`, `.cmd` or scripts)
- **no shell**: arguments are passed as a list, so nothing in them is interpreted
- the exact command is shown in a system dialog before the user approves it. The dialog comes from Tessera's main process: neither the plugin nor Tessera's UI can answer it
- the program runs in the open project's folder, with a minimal environment, a timeout (60 s by default, 10 min max) and 1 MB of output kept per stream
- "Always for this session" is forgotten when the app restarts, or when the plugin is updated, disabled or its permissions change

A new program or a new hash in an update counts as a new permission: the user has to accept it again.

## `exec.system`

| | |
| --- | --- |
| Risk | **high** |
| Asked | on install, then the user picks each program, **and** before each run (or once per session) |
| Scope | the program names listed in the manifest (8 max), each one bound to a file the user picked |
| SDK | [`tessera.exec.runSystem`, `pickSystem`, `systemInfo`](sdk.md#programs-of-the-pc) |

For tools installed on the PC that a plugin can't ship: `git`, VGAudio, an emulator… The manifest only declares a **name** (`"git"`); the plugin never gives a path.

- the user picks the file in the system picker, from the plugin (`tessera.exec.pickSystem('git')`) or in Plugins → your plugin → Programs
- Tessera stores its path and sha256. **If the file changes** (an update of git…), runs are refused until the user picks it again
- same rules as [`exec`](#exec) for the rest: hash checked before every run, `.exe`/`.com` only on Windows, no shell, system dialog with the exact command, minimal environment, timeout, runs in the project folder

Adding a program name in an update counts as a new permission.

## `discord.rpc`

| | |
| --- | --- |
| Risk | medium |
| Asked | on install |
| Scope | the activity of one Discord application, declared by its client id |
| SDK | [`tessera.discord.setActivity`](sdk.md#discord) |

Talks to the Discord app running on the PC (local IPC, no network) to show a status like "Modding Mario". The plugin can only set or clear the activity: no messages, no friends, no account data. Images are Discord asset keys or HTTPS URLs. The status is cleared when the plugin is disabled, updated or removed.

## `clipboard.write`

| | |
| --- | --- |
| Risk | low |
| Asked | on install |
| SDK | [`tessera.clipboard.writeText`](sdk.md#clipboard) |

Puts text (100,000 characters max) in the clipboard. **Reading the clipboard is not possible**: it often holds passwords.

## `notify.system`

| | |
| --- | --- |
| Risk | low |
| Asked | on install |
| SDK | [`tessera.notify.show`](sdk.md#notifications) |

Shows an operating system notification, useful when Tessera is in the background ("Export done"). The title always starts with the plugin's name, and a plugin can show one notification every 3 seconds at most.

## `open.external`

| | |
| --- | --- |
| Risk | medium |
| Asked | on install, then once per site (or per session) |
| SDK | [`tessera.shell.openUrl`, `reveal`](sdk.md#links-and-explorer) |

- `openUrl`: HTTPS links only. A system dialog shows the full URL before the browser opens it; "Always for this site" lasts until Tessera restarts
- `reveal`: shows a file or folder of the project (or of the private or outside folder) in the system explorer. The plugin never learns the full path

## `projects.list`

| | |
| --- | --- |
| Risk | medium |
| Asked | on install |
| SDK | [`tessera.projects.list`](sdk.md#all-projects) |

Reads the list of **all** the user's projects: name, kind, status, tag names, collection name, favorite, last change, and whether the folder is missing. Never their paths, ids or files. For dashboards and stats.

## What the user sees

1. **On install**: the list of requested permissions with their risk level. They can untick any of them. High-risk permissions show an extra warning.
2. **At any time**: Plugins page → your plugin → Permissions. Revoking a permission takes effect immediately, without reloading the widget.
3. **After an update**: if the new manifest asks for an extra permission, or changes the domains of `net` or the program of `exec`, it is **not granted**. The plugin shows "Needs review" with Allow / Deny. Permissions already granted stay granted.

Disabling the plugin revokes all its permissions.

## Checked twice

Every permission is checked twice:

1. by Tessera's UI, before forwarding the call;
2. by the main process, which reloads the plugin's state and has the final say.

A plugin can't work around a refusal by talking to another part of Tessera.

## Good practices

- **Ask for the minimum.** Every permission is one more reason for a user to decline your plugin.
- **Work without it.** If a permission is declined, show a clear message in the widget instead of an empty screen or a loop of errors.
- **Explain why** in the plugin `description`: "Reads the project's `.prc` files to show…".
- **Don't sneak a permission into a minor update**: the user will have to accept it before it does anything.
- **Prefer `fs.project.write`'s private folder** over the project's sources for caches.
- **Avoid `ui.provider`** unless replacing the UI is the whole point of your plugin.

```js
async function loadFiles() {
  try {
    return await tessera.files.list('');
  } catch (error) {
    if (error.message.startsWith('permission denied')) {
      notice.textContent = 'Allow "Read project files" in Plugins to use this widget.';
      return [];
    }
    throw error;
  }
}
```

## Activity log

Every file access, network request, secret access, program run, permission change, install and integrity failure is written to `permissions.log` and shown in Plugins → your plugin → Recent activity. Secret values and request bodies are never logged. Users can see exactly what your plugin did.

## Undo and the journal

- Every call a plugin makes, allowed or refused, is written to the permission journal (**Settings > Journal**). The user can filter it, export it as JSON or CSV and clear it.
- Writes made with `fs.project.write` on the **project** folder (`writeText`, `writeBytes`, `remove`, `rename`) are kept in the project's undo history while Tessera is open, so the user can undo what a plugin did (`Ctrl+Alt+Z`, or **Change history** in the command palette). Files over 2 MB, folders, the private folder and outside folders are not tracked. An undo is refused if the file changed since.
