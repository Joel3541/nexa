import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@': path.join(here, 'src'),
      // Workspace packages are consumed as TypeScript source. Only
      // browser-safe modules are imported: @nexa/types is pure Zod/TS, and the
      // web client reaches for @nexa/config/locale specifically, never the
      // server-side env loader.
      '@nexa/types': path.join(here, '../../packages/types/src/index.ts'),
      '@nexa/config/locale': path.join(here, '../../packages/config/src/locale.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Same-origin in development, so session cookies behave exactly as they
      // will behind a reverse proxy in production.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
});
