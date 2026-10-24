# Packaging and the tessera-plugin tool

A plugin is shared as a single `.tessera-plugin` file. Users install it with Plugins → **Install a package**. The tool that creates it, `tessera-plugin`, also creates new plugins, builds the Rust ones and checks everything the way Tessera does.

## The tool

From the Tessera repository:

```bash
npm install
```

```bash
npm run plugin -- <command> [options]
```

`npm run plugin` rebuilds the tool, then runs it from the repository root, so relative folders start there. Once built, you can also call it directly from any folder:

```bash
node path/to/Tessera/packages/plugin-cli/dist/cli.mjs <command> [options]
```

| Command | What it does |
| --- | --- |
| `new <folder>` | creates a JavaScript plugin |
| `new <folder> --rust` | creates a Rust plugin project (plugin folder + crate) |
| `build [folder]` | compiles the Rust part to WebAssembly into the plugin's `pkg/` (`--debug` for a debug build) |
| `check [folder]` | validates `manifest.json`, the widget entries, the size and file limits, and warns about things the sandbox blocks |
| `pack [folder]` | runs `build` (Rust), then `check`, then writes `<id>-<version>.tessera-plugin` in the current folder (`--out file` to choose, `--no-build` to skip the build) |

`[folder]` defaults to the current folder. It is either a plugin folder, or a project folder with a `tessera-plugin.json`.

`new` accepts `--id yourname.my-plugin`, `--name "My plugin"` and `--author yourname`. Without `--id`, the id is `<author>.<folder name>`.

## Project layout

A JavaScript plugin is a single folder:

```
my-plugin/
  manifest.json
  widget.html
  widget.js
  widget.css
```

A Rust plugin is a project with two parts, described by `tessera-plugin.json`:

```
my-plugin/
  tessera-plugin.json    { "plugin": "plugin", "rust": "rust" }
  plugin/                what gets installed and packed
    manifest.json
    widget.html
    widget.js            loads pkg/
    widget.css
    pkg/                 written by tessera-plugin build
  rust/                  the crate
    Cargo.toml
    src/lib.rs
```

Both paths in `tessera-plugin.json` are relative to the file. The Rust example uses `"plugin": "../../plugins/hello-rust"` and `"rust": "."`.

## Everyday loop

1. `npm run plugin -- new my-plugin` (or `--rust`).
2. Plugins → **Load a folder** → pick the plugin folder → **Development link**.
3. Edit, then reload the widget. For Rust, run `build` first.
4. `npm run plugin -- pack my-plugin` when you want to share it.

## The .tessera-plugin format

A `.tessera-plugin` file is a zip archive with:

- the plugin folder's files, `manifest.json` at the root
- `tessera-package.json`, written by `pack`:

```json
{
  "formatVersion": 1,
  "id": "yourname.my-plugin",
  "version": "1.0.0",
  "files": {
    "manifest.json": "<sha256>",
    "widget.html": "<sha256>",
    "pkg/my_plugin_bg.wasm": "<sha256>"
  }
}
```

`pack` leaves out `node_modules/`, `target/`, `.git/`, editor folders, older `.tessera-plugin` files and system files (`.DS_Store`, `Thumbs.db`). Entries are written with a fixed date, so packing the same files twice gives the same archive.

When a package is installed, Tessera:

1. refuses archives larger than 50 MB, with more than 2000 files, or with paths that leave the folder (`..`, absolute paths, drive letters)
2. extracts it into a temporary folder
3. checks that the files are exactly the ones listed in `tessera-package.json`, with the same hashes (`Unexpected file`, `Missing file`, `Modified file`)
4. checks that `manifest.json` is valid and matches the `id` and `version` of `tessera-package.json`
5. shows the permissions, then installs it as a **Verified copy**, exactly like a folder

The package file is remembered as the source: "Reinstall from source" reads it again. A zip without `tessera-package.json` is refused: build packages with `tessera-plugin pack`.

The hashes protect against a damaged or half-copied package. They do not prove who wrote it: signed packages will come with the plugin store.
