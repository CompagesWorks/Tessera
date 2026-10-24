# Installation and integrity

Two ways to install:

- Plugins → **Install a package** → pick a `.tessera-plugin` file (made with `tessera-plugin pack`, see [Packaging](packaging.md)). Tessera checks every file against the package's hash list, shows the requested permissions, and installs it as a **Verified copy**.
- Plugins → **Load a folder** → pick the folder. Tessera checks the manifest and the folder contents, shows the requested permissions, then lets the user choose a mode.

## Modes

| Mode | What happens | For |
| --- | --- | --- |
| **Verified copy** (default) | The folder is copied into Tessera's data, with the sha256 hash of every file. | plugins written by others |
| **Development link** | The folder is used in place, with no verification. | your own plugins, while you work on them |
| **Built-in** | Shipped with Tessera and registered on first launch, with its permissions granted. | plugins made by Tessera (Deploy…) |

### Verified copy

- Each file is checked against its hash when it is served, and the whole package is checked again on startup and when the plugin is re-enabled.
- A modified, added or deleted file disables the plugin (status "Modified") and logs the reason (`Modified file: widget.js`, `Unexpected file: …`, `Missing file: …`). The Plugins page offers "Reinstall from source".
- The original folder is remembered as the source, so reinstalling picks up a newer version from the same place.
- A plugin cannot be installed from inside Tessera's own install folder.

### Development link

- Edits are visible as soon as the widget reloads.
- The Plugins page marks the plugin as "Dev": no integrity guarantee.
- Switching from a verified copy to a development link deletes the copy.

## Package checks

Both modes refuse a folder that:

- has no valid `manifest.json` (see [manifest.json](manifest.md))
- points a widget `entry` at a missing file or outside the folder
- contains a symbolic link
- has more than 2000 files or weighs more than 50 MB

## Updates

Installing a folder whose `id` is already installed replaces the plugin:

- the new files and manifest are used
- the enabled state is reset to enabled
- permissions listed in the new manifest are re-offered on the install screen
- every instance of its widgets in projects keeps its saved state, as long as widget `id`s didn't change

When a development link's manifest gains a permission, the plugin shows "Needs review" until the user allows or denies it.

## Disable and remove

- **Disable**: widgets disappear from the drawer and the plugin loses all its permissions. Saved states stay in the layouts.
- Built-in plugins can be disabled but not removed. They stay disabled across updates.
- **Remove**: unregisters the plugin, removes its widgets from layouts and deletes its verified copy. A development link folder is never deleted.

## Where things live

| What | Where |
| --- | --- |
| registry of installed plugins | `plugins.json` in Tessera's user data |
| verified copies | `plugins/<plugin id>/` in Tessera's user data |
| activity log | `permissions.log` in Tessera's user data |
| widget state | the project's layout, under `.tessera/` |
