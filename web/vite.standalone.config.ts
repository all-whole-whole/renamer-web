import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));
const ui = fileURLToPath(new URL('../../ui/src', import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@ui': ui },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5395,
    strictPort: false,
    fs: { allow: [repo, ui] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:8758', changeOrigin: false },
    },
  },
  build: {
    outDir: '../public',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  },
});
