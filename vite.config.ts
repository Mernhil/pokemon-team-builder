/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode singlefile` inlines everything into one index.html (portable/offline build).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === 'singlefile' ? [viteSingleFile()] : []),
    // Installable web app ("Add to Home Screen" on iPhone). The service worker precaches the whole
    // app, sprites included, so it works offline; src/pwa.ts picks up new deploys automatically.
    VitePWA({
      disable: mode === 'singlefile',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'Pokémon Team Builder',
        short_name: 'Team Builder',
        description: 'Build and analyse competitive Pokémon teams.',
        id: './',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0e1117',
        theme_color: '#0e1117',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,json}'],
        // The sprite atlases are up to ~4 MB each.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Fixed port so the Tauri desktop shell (src-tauri/tauri.conf.json's devUrl) always finds the dev server.
  server: { port: 1420, strictPort: true },
  test: { environment: 'node' },
}));
