/**
 * Bundle-size budget, run at the end of `npm run build` (and on its own with `npm run size`).
 * Fails the build when the web app grows past these limits, so a heavy dependency or an
 * accidentally eager import can't ship unnoticed:
 *
 *   - first load (the JS and CSS dist/index.html references), gzipped
 *   - any single lazily loaded chunk (a generation's data, the Pokédex…), gzipped
 *   - everything the service worker precaches for offline use
 *
 * Raise a limit deliberately, in the same commit as the change that needs it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const BUDGET = {
  firstLoadGzip: 260 * KB,
  // The largest lazy chunk is a game's Atlas file (atlas-<game>.json, ~280 KB gzipped: every NPC's dialogue is ~115 KB of it); it loads only when that game's Atlas opens.
  chunkGzip: 320 * KB,
  precache: 45 * KB * KB,
};

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const gz = (file) => gzipSync(readFileSync(file)).length;
const fmt = (n) => (n >= KB * KB ? `${(n / KB / KB).toFixed(1)} MB` : `${(n / KB).toFixed(0)} KB`);

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const entry = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
const firstLoad = entry.reduce((sum, f) => sum + gz(join(DIST, f)), 0);

const assets = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js') && !entry.includes(`assets/${f}`));
const chunks = assets.map((f) => ({ f, size: gz(join(DIST, 'assets', f)) })).sort((a, b) => b.size - a.size);

// The service worker's precache manifest lists every file with its revision; sum their sizes.
const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
const precached = [...new Set([...sw.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]))];
const precache = precached.reduce((sum, url) => {
  try {
    return sum + statSync(join(DIST, url)).size;
  } catch {
    return sum;
  }
}, 0);

const rows = [
  ['first load (gzip)', firstLoad, BUDGET.firstLoadGzip, entry.join(', ')],
  ['largest lazy chunk (gzip)', chunks[0]?.size ?? 0, BUDGET.chunkGzip, chunks[0]?.f ?? ''],
  ['offline precache', precache, BUDGET.precache, `${precached.length} files`],
];
let failed = false;
for (const [label, size, limit, detail] of rows) {
  const ok = size <= limit;
  failed ||= !ok;
  const used = Math.round((size / limit) * 100);
  // Within 5% of the limit still passes, but say so: the next feature will not fit.
  const mark = !ok ? '✗' : used >= 95 ? '!' : '✓';
  console.log(`${mark} ${label}: ${fmt(size)} of ${fmt(limit)} (${used}%)  (${detail})`);
}
if (failed) {
  console.error('Bundle budget exceeded (scripts/check-bundle.mjs).');
  process.exit(1);
}
