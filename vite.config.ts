import { defineConfig } from 'vite';

// Relative base so the build runs from any sub-path (GitHub Pages, file hosts, previews).
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500, assetsInlineLimit: 0 },
});
