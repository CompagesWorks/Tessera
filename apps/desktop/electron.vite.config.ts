import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

function contentSecurityPolicy(): Plugin {
  return {
    name: 'tessera-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        const dev = Boolean(ctx.server);
        const policy = [
          "default-src 'none'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "font-src 'self' data:",
          "img-src 'self' data: blob:",
          dev ? "connect-src 'self' ws://localhost:*" : "connect-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-src 'none'",
          "object-src 'none'",
        ].join('; ');
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
      },
    },
  };
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: ['@tessera/protocol'] },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [contentSecurityPolicy()],
    resolve: {
      alias: { '@renderer': resolve(import.meta.dirname, 'src/renderer/src') },
    },
  },
});
