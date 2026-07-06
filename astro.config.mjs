// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      alias: {
        '@core': '/src/core',
        '@features': '/src/features',
        '@ui': '/src/ui',
      },
    },
    optimizeDeps: {
      include: ['yjs', 'isomorphic-git', '@isomorphic-git/lightning-fs', 'hash-wasm', 'minisearch'],
    },
  },
});
