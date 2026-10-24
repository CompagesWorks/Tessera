# Your first plugin

We'll build a "Quick notes" widget: a text area whose content is saved in the project's layout.

Shortcut: `npm run plugin -- new my-plugin` creates a working starting point (see [Packaging](packaging.md)). This page builds one by hand so you see every piece.

## 1. The folder

Create a folder anywhere, for example `D:/dev/quick-notes/`, with four files.

### manifest.json

```json
{
  "id": "yourname.quick-notes",
  "name": "Quick notes",
  "version": "0.1.0",
  "author": "yourname",
  "description": "A text area saved with the project.",
  "icon": "sticky",
  "engines": { "tessera": "^0.1.0" },
  "permissions": [],
  "contributes": {
    "widgets": [
      {
        "id": "pad",
        "title": "Quick notes",
        "description": "Project scratchpad",
        "icon": "sticky",
        "category": "tools",
        "entry": "widget.html"
      }
    ]
  }
}
```

Replace `yourname` with your author name. The `id` must be unique: it identifies the plugin everywhere. Details: [manifest.json](manifest.md).

### widget.html

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <script src="/__tessera/sdk.js"></script>
    <link rel="stylesheet" href="widget.css" />
  </head>
  <body>
    <textarea id="pad" class="atrium-input" placeholder="Write here…"></textarea>
    <script src="widget.js"></script>
  </body>
</html>
```

Load `/__tessera/sdk.js` before anything else: it defines `window.tessera` and adds the Atrium styles and Bootstrap icons.

### widget.css

```css
html,
body {
  height: 100%;
  margin: 0;
}

#pad {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  resize: none;
}
```

### widget.js

```js
(async () => {
  const pad = document.getElementById('pad');

  await tessera.ready;
  const state = await tessera.widget.getState();
  pad.value = typeof state.text === 'string' ? state.text : '';

  let timer;
  pad.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => tessera.widget.setState({ text: pad.value }), 400);
  });
})();
```

We wait 400 ms after the last keystroke before saving: the SDK limits each widget to 40 calls per second, and the state is capped at 64 KB.

## 2. Load it into Tessera

1. Open the **Plugins** page.
2. **Load a folder** → pick the folder.
3. Tessera reads the manifest and shows what it found (or the exact error).
4. Choose **Development link**: Tessera uses your folder as is, so you can edit files without reinstalling.
5. Open a project and open the widget drawer: "Quick notes" shows up under **Tools**.

## 3. Iterate

- Changed `widget.js`, `widget.css` or `widget.html`: switch tab and back, or reopen the project. Files are never cached.
- Changed `manifest.json` (title, icon, new widget, new permission): load the same folder again from the Plugins page. Same `id` means the plugin is replaced.
- To see console errors and set breakpoints, see [Debugging](debugging.md).

The widget reloads every time the layout changes, which is why the state is restored on start. See [Lifecycle and size](lifecycle.md).

## 4. Read the project's files

Add the permission to the manifest:

```json
"permissions": ["fs.project.read"]
```

Then:

```js
try {
  const entries = await tessera.files.list('');
  const readme = entries.find((e) => e.kind === 'file' && e.name.toLowerCase() === 'readme.txt');
  if (readme) pad.value = await tessera.files.readText(readme.path);
} catch (error) {
  tessera.ui.toast('error', error.message);
}
```

Reload the plugin: Tessera asks you to accept the new permission. Always keep the `catch`: the user can revoke a permission at any time. See [Permissions](permissions.md).

## 5. Share it

When the plugin is ready:

- Bump `version` in the manifest for every release.
- Pack it: `npm run plugin -- pack my-plugin` writes a `.tessera-plugin` file. Whoever installs it uses **Install a package**: Tessera checks every file's hash, copies it, and refuses to run it if a file changes afterwards. See [Packaging](packaging.md) and [Installation and integrity](installation.md).
- Go through the [pre-release checklist](troubleshooting.md#before-you-release).
