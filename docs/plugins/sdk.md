# SDK: `window.tessera`

Load the SDK with:

```html
<script src="/__tessera/sdk.js"></script>
```

It creates the global `tessera` object (frozen), adds the Atrium and Bootstrap Icons stylesheets, and applies Tessera's theme to the page.

## Basics

- Every method returns a **promise**.
- A rejected promise holds an `Error` whose `message` explains the refusal. See [Errors](#errors).
- Each widget can make at most **40 calls per second**; beyond that, calls fail with `rate limited`.
- Each widget **instance** has its own state and its own call counter: two copies of the same widget in a layout share nothing.

## Signatures

```ts
interface Tessera {
  ready: Promise<InitPayload>;
  on(event: 'init', listener: (payload: InitPayload) => void): () => void;
  on(event: 'theme', listener: (payload: ThemePayload) => void): () => void;
  on(event: 'files.changed', listener: (payload: { paths: string[] }) => void): () => void;
  on(event: 'files.dropped', listener: (payload: { paths: string[] }) => void): () => void;
  on(event: 'files.selected', listener: (payload: { path: string | null }) => void): () => void;

  ui: {
    toast(kind: 'success' | 'info' | 'warning' | 'error', message: string): Promise<void>;
    form(spec: FormSpec): Promise<Record<string, string | boolean> | null>;
    progress(title: string, message?: string): Promise<{ update(message: string): Promise<void>; close(): Promise<void> }>;
    contextMenu(spec: { x: number; y: number; path?: string; items?: MenuItem[] }): Promise<string | null>;
  };
  widget: {
    getState(): Promise<Record<string, unknown>>;
    setState(state: Record<string, unknown>): Promise<void>;
  };
  settings: {
    get(): Record<string, boolean | string | number>;
    get(key: string): boolean | string | number | undefined;
    set(key: string, value: boolean | string | number): Promise<Record<string, boolean | string | number>>;
    reset(key?: string): Promise<Record<string, boolean | string | number>>;
    onChange(listener: (values: Record<string, boolean | string | number>) => void): () => void;
  };
  project: {
    info(): Promise<ProjectInfo>;
  };
  files: FileApi & {
    watch(listener: (payload: { paths: string[] }) => void): () => void;
    private: FileApi;
  };
  external: FileApi & {
    pick(): Promise<boolean>;
    info(): Promise<{ picked: boolean; name: string | null }>;
  };
  net: {
    fetch(url: string, options?: FetchOptions): Promise<NetResponse>;
  };
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
  };
  exec: {
    run(args?: string[], options?: { timeout?: number }): Promise<ExecResult>;
    runSystem(program: string, args?: string[], options?: { timeout?: number; detach?: boolean; onOutput?(line: string, kind: 'stdout' | 'stderr'): void }): Promise<ExecResult | null>;
    pickSystem(program: string): Promise<boolean>;
    systemInfo(): Promise<Record<string, boolean>>;
  };
  discord: {
    setActivity(activity: DiscordActivity | null): Promise<void>;
  };
  clipboard: {
    writeText(text: string): Promise<void>;
  };
  notify: {
    show(title: string, body?: string): Promise<void>;
  };
  shell: {
    openUrl(url: string): Promise<void>;
    reveal(path?: string, scope?: 'project' | 'private' | 'external'): Promise<void>;
  };
  projects: {
    list(): Promise<ProjectListItem[]>;
  };
}

interface FileApi {
  list(path?: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array | ArrayBuffer | number[]): Promise<void>;
  writeText(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

interface ThemePayload {
  theme: 'dark' | 'light';
  tokens: Record<string, string>;
}

interface InitPayload extends ThemePayload {
  language: 'fr' | 'en';
  widgetId: string;
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  responseType?: 'text' | 'base64';
}

interface NetResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  encoding: 'text' | 'base64';
}

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface DiscordActivity {
  details?: string;
  state?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
}

interface ProjectListItem {
  name: string;
  kind: 'skin' | 'stage' | 'ui' | 'audio' | 'effect' | 'other';
  status: 'draft' | 'wip' | 'done' | 'published';
  tags: string[];
  collection: string | null;
  favorite: boolean;
  updatedAt: string;
  missing: boolean;
}

interface ProjectInfo {
  name: string;
  kind: 'skin' | 'stage' | 'ui' | 'audio' | 'effect' | 'other';
  status: 'draft' | 'wip' | 'done' | 'published';
}

interface DirEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size: number;
}
```

## Startup

### `tessera.ready`

Resolves once Tessera has answered the widget. Await it before any other call.

```js
const { theme, language, widgetId } = await tessera.ready;
```

- `language`: Tessera's UI language, so you can translate your widget.
- `widgetId`: unique id of this widget instance in the layout.

## Events

### `tessera.on(event, listener)`

Subscribes `listener` to an event. Returns a function that unsubscribes it.

| Event | Payload | When |
| --- | --- | --- |
| `init` | `InitPayload` | once, when the widget starts |
| `theme` | `{ theme, tokens }` | the user switches theme, or applies a plugin theme |
| `files.changed` | `{ paths }` | a project file changed, while [`tessera.files.watch`](#tesserafileswatchlistener) is active |
| `fileAction` | `{ id, paths }` | the user picked one of your [file actions](manifest.md#file-actions) in the Explorer (host page only) |
| `files.dropped` | `{ paths }` | the user dragged files from the Explorer and dropped them on your widget; needs `fs.project.read`. Listening is enough to accept the drop |
| `files.selected` | `{ path }` | the user selected a file in the Explorer (`null` when nothing is selected); needs `fs.project.read` |
| `titlebar` | `{ id }` | the user clicked one of your [titlebar buttons](manifest.md#titlebar-buttons) (host page only) |

```js
const off = tessera.on('theme', ({ theme }) => {
  chart.setDark(theme === 'dark');
});
```

The theme is already applied to the page for you (`data-atrium-theme` on `<html>`, plus the `--atrium-*` tokens of a plugin theme in `tokens`), so `atrium-*` components follow it with no code. The event is only needed for what you draw yourself (canvas, SVG…).

## UI

### `tessera.ui.toast(kind, message)`

Shows a notification in Tessera.

| Parameter | Values |
| --- | --- |
| `kind` | `'success'`, `'info'`, `'warning'`, `'error'` |
| `message` | 1 to 300 characters of plain text (no HTML) |

### `tessera.ui.contextMenu(spec)`

Opens Tessera's context menu at a point of your widget. Pass `path` (a project file) to add the actions other plugins contribute for that file type with [`contributes.fileActions`](manifest.md#file-actions), after your own items. Resolves with the `id` of the item the user picked among yours, or `null` if another menu replaces it. Picking another plugin's action runs it in that plugin and leaves your promise pending until your next menu.

```js
row.addEventListener('contextmenu', async (event) => {
  event.preventDefault();
  const id = await tessera.ui.contextMenu({
    x: event.clientX,
    y: event.clientY,
    path: 'sources/fighter/mario/model/body/c00/def_mario_001_col.nutexb',
    items: [{ id: 'rename', label: 'Rename', icon: 'pencil' }, 'separator', { id: 'delete', label: 'Delete', icon: 'trash3', danger: true }],
  });
  if (id === 'delete') removeRow();
});
```

| Field | Rule |
| --- | --- |
| `x`, `y` | position in your page, like `event.clientX` / `event.clientY` |
| `path` | optional project path; adds other plugins' file actions |
| `items` | 0 to 20 items `{ id, label, icon?, danger?, disabled? }` or `'separator'` |

No permission is needed to open a menu. Adding entries to other plugins' menus needs [`ui.menus`](permissions.md#uimenus).

### `tessera.ui.progress(title, message?)`

Shows a Tessera modal with a spinner, your `title`, an optional `message` and the elapsed time, for long work such as running a program. Resolves with a handle:

| | |
| --- | --- |
| `update(message, percent?)` | changes the message and, with a number from 0 to 100, shows a progress bar |
| `close()` | closes the modal |

One per widget or host page: calling it again updates the open one. While it runs, an entry with the title and percentage stays in Tessera's status bar: the user can hide the modal (the work goes on) and click that entry to show it again. Both go away on `close()` or when your page unloads. `title` 1 to 60 characters, `message` 300 max.

```js
const progress = await tessera.ui.progress('Converting intro.mp4…', 'This can take a few minutes.');
try {
  await tessera.exec.runSystem('ffmpeg', args, { timeout: 600000 });
} finally {
  progress.close();
}
```

### `tessera.ui.form(spec)`

Opens a Tessera modal with fields and resolves with the values (`{ [field id]: value }`), or `null` if the user cancels. One form at a time per widget or host page. The plugin name is shown in the modal.

```js
const values = await tessera.ui.form({
  title: 'Export',
  icon: 'box-arrow-up',
  message: 'sources/fighter/mario',
  confirmText: 'Export',
  fields: [
    { type: 'select', id: 'quality', label: 'Quality', options: [{ value: 'fast', label: 'Fast' }, { value: 'best', label: 'Best' }], value: 'best' },
    { type: 'text', id: 'name', label: 'Name', placeholder: 'my-mod' },
    { type: 'checkbox', id: 'zip', label: 'Zip it', value: true },
  ],
});
```

| Field | Rule |
| --- | --- |
| `title` | 1 to 60 characters |
| `icon` | Bootstrap Icons name, optional |
| `message` | 300 characters max, optional |
| `confirmText` | 1 to 24 characters, default OK |
| `fields` | 1 to 12 fields: `select` (1 to 40 `options`), `text` (500 characters max) or `checkbox`; `id` starts with a letter, 40 max |

## Translations

Reads your plugin's [`locales/`](manifest.md#translations) files in Tessera's language, with English as fallback.

| | |
| --- | --- |
| `tessera.i18n.language` | Tessera's language, like `'en'` or `'fr'` |
| `tessera.i18n.t(key, params?)` | the translation of `key`, with `{{name}}` replaced by `params.name`; the key itself when missing |

Translations arrive with the `init` event: call `t` after `await tessera.ready`. Elements with these attributes are translated for you at the same moment:

| Attribute | Sets |
| --- | --- |
| `data-i18n="key"` | the text |
| `data-i18n-placeholder="key"` | `placeholder` |
| `data-i18n-title="key"` | `title` |
| `data-i18n-label="key"` | `aria-label` |

```html
<button data-i18n="convertAll"></button>
<input type="search" data-i18n-placeholder="filter" />
```

```js
await tessera.ready;
tessera.ui.toast('success', tessera.i18n.t('converted', { name: 'mario.nutexb' }));
```

## Widget state

The state is a JSON object saved **in the project's layout**, for this widget instance. It survives closing the project and restarting Tessera. It is the only persistent storage a plugin has.

### `tessera.widget.getState()`

Returns the saved state, or `{}` for a fresh widget. Always check the type of every value: the state may come from an older version of your plugin.

### `tessera.widget.setState(state)`

**Replaces** the whole state (no merge).

- `state` must be an object (not an array, not a primitive)
- 64 KB max once serialized to JSON, otherwise `invalid params`
- JSON values only: no functions, `Date`, `Map`…

```js
const state = await tessera.widget.getState();
await tessera.widget.setState({ ...state, zoom: 2 });
```

For state that changes often (typing, dragging), batch writes with a delay instead of calling `setState` on every event.

A good habit: put a version number in the state so you can migrate it.

```js
const state = await tessera.widget.getState();
const data = state.v === 2 ? state : { v: 2, items: Array.isArray(state.list) ? state.list : [] };
```

## Project

### `tessera.project.info()`

Returns the name, kind and status of the open project. No permission needed. The project's path on disk is never exposed.

## Settings

Reads and writes the options declared in [`contributes.settings`](manifest.md#settings). No permission needed, and a plugin only sees its own values.

| Call | Does |
| --- | --- |
| `tessera.settings.get()` | all values, as an object. Available after `await tessera.ready`. |
| `tessera.settings.get(key)` | one value (the default if the user never changed it) |
| `tessera.settings.set(key, value)` | changes a value. Resolves with all values. Rejects with `plugin-settings:invalid-value` if it doesn't fit the definition. |
| `tessera.settings.reset(key?)` | puts one value, or all of them, back to the default |
| `tessera.settings.onChange(listener)` | called with all values each time one changes (from the settings page, an imported profile or your own `set`). Returns an unsubscribe function. |

```js
await tessera.ready;
const render = () => (title.textContent = tessera.settings.get('greeting'));
render();
tessera.settings.onChange(render);
```

## Files

Every path is **relative to the root of its scope**, with `/` as separator. `''` is the root. A path containing `..` is refused.

| Scope | Root | Reading needs | Writing needs |
| --- | --- | --- | --- |
| `tessera.files` | the open project (without `.tessera/`) | [`fs.project.read`](permissions.md#fsprojectread) | [`fs.project.write`](permissions.md#fsprojectwrite) |
| `tessera.files.private` | `.tessera/plugins/<plugin id>/` in the open project | [`fs.project.write`](permissions.md#fsprojectwrite) | [`fs.project.write`](permissions.md#fsprojectwrite) |
| `tessera.external` | the folder picked by the user | [`fs.external`](permissions.md#fsexternal) | [`fs.external`](permissions.md#fsexternal) |

The three scopes share the same methods, described below with `tessera.files`.

### `tessera.files.list(path = '')`

Lists a folder.

- folders first, then files, sorted by name (natural order: `2` before `10`)
- at most 2000 entries per folder
- the `.tessera/` folder and symbolic links are hidden
- each entry's `path` can be passed straight to another call of the same scope
- `size` is in bytes, `0` for folders

```js
async function walk(dir = '') {
  const files = [];
  for (const entry of await tessera.files.list(dir)) {
    if (entry.kind === 'dir') files.push(...(await walk(entry.path)));
    else files.push(entry);
  }
  return files;
}
```

Mind the 40 calls per second: on a large tree, expand folders on demand rather than all at once.

### `tessera.files.readText(path)`

Reads a file as UTF-8 text.

- **1 MB** max (1,048,576 bytes), otherwise `file too large`
- a binary file is decoded as UTF-8 anyway and gives garbage: use `readBytes` for those

### `tessera.files.readBytes(path)` / `tessera.files.writeBytes(path, data)`

Same as `readText` / `writeText` for binary files (`.nutexb`, `.nus3audio`, images…), with a `Uint8Array`. **20 MB** max each way, same permissions as the text versions.

```js
const bytes = await tessera.files.readBytes('fighter/mario/model/body/c00/def_mario_001_col.nutexb');
await tessera.files.private.writeBytes('backup/def_mario_001_col.nutexb', bytes);
```

### `tessera.files.writeText(path, content)`

Creates or replaces a file with UTF-8 text. Missing parent folders are created.

- **5 MB** max, otherwise `file too large`
- refused if `path` is a folder (`not a file`)

### `tessera.files.mkdir(path)`

Creates a folder and its missing parents. Does nothing if it already exists.

### `tessera.files.remove(path)`

Moves a file or a folder (with its content) to the **system trash**. The root of the scope can't be removed.

### `tessera.files.rename(from, to)`

Moves or renames a file or folder inside the same scope. Refused if `to` already exists (`already exists`).

### `tessera.files.watch(listener)`

Calls `listener({ paths })` when files of the project change, by you, the user or another program. Needs `fs.project.read`. Returns a function that stops watching.

- changes are grouped: one call every 300 ms at most, with up to 200 paths
- changes inside `.tessera/` are not reported
- `paths` can include deleted files: don't assume they still exist

```js
const stop = tessera.files.watch(({ paths }) => {
  if (paths.some((p) => p.endsWith('.prc'))) refresh();
});
```

### Private folder

`tessera.files.private` has the same methods (without `watch`) and works in `.tessera/plugins/<plugin id>/` of the open project. Use it for caches and generated data that belong to the project but shouldn't clutter its sources. Nothing else can reach it: `tessera.files` never sees `.tessera/`.

```js
await tessera.files.private.writeText('index.json', JSON.stringify(index));
```

### Outside folder

`tessera.external` has the same methods (without `watch`) and works in the folder the user picked.

#### `tessera.external.pick()`

Opens the system folder picker. Resolves `true` if the user picked a folder, `false` if they cancelled. The user can also pick or forget the folder in Plugins → your plugin.

#### `tessera.external.info()`

Returns `{ picked, name }`: whether a folder is set, and its **name only** (never the full path).

```js
const { picked } = await tessera.external.info();
if (!picked && !(await tessera.external.pick())) return;
await tessera.external.writeText('mods/my-skin/config.json', config);
```

#### `tessera.export.deploy()`

Needs `fs.external` **and** `fs.project.read`. Exports the open project (like the Export button) and copies the mod folder into the picked folder, as `<picked folder>/<mod name>`. Resolves the mod folder name.

A previous copy is replaced only if Tessera deployed it (it leaves a `.tessera-deploy` file inside). Any other folder with the same name is left alone and the call fails with `… already exists in the mods folder and was not deployed by Tessera`.

#### `tessera.textures.preview(path, name?)`

Decodes a project texture (`.bntx`, `.nutexb`, `.dds` or an image) and resolves to `{ data, width, height, format, mipmaps }`. `data` is a base64 PNG of the first mip, shrunk to 512 px on its longest side; `width` and `height` are the original size. For a `.bntx` holding several textures, `name` picks one (the first otherwise), and its channel selectors are applied, so a BC4 mask comes out white with the mask in alpha. Needs `fs.project.read`.

```js
const { data } = await tessera.textures.preview('sources/layout_arc/timg/__Combined.bntx', 'com_white32^u');
image.src = `data:image/png;base64,${data}`;
```

#### `tessera.textures.replace(path, name, data)`

Replaces the pixels of one texture inside a project `.bntx` (`name` picks it in a multi-texture file like `__Combined.bntx`; `undefined` takes the first). `data` is the new image as bytes (`Uint8Array`): PNG, JPEG, WebP, BMP, TGA, TIFF or DDS. The texture keeps its format, size and mip count: the image is resized to fit and re-encoded, and the channel selectors are reversed so a mask stays a mask. Needs `fs.project.read` and `fs.project.write`.

#### `tessera.textures.add(path, name, format, data)`

Adds a new texture named `name` to a project `.bntx` (like `timg/__Combined.bntx`). `data` is the image as bytes (PNG, JPEG, WebP, BMP, TGA, TIFF or DDS), kept at its own size with one mip level. `format` is one of the [`format` values of `convert`](#tesseratexturesconvertfrom-to-options), for example `BC7RgbaUnormSrgb`. `BC4RUnorm` is stored as a white mask (alpha from the image) and `BC5RgUnorm` as luminance + alpha, like Smash's `^s` and `^t` textures. Fails if the name is already taken. The file is rewritten with a new name dictionary and relocation table. Needs `fs.project.read` and `fs.project.write`.

#### `tessera.textures.export(path, name, to)`

Writes one texture of a project texture file to `to` as a full-size PNG, channel selectors applied. Needs `fs.project.read` and `fs.project.write`.

```js
await tessera.textures.export('sources/layout_arc/timg/__Combined.bntx', 'com_white32^u', 'sources/layout_arc_textures/com_white32^u.png');
await tessera.textures.replace('sources/layout_arc/timg/__Combined.bntx', 'com_white32^u', new Uint8Array(await file.arrayBuffer()));
```

#### `tessera.textures.convert(from, to, options?)`

Needs `fs.project.write` **and** `fs.project.read`. Converts a texture inside the project, picked from the extensions of `from` and `to`. `from` can be `.nutexb`, `.bntx`, `.dds`, `.png`, `.jpg`, `.webp`, `.gif`, `.bmp`, `.tga` or `.tiff`; `to` can be `.nutexb`, `.dds` or `.png`. Works the same on Windows, macOS and Linux.

| Option | Values | Default |
|---|---|---|
| `format` | an image format such as `BC7RgbaUnormSrgb`, `BC7RgbaUnorm`, `BC1RgbaUnormSrgb`, `BC5RgUnorm`, `Rgba8UnormSrgb`… | the format of `to` if it already exists, then the format of `from`, then `BC7RgbaUnormSrgb` |
| `mipmaps` | `GeneratedAutomatic`, `FromSurface`, `Disabled` | `GeneratedAutomatic` |
| `quality` | `Fast`, `Normal`, `Slow` | `Normal` |
| `gammaFix` | `true` darkens mid-tones before encoding: each RGB value becomes `round(255 × (v / 255) ^ 2.2)`, alpha unchanged. Same as Switch Toolbox's "Gamma Fix (Smash Ultimate)", for textures that look washed out in game | `false` |

`.png` output keeps the first layer and mipmap and ignores the options. `to` is overwritten and the change goes to the project history.

```js
await tessera.textures.convert('sources/fighter/mario/model/body/c00/def_mario_001_col.nutexb', 'def_mario_001_col.png');
await tessera.textures.convert('def_mario_001_nor.png', 'sources/fighter/mario/model/body/c00/def_mario_001_nor.nutexb', { format: 'BC7RgbaUnorm' });
```

#### `tessera.ssbh.read(path)`

Reads a Smash Ultimate SSBH file from the project with [ssbh_data](https://docs.rs/ssbh_data) and resolves to its data as JSON: `.numdlb` and `.nusrcmdlb` (model), `.numatb` (materials), `.nusktb` (skeleton), `.nuhlpb` (helper bones), `.nuanmb` (animation), `.numshexb` and `.adjb`. Field names are the ones of ssbh_data (`entries`, `material_label`, `param_id`...). Needs `fs.project.read`.

```js
const modl = await tessera.ssbh.read('sources/fighter/mario/model/body/c00/model.numdlb');
modl.entries[0]; // { mesh_object_name, mesh_object_subindex, material_label }
```

#### `tessera.ssbh.write(path, data)`

Writes `data`, in the shape `tessera.ssbh.read` gives, back to a project SSBH file of the same type (picked from the extension). Invalid data fails with `invalid ssbh data: …` and leaves the file untouched. The change goes to the project history. Needs `fs.project.read` and `fs.project.write`.

```js
const matl = await tessera.ssbh.read('sources/fighter/mario/model/body/c00/model.numatb');
matl.entries[0].textures[0].data = 'def_mario_001_col_alt';
await tessera.ssbh.write('sources/fighter/mario/model/body/c00/model.numatb', matl);
```

#### `tessera.ssbh.meshes(path, skeleton?)`

Reads a project `.numshb` and resolves to one entry per mesh object, ready for WebGL: `{ name, subindex, positions, normals, uvs, indices }`. `positions` and `normals` are `Float32Array`s of xyz, `uvs` is a `Float32Array` of the `map1` UVs (or the first UV set, `null` if none), and `indices` is a `Uint32Array` of triangles. With a `.nusktb` `skeleton`, meshes that have no bone weights are moved to their parent bone, as in game, and each entry also has `bones` and `weights`: `Float32Array`s of 4 values per vertex, the skeleton bone indices and their weights (the 4 strongest, summing to 1; a mesh with no weights is bound to its parent bone). Without a skeleton they are `null`. Needs `fs.project.read`.

#### `tessera.arc.pick()`

Asks the user to pick a Smash Ultimate `.arc` file and keeps it as the plugin's outside location (it replaces a picked folder). Resolves to `true`, or `false` if cancelled. Needs `fs.external`.

#### `tessera.arc.list(path = '')`

Lists a folder of the picked `data.arc` (or of the `data.arc` inside a picked [outside folder](#outside-folder)), with [smash-arc](https://docs.rs/smash-arc): `[{ name, path, dir, size }]`, folders first. `''` is the root, `stream:` holds the streamed files. The first call downloads the file names ([archive-hashes](https://github.com/ultimate-research/archive-hashes), about 5 MB) once and keeps the arc open. Unnamed entries show as `0x…` hashes. Sizes are for the US English region. Needs `fs.external`.

#### `tessera.arc.extract(path)`

Extracts an arc file, or a folder with everything under it, to `extracted/<path>` in the project, outside `sources` so nothing extracted gets deployed (`stream:` becomes `stream;`, as ARCropolis expects). Files already in the project are kept, never overwritten. Resolves to `{ written, skipped, failed }`. Needs `fs.project.write` and `fs.external`.

## Network

Needs [`net`](permissions.md#net).

### `tessera.net.fetch(url, options)`

Makes an HTTPS request to a domain declared in the manifest.

| Option | Default |
| --- | --- |
| `method` | `'GET'` |
| `headers` | `{}`, `Cookie`, `Host`, `Origin`, `Referer` and similar headers are dropped |
| `body` | none, a string up to 5 MB |
| `responseType` | `'text'` for text and JSON types, `'base64'` otherwise |

Resolves with the response, even for an HTTP error status (check `status`). `body` is the decoded text, or base64 when `encoding` is `'base64'`.

```js
const response = await tessera.net.fetch('https://api.gamebanana.com/Core/Item/Data?itemtype=Mod&itemid=1');
if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
const data = JSON.parse(response.body);
```

## Secrets

Needs [`secrets`](permissions.md#secrets). Keys: `A-Z`, `a-z`, `0-9`, `.`, `_`, `-`, 1 to 64 characters.

| Method | |
| --- | --- |
| `tessera.secrets.get(key)` | the value, or `null` |
| `tessera.secrets.set(key, value)` | stores it encrypted, 16 KB max, 64 secrets max |
| `tessera.secrets.delete(key)` | removes it |
| `tessera.secrets.keys()` | the stored keys, sorted |

Never put a secret in the widget state: the state is saved in plain text in the project.

## Programs

Needs [`exec`](permissions.md#exec).

### `tessera.exec.run(args = [], options)`

Runs the program declared in the manifest, in the open project's folder, after the user approves the exact command.

- `args`: 64 strings max, passed as is (no shell, no globbing, no variables)
- `options.timeout`: in ms, 1000 to 600000, 60000 by default. Past it, the program is stopped and `timedOut` is `true`
- resolves with the exit `code`, `stdout` and `stderr` (1 MB kept each)
- rejects with `refused by user` if the user declines

```js
const result = await tessera.exec.run(['--input', 'textures/a.png', '--format', 'nutexb']);
if (result.code !== 0) tessera.ui.toast('error', result.stderr.slice(0, 300));
```

## Programs of the PC

Needs [`exec.system`](permissions.md#execsystem). `program` is a name declared in the manifest.

| Method | |
| --- | --- |
| `tessera.exec.pickSystem(program)` | opens the system file picker so the user chooses the file. `true` if picked |
| `tessera.exec.systemInfo()` | `{ git: true, … }`: which programs are picked |
| `tessera.exec.runSystem(program, args, options)` | like [`exec.run`](#tesseraexecrunargs---options), after the user approves the command |

```js
const { git } = await tessera.exec.systemInfo();
if (!git && !(await tessera.exec.pickSystem('git'))) return;
const result = await tessera.exec.runSystem('git', ['add', '-A']);
```

`{ detach: true }` starts the program and returns `null` right away, without waiting or killing it at the timeout. Use it to launch an app such as an emulator.

`{ projectFile: 'images/icon.png' }` appends that existing project file's absolute path as the last argument. It requires `fs.project.read` and keeps the file inside the project scope. For example, `tessera.exec.runSystem('editor', [], { detach: true, projectFile: 'images/icon.png' })` opens an image in a selected editor.

`{ onOutput(line, kind) }` receives the program's output line by line while it runs (`kind` is `'stdout'` or `'stderr'`), for example to show progress with [`tessera.ui.progress`](#tesserauiprogresstitle-message). The full output is still in the result. Works with `exec.run` too.

```js
const progress = await tessera.ui.progress('Converting…');
await tessera.exec.runSystem('ffmpeg', ['-progress', 'pipe:1', '-i', 'in.mp4', 'out.h264'], {
  timeout: 600000,
  onOutput: (line) => line.startsWith('out_time=') && progress.update(line.slice(9)),
}).finally(() => progress.close());
```

`program not picked` and `program changed since it was picked, pick it again in Plugins` mean the user has to (re)pick the file.

## Discord

Needs [`discord.rpc`](permissions.md#discordrpc).

### `tessera.discord.setActivity(activity)`

Sets the Discord status, or clears it with `null`. Texts are 2 to 128 characters; images are asset keys of your Discord application or HTTPS URLs; timestamps are in ms.

```js
await tessera.discord.setActivity({
  details: `Modding ${project.name}`,
  state: 'Editing textures',
  startTimestamp: Date.now(),
  largeImage: 'tessera',
});
```

Fails with `discord is not running` when Discord is closed: handle it quietly.

## Clipboard

Needs [`clipboard.write`](permissions.md#clipboardwrite). `tessera.clipboard.writeText(text)` copies up to 100,000 characters. There is no read method.

## Notifications

Needs [`notify.system`](permissions.md#notifysystem). `tessera.notify.show(title, body)` shows a system notification titled `<plugin name> · <title>` (title 64, body 256 characters max). One every 3 seconds at most, otherwise `rate limited`.

## Links and explorer

Needs [`open.external`](permissions.md#openexternal).

| Method | |
| --- | --- |
| `tessera.shell.openUrl(url)` | opens an HTTPS link in the browser, after the user confirms the site |
| `tessera.shell.reveal(path, scope)` | shows a file or folder in the system explorer. `scope`: `'project'` (default), `'private'` or `'external'` |

## All projects

Needs [`projects.list`](permissions.md#projectslist). `tessera.projects.list()` returns every project as a `ProjectListItem`: tag and collection **names**, no path, no id.

## Errors

| Message | Cause |
| --- | --- |
| `permission denied: <permission>` | permission missing from the manifest, not granted, revoked by the user, or plugin disabled |
| `invalid params (method …)` | missing parameter, wrong type, text too long, state too large; the method and, when known, the field and the rule follow in parentheses |
| `rate limited` | more than 40 calls in the last second |
| `unknown method` | the method doesn't exist (modified SDK or raw `postMessage`) |
| `outside scope` | the path leaves its scope or targets `.tessera/` |
| `file too large` | text read over 1 MB, text write over 5 MB, binary over 20 MB, or the path is not a file |
| `not a file` / `already exists` | `writeText` on a folder / `rename` onto an existing path |
| `no project open` | a project method called without an open project |
| `no folder picked` | `tessera.external` used before the user picked a folder |
| `domain not declared: <host>` | `net.fetch` to a domain (or a redirect) missing from the manifest |
| `only https is allowed` / `IP addresses are not allowed` | `net.fetch` URL refused |
| `response too large` / `too many redirects` | `net.fetch` response over 10 MB / more than 5 redirects |
| `encryption unavailable on this system` | the OS can't encrypt secrets |
| `program hash mismatch` / `program not found` | the program file doesn't match the manifest |
| `refused by user` | the user declined `exec.run`, `exec.runSystem` or `shell.openUrl` |
| `program not declared` / `program not picked` / `program changed…` | `exec.system` program missing from the manifest, not picked yet, or modified since |
| `discord is not running` / `discord refused: …` | Discord is closed, or refused the client id |
| `ENOENT: …` | the file or folder doesn't exist |

Always handle errors: the user can revoke a permission while your widget is running.

```js
try {
  const text = await tessera.files.readText('config/stage.json');
} catch (error) {
  if (error.message.startsWith('permission denied')) showPermissionHint();
  else tessera.ui.toast('error', error.message);
}
```

## Low-level protocol

The SDK is a thin layer over `postMessage`. There's no point reimplementing it: the parent page ignores any message that doesn't come from your iframe, and the same checks apply either way. The SDK also answers the [watchdog](sandbox.md#watchdog) pings automatically: a widget that doesn't load the SDK will be flagged as not responding.
