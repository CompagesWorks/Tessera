import { createRequire } from 'node:module';
import { dirname, extname, join, relative, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, net, protocol } from 'electron';
import { PLUGIN_SCHEME } from '@tessera/protocol';
import type { PluginService } from './plugins/service';
import type { ProjectService } from './projects/service';

export const COVER_SCHEME = 'tessera-cover';
const RUNTIME_PREFIX = '__tessera/';

const PLUGIN_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    { scheme: COVER_SCHEME, privileges: { standard: true, secure: true } },
    { scheme: PLUGIN_SCHEME, privileges: { standard: true, secure: true, corsEnabled: true } },
  ]);
}

function runtimeFiles() {
  const require = createRequire(import.meta.url);
  const iconsCss = require.resolve('bootstrap-icons/font/bootstrap-icons.min.css');
  return {
    sdk: join(app.getAppPath(), 'resources', 'plugin-sdk.js'),
    atrium: require.resolve('atrium-ui/style.css'),
    icons: iconsCss,
    fonts: join(dirname(iconsCss), 'fonts'),
  };
}

function inside(root: string, target: string) {
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

async function serve(file: string | null, cors = false): Promise<Response> {
  if (!file) return new Response(null, { status: 404 });
  const upstream = await net.fetch(pathToFileURL(file).href);
  if (!upstream.ok) return new Response(null, { status: 404 });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Security-Policy': PLUGIN_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...(cors && { 'Access-Control-Allow-Origin': '*' }),
    },
  });
}

export function handleProtocols(projects: ProjectService, plugins: PluginService) {
  const files = runtimeFiles();

  protocol.handle(COVER_SCHEME, async (request) => {
    const file = await projects.coverPath(new URL(request.url).hostname);
    if (!file) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });

  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');

    if (path.startsWith(RUNTIME_PREFIX)) {
      const name = path.slice(RUNTIME_PREFIX.length);
      if (name === 'sdk.js') return serve(files.sdk);
      if (name === 'atrium.css') return serve(files.atrium);
      if (name === 'bootstrap-icons.css') return serve(files.icons);
      if (name.startsWith('fonts/')) {
        const font = resolve(files.fonts, name.slice('fonts/'.length));
        return serve(inside(files.fonts, font) ? font : null, true);
      }
      return serve(null);
    }

    return serve(await plugins.resolveFile(url.hostname, path || 'index.html'));
  });
}
