import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import { configDefaults } from 'vitest/config'; // also types the `test` field below
import { VitePWA } from 'vite-plugin-pwa';
import { parseChangelog } from './src/domain/changelog.ts';

// The desktop app version (src-tauri/tauri.conf.json), not package.json's — it's the one bumped on
// every Tauri release, so it's what actually changes and busts the webview's icon cache.
const appVersion = JSON.parse(readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf-8')).version as string;

// The Tauri desktop webview (WebView2/WKWebView) caches static assets by URL across app updates —
// stamping icon links with the app version forces a fresh fetch whenever the logo changes.
const cacheBustIcons = (): Plugin => ({
  name: 'cache-bust-icons',
  transformIndexHtml: (html) => html.replaceAll('%APP_VERSION%', appVersion),
});

// The blank-screen guard (src/bootGuard.js) is inlined into index.html, outside the bundle, so it still runs when the bundle can't
// load. The CSP is `script-src 'self'` (public/_headers), so the build adds this script's hash to it.
const bootGuard = (): Plugin => {
  const source = readFileSync(new URL('./src/bootGuard.js', import.meta.url), 'utf-8');
  const hash = `'sha256-${createHash('sha256').update(source).digest('base64')}'`;
  let outDir = 'dist';
  return {
    name: 'boot-guard',
    apply: 'build',
    configResolved: (config: ResolvedConfig) => { outDir = config.build.outDir; },
    transformIndexHtml: { order: 'pre', handler: (html) => html.replace('<!-- boot-guard -->', `<script>${source}</script>`) },
    closeBundle() {
      const file = `${outDir}/_headers`;
      const headers = readFileSync(file, 'utf-8');
      if (headers.includes(hash)) return;
      if (!headers.includes("script-src 'self'")) throw new Error(`${file} has no "script-src 'self'" to add the boot guard's hash to`);
      writeFileSync(file, headers.replace("script-src 'self'", `script-src 'self' ${hash}`));
    },
  };
};

// "What's new": CHANGELOG.md as data (src/domain/changelog.ts), the latest releases only. Imported lazily
// as `virtual:changelog`, so it costs nothing until the sheet opens.
const changelog = (): Plugin => ({
  name: 'changelog',
  resolveId: (id) => (id === 'virtual:changelog' ? '\0virtual:changelog' : undefined),
  load(id) {
    if (id !== '\0virtual:changelog') return undefined;
    this.addWatchFile(fileURLToPath(new URL('./CHANGELOG.md', import.meta.url)));
    return `export default ${JSON.stringify(parseChangelog(readFileSync(new URL('./CHANGELOG.md', import.meta.url), 'utf-8'), 12))};`;
  },
});

// The Meta tab's "Check for newer data" fetches the deployed copy of the usage data
// (src/store/metaStore.ts). Emit it next to the app; it isn't precached, so it's always fresh.
const emitMeta = (): Plugin => ({
  name: 'emit-meta',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'meta/latest.json', source: readFileSync(new URL('./src/data/generated/meta.json', import.meta.url), 'utf-8') });
  },
});

export default defineConfig({
  base: './',
  // Module workers (the Threat report's engine) share code-split chunks with the app.
  worker: { format: 'es' },
  // Shown in Settings & credits.
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    tailwindcss(),
    cacheBustIcons(),
    bootGuard(),
    changelog(),
    emitMeta(),
    // Installable web app ("Add to Home Screen" on iPhone). The service worker precaches the whole
    // app, sprites included, so it works offline; src/pwa.ts picks up new deploys automatically.
    VitePWA({
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
        background_color: '#15171d',
        theme_color: '#1c1f26',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // The worker is sw/sw.ts (src/domain/swGuard.ts has its rules): the stock generated one can't refuse a redirect or a login
      // page standing in for a file, and its navigation fallback swallowed Access's /cdn-cgi/access/callback.
      strategies: 'injectManifest',
      srcDir: 'sw',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,json}'],
        // iOS launch screens are fetched once when the app is added to the home screen; no need to
        // precache ~0.8 MB of them for everyone.
        globIgnores: ['splash/**', 'meta/**'],
        // The sprite atlases are up to ~4 MB each.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // The per-generation datasets are lazy-loaded JSON chunks of up to ~1 MB by design; warn only
  // when something is far larger than that.
  build: { chunkSizeWarningLimit: 1500 },
  // Fixed port so the Tauri desktop shell (src-tauri/tauri.conf.json's devUrl) always finds the dev server.
  server: { port: 1420, strictPort: true },
  test: { environment: 'node', testTimeout: 20_000, exclude: [...configDefaults.exclude, 'e2e/**'] },
});
