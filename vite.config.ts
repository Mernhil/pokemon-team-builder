/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The desktop app version (src-tauri/tauri.conf.json), not package.json's — it's the one bumped on
// every Tauri release, so it's what actually changes and busts the webview's icon cache.
const appVersion = JSON.parse(readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf-8')).version as string;

// The Tauri desktop webview (WebView2/WKWebView) caches static assets by URL across app updates —
// stamping icon links with the app version forces a fresh fetch whenever the logo changes.
const cacheBustIcons = (): Plugin => ({
  name: 'cache-bust-icons',
  transformIndexHtml: (html) => html.replaceAll('%APP_VERSION%', appVersion),
});

// `vite build --mode singlefile` inlines everything into one index.html (portable/offline build).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    cacheBustIcons(),
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
