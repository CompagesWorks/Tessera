import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const schemes = (name: string) => `${name}: http://${name}.localhost`;

function contentSecurityPolicy(): Plugin {
  return {
    name: 'tessera-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, ctx) {
        const dev = Boolean(ctx.server);
        const policy = [
          "default-src 'none'",
          `script-src 'self' ${schemes('tessera-provider')}`,
          `style-src 'self' 'unsafe-inline' ${schemes('tessera-provider')}`,
          `font-src 'self' data: ${schemes('tessera-provider')}`,
          `img-src 'self' data: blob: ${schemes('tessera-cover')} ${schemes('tessera-provider')} tessera-plugin: http://*.localhost`,
          `media-src ${schemes('tessera-media')}`,
          `connect-src ${schemes('ipc')} ${schemes('tessera-media')}${dev ? " 'self' ws://localhost:*" : ''}`,
          "base-uri 'none'",
          "form-action 'none'",
          "frame-src tessera-plugin: http://*.localhost",
          "object-src 'none'",
        ].join('; ');
        return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }];
      },
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  clearScreen: false,
  plugins: [contentSecurityPolicy()],
  resolve: {
    alias: { '@renderer': resolve(import.meta.dirname, 'src/renderer/src') },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: resolve(import.meta.dirname, 'out/renderer'),
    emptyOutDir: true,
    target: 'es2023',
  },
});
