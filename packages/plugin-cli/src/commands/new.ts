import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginIdSchema } from '@tessera/protocol';
import { CliError, log } from '../log';
import { CONFIG_FILE } from '../project';
import { cargoToml, gitignore, manifestFile, projectConfig, rustLib, rustLoader, widgetCss, widgetHtml, widgetJs, type TemplateInput } from '../templates';

export interface NewOptions {
  rust?: boolean;
  id?: string;
  name?: string;
  author?: string;
  sdk?: string;
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-plugin';
}

function sdkDependency(explicit?: string) {
  const local = explicit ? resolve(explicit) : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin-sdk-rust');
  if (existsSync(join(local, 'Cargo.toml'))) return `{ path = ${JSON.stringify(local.split('\\').join('/'))} }`;
  if (explicit) throw new CliError(`no Cargo.toml in ${local}`);
  return '{ git = "https://github.com/CompagesWorks/Tessera" }';
}

function write(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

export function create(dir: string, options: NewOptions) {
  const root = resolve(dir);
  if (existsSync(root) && readdirSync(root).length) throw new CliError(`${root} is not empty`);
  const name = options.name ?? basename(root);
  const author = options.author ?? process.env['USERNAME'] ?? process.env['USER'] ?? 'me';
  const id = options.id ?? `${slug(author)}.${slug(name)}`;
  if (!PluginIdSchema.safeParse(id).success) throw new CliError(`"${id}" is not a valid plugin id (lowercase, at least one dot, e.g. yourname.${slug(name)})`);
  const input: TemplateInput = { id, name, author, crate: slug(name), sdk: options.rust ? sdkDependency(options.sdk) : '' };

  if (options.rust) {
    write(root, {
      [CONFIG_FILE]: projectConfig,
      '.gitignore': gitignore,
      'plugin/manifest.json': manifestFile(input, true),
      'plugin/widget.html': widgetHtml(true),
      'plugin/widget.css': widgetCss,
      'plugin/widget.js': rustLoader(input.crate),
      'rust/Cargo.toml': cargoToml(input),
      'rust/src/lib.rs': rustLib,
    });
    log.ok(`Rust plugin ${id} created in ${root}`);
    console.log(`\n  cd ${dir}\n  tessera-plugin build\n  tessera-plugin pack\n\n  Then in Tessera: Plugins > Load a folder > ${join(root, 'plugin')} (development link)\n`);
    return;
  }

  write(root, {
    'manifest.json': manifestFile(input, false),
    'widget.html': widgetHtml(false),
    'widget.css': widgetCss,
    'widget.js': widgetJs,
  });
  log.ok(`JavaScript plugin ${id} created in ${root}`);
  console.log(`\n  In Tessera: Plugins > Load a folder > ${root} (development link)\n  To share it: tessera-plugin pack ${dir}\n`);
}
