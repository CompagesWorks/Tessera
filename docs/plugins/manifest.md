# manifest.json

`manifest.json` sits at the root of the plugin folder. It must be valid JSON and at most **64 KB**. Tessera validates all of it: on the first error, the plugin is rejected with the path of the faulty field (for example `contributes.widgets.0.entry: invalid path`).

## Full example

```json
{
  "id": "yourname.my-plugin",
  "name": "My plugin",
  "version": "1.0.0",
  "author": "yourname",
  "description": "What the plugin does.",
  "icon": "puzzle",
  "engines": { "tessera": "^0.1.0" },
  "permissions": ["fs.project.read"],
  "contributes": {
    "widgets": [
      {
        "id": "main",
        "title": "My widget",
        "description": "One short sentence",
        "icon": "stars",
        "category": "tools",
        "entry": "widget.html"
      }
    ]
  }
}
```

## Plugin fields

| Field | Required | Rule | Default |
| --- | --- | --- | --- |
| `id` | yes | at least two dot-separated segments (`author.name`), each made of `a-z`, `0-9`, `-`. 64 characters max. `core.*` and `tessera.*` are reserved. | |
| `name` | yes | 1 to 60 characters | |
| `version` | yes | semver: `1.2.3` or `1.2.3-beta.1` | |
| `author` | yes | 1 to 60 characters | |
| `description` | no | 300 characters max | `""` |
| `icon` | no | a [Bootstrap Icons](https://icons.getbootstrap.com/) name without the `bi-` prefix (`a-z`, `0-9`, `-`, 40 max), or the path of an image in the plugin folder (`.png`, `.svg`, `.webp`, `.jpg`, `.gif`). The image must exist, or the install is refused (`missing-icon`) | `puzzle`, `icon.svg` |
| `engines.tessera` | yes | the Tessera version range you target, e.g. `^0.1.0` | |
| `permissions` | no | list of [permissions](permissions.md#declaring-permissions), 16 max, each at most once. A string, or an object for `net` and `exec`. An unknown permission rejects the plugin. | `[]` |
| `contributes.widgets` | no | list of widgets, 32 max | `[]` |
| `contributes.themes` | no | list of [themes](#themes), 16 max. Needs `ui.theme`. | `[]` |
| `contributes.uiProvider` | no | the [UI provider](#ui-provider) module. Needs `ui.provider`, and `ui.provider` needs it. | `null` |

Unknown fields are ignored.

`engines.tessera` is stored but not enforced yet. Still declare the version you tested against: Tessera will use it to warn about incompatibilities.

### Choosing the id

The `id` is the plugin's identity: it keys its permissions, its install state and the names of its widgets inside layouts. **Never change it** after release: Tessera would see a different plugin, and widgets already placed in projects would no longer be recognized.

Installing a folder whose `id` already exists **replaces** the existing plugin. That is how updates work.

## Widget fields

| Field | Required | Rule | Default |
| --- | --- | --- | --- |
| `id` | yes | `a-z`, `0-9`, `-`, 1 to 40 characters, unique within the plugin | |
| `title` | yes | 1 to 40 characters, shown in the drawer and on the widget tab | |
| `description` | no | 120 characters max, shown in the drawer | `""` |
| `icon` | no | Bootstrap Icons name or image path, like the plugin `icon` | `puzzle` |
| `category` | no | drawer section, see below | `other` |
| `entry` | yes | path of the HTML page, relative to the plugin folder | |

In a layout, the widget is stored with the type `<plugin id>/<widget id>`, for example `yourname.my-plugin/main`. Renaming a widget `id` therefore breaks the layouts using it, just like renaming the plugin `id`.

### Categories

| Value | Drawer section |
| --- | --- |
| `project` | Project |
| `files` | Files |
| `editing` | Editing |
| `media` | Media |
| `publishing` | Publishing |
| `tools` | Tools |
| `other` | Other |

### `entry` rules

- relative: does not start with `/`
- allowed characters: letters, digits, `.`, `_`, `-`, `/`
- no `..` segment and no empty segment (`a//b.html`)
- 200 characters max
- the file must exist, be a regular file and stay inside the plugin folder, otherwise: `Widget "<id>": <entry> not found`

Several widgets can share one page or each have their own (`widgets/stats.html`, `widgets/preview.html`…).

## Themes

```json
"permissions": ["ui.theme"],
"contributes": {
  "themes": [
    {
      "id": "ember",
      "name": "Ember",
      "base": "dark",
      "tokens": {
        "--atrium-accent-color": "#ff7a45",
        "--atrium-accent-rgb": "255, 122, 69",
        "--atrium-bg-primary": "#1b1512"
      }
    }
  ]
}
```

| Field | Rule |
| --- | --- |
| `id` | `a-z`, `0-9`, `-`, 1 to 40 characters, unique within the plugin |
| `name` | 1 to 40 characters |
| `base` | `dark` or `light`: the Atrium theme applied under your tokens |
| `tokens` | 200 max. Names must start with `--atrium-`. Values: 160 characters max, letters, digits, spaces and `#%(),.-+/'"` only; `url(…)`, `image-set`, `expression` and `@import` are refused |

Only redefine the tokens you need: the others keep their `base` value. The full list of tokens is in Atrium-UI's stylesheet (`--atrium-accent-color`, `--atrium-bg-*`, `--atrium-text-*`, `--atrium-border-*`, `--atrium-font-family`…). For colors with an `-rgb` variant, change both.

## UI provider

> **Danger.** This module runs inside Tessera, outside the sandbox. Read [`ui.provider`](permissions.md#uiprovider) first.

```json
"permissions": ["ui.provider"],
"contributes": {
  "uiProvider": { "entry": "provider.js" }
}
```

`entry` follows the same rules as a widget `entry`. It is loaded as an ES module whose default export is a function. Tessera calls it with `{ base, atrium }`, where `base` is the Atrium-UI provider, and uses the object it returns:

```js
export default function createProvider({ base }) {
  return {
    name: 'my-engine',
    toast(kind, message) {
      base.toast(kind, message);
    },
  };
}
```

| Field of the returned object | Replaces |
| --- | --- |
| `name` | the engine name |
| `toast(kind, message)` | notifications |
| `modal({ title, icon, body, closeText })` | simple dialogs |
| `registerCommands(commands)` | command palette entries |
| `setTheme(theme)`, `setMotion(motion)` | theme and animation changes |
| `atrium` | the whole Atrium-UI instance (tabs, modals, status bar…) |

Anything you don't return keeps Atrium-UI's version. If the module throws or doesn't export a function, Tessera falls back to Atrium-UI. The module can import other files of the plugin with relative paths; those files go through the same integrity checks.

## Settings

`contributes.settings` declares options the user can change in **Settings > Plugin settings**. No permission is needed. Tessera stores the values, checks them against your definition and gives them to your widget through [`tessera.settings`](sdk.md#settings).

```json
"contributes": {
  "settings": [
    { "id": "greeting", "type": "string", "title": "Message", "default": "Hello", "maxLength": 40, "group": "Display" },
    { "id": "loud", "type": "boolean", "title": "Uppercase", "default": false, "group": "Display" },
    { "id": "size", "type": "number", "title": "Text size", "default": 16, "min": 10, "max": 40, "step": 1 },
    { "id": "mode", "type": "select", "title": "Mode", "default": "append", "options": [{ "value": "append", "label": "Append" }, { "value": "replace", "label": "Replace" }] }
  ]
}
```

| Field | Rule |
| --- | --- |
| `id` | letters, digits, `.`, `_` or `-`, starts with a letter, 40 characters max, unique in the plugin |
| `type` | `boolean`, `string`, `number` or `select` |
| `title` / `description` | shown in the settings page (60 / 200 characters) |
| `default` | required, must fit the type (inside `min`/`max`, one of the `options`, within `maxLength`) |
| `group` | optional heading used to group rows |

At most 40 settings per plugin. A stored value that no longer fits the definition (you narrowed `max`, removed an option) is ignored and the default is used. The example plugin `examples/plugins/settings-demo` uses all four types.

## Folder contents

- at most 2000 files and 50 MB
- no symbolic links anywhere in the folder
- the `__tessera/` path is reserved: Tessera serves the SDK there, so a plugin file placed in a `__tessera/` folder is never served

File types served with the right MIME type: `.html`, `.js`, `.css`, `.json`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.woff`, `.woff2`. Anything else is served as binary data and won't be interpreted by the browser.
