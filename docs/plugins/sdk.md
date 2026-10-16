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

  ui: {
    toast(kind: 'success' | 'info' | 'warning' | 'error', message: string): Promise<void>;
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
    runSystem(program: string, args?: string[], options?: { timeout?: number }): Promise<ExecResult>;
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
| `invalid params` | missing parameter, wrong type, text too long, state too large |
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
