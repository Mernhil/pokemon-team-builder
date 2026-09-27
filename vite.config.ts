/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode singlefile` inlines everything into one index.html (portable/offline build).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss(), ...(mode === 'singlefile' ? [viteSingleFile()] : [])],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Fixed port so the Tauri desktop shell (src-tauri/tauri.conf.json's devUrl) always finds the dev server.
  server: { port: 1420, strictPort: true },
  test: { environment: 'node' },
}));
