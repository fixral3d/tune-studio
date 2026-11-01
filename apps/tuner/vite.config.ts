import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // GitHub Pages project site is served from /tune-studio/.
  // Override with VITE_BASE=/ for local/other hosts.
  base: process.env.VITE_BASE ?? '/tune-studio/',
  plugins: [react()],
  resolve: {
    alias: {
      '@vems/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
