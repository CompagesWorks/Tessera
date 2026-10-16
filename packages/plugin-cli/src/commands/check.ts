import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSize, listFiles } from '../files';
import { log } from '../log';
import { readManifest } from '../manifest';
import { loadProject } from '../project';

function warnings(plugin: string, files: string[]): string[] {
  const found: string[] = [];
  for (const path of files.filter((p) => p.endsWith('.html'))) {
    const html = readFileSync(join(plugin, ...path.split('/')), 'utf8');
    if (/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html)) found.push(`${path}: inline <script> is blocked by the sandbox, move it to a .js file`);
    if (/\son[a-z]+\s*=/i.test(html)) found.push(`${path}: inline event handlers (onclick=…) are blocked, use addEventListener`);
    if (/src=["']https?:/i.test(html) || /href=["']https?:[^"']*\.css/i.test(html)) found.push(`${path}: remote scripts and styles are blocked, copy them into the plugin folder`);
    if (!html.includes('/__tessera/sdk.js')) found.push(`${path}: does not load /__tessera/sdk.js`);
  }
  if (files.some((p) => p.endsWith('.wasm')) && !files.some((p) => p.endsWith('.js'))) found.push('a .wasm file is present but no .js loads it');
  return found;
}

export function check(dir?: string) {
  const project = loadProject(dir);
  const manifest = readManifest(project.plugin);
  const files = listFiles(project.plugin);
  const size = files.reduce((sum, file) => sum + file.size, 0);
  log.ok(`${manifest.name} ${manifest.version} (${manifest.id})`);
  log.ok(`${files.length} files, ${formatSize(size)}`);
  log.ok(`permissions: ${manifest.permissions.join(', ') || 'none'}`);
  if (project.rust && !existsSync(join(project.plugin, 'pkg'))) log.warn('no pkg/ folder yet: run tessera-plugin build');
  const found = warnings(project.plugin, files.map((f) => f.path));
  for (const warning of found) log.warn(warning);
  return { project, manifest, files };
}
