import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: resolve(import.meta.dirname, 'src/cli.ts'),
    target: 'node22',
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`), 'fflate', 'zod'],
      output: { entryFileNames: 'cli.mjs', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: {
    noExternal: ['@tessera/protocol'],
  },
});
