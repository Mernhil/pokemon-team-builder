/**
 * Item sprite pipeline: downloads item icons from the PokeAPI sprites repository and packs them
 * into one WebP atlas + JSON index under public/sprites/, same shape as build-sprites.ts.
 *
 *   npm run sprites:items
 *
 * PokeAPI identifies items by a kebab-case slug (e.g. "life-orb"), while Showdown/this app use
 * ids with no separators ("lifeorb"). Matching strips hyphens from the PokeAPI identifier list
 * and compares against the Showdown id; a handful of items whose PokeAPI identifier isn't just a
 * de-hyphenated form of the name go through OVERRIDES.
 *
 * The Atlas' item databases add their bag items (Potions, TMs, key items) so every item shows an icon.
 *
 * Some items are exclusive to Pokémon Champions (the new Mega-Z stones, e.g. Absolite Z) and have
 * no official artwork anywhere. Those get a neutral placeholder (a grey gem) generated in-process
 * so the UI never shows a broken image, and the item is logged so the override table can be
 * extended once real art exists.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const OUT = resolve(ROOT, 'public/sprites');
const CACHE = resolve(ROOT, '.cache/items');
const RAW = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items';
const CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/items.csv';

const CELL = 32;

/** Showdown item id -> PokeAPI identifier, for ids that aren't just the de-hyphenated identifier. */
const OVERRIDES: Record<string, string> = {
  leek: 'stick',
};

async function loadPokeApiIdentifiers(): Promise<Map<string, string>> {
  const cached = resolve(CACHE, 'items.csv');
  let text: string;
  if (existsSync(cached)) text = readFileSync(cached, 'utf8');
  else {
    const res = await fetch(CSV);
    if (!res.ok) throw new Error(`items.csv: HTTP ${res.status}`);
    text = await res.text();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, text);
  }
  const byStripped = new Map<string, string>();
  for (const line of text.trim().split('\n').slice(1)) {
    const identifier = line.split(',')[1];
    if (identifier) byStripped.set(identifier.replace(/-/g, ''), identifier);
  }
  return byStripped;
}

async function fetchIcon(identifier: string): Promise<Buffer | null> {
  const file = resolve(CACHE, `${identifier}.png`);
  if (existsSync(file)) {
    const buf = readFileSync(file);
    return buf.length ? buf : null; // empty file = cached 404
  }
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${RAW}/${identifier}.png`);
      if (res.status === 404) {
        writeFileSync(file, '');
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(file, buf);
      return buf;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

/** Neutral grey gem, used when no official art exists for a Champions-only item. */
async function placeholder(): Promise<Buffer> {
  const svg = `
    <svg width="${CELL - 4}" height="${CELL - 4}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <polygon points="12,2 21,9 17,22 7,22 3,9" fill="#9a9a9a" stroke="#6b6b6b" stroke-width="1.5"/>
      <polygon points="12,2 21,9 12,13 3,9" fill="#c4c4c4" stroke="#6b6b6b" stroke-width="1"/>
    </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

async function main() {
  const data = JSON.parse(readFileSync(resolve(ROOT, 'src/data/generated/champions.json'), 'utf8'));
  // Champions' items plus every bag item the Atlas databases list (src/data/generated/atlas-*.json).
  const ids = new Set<string>(Object.keys(data.items));
  const generated = resolve(ROOT, 'src/data/generated');
  for (const f of readdirSync(generated).filter((f) => /^atlas-.*\.json$/.test(f)))
    for (const id of Object.keys(JSON.parse(readFileSync(resolve(generated, f), 'utf8')).items ?? {})) if (id !== 'none') ids.add(id);
  const itemIds: string[] = [...ids].sort();
  // TM / HM icons are per move type in PokeAPI's sprites (tm-fighting, hm-normal…).
  const machineIcon = new Map<string, string>();
  for (const f of readdirSync(generated).filter((f) => /^atlas-.*\.json$/.test(f)))
    for (const [id, it] of Object.entries<{ moveType?: string }>(JSON.parse(readFileSync(resolve(generated, f), 'utf8')).items ?? {}))
      if (it.moveType) machineIcon.set(id, `${id.startsWith('hm') ? 'hm' : 'tm'}-${it.moveType.toLowerCase()}`);
  const byStripped = await loadPokeApiIdentifiers();
  const placeholders: string[] = [];

  const icons = await pool(itemIds, 16, async (id) => {
    const identifier = OVERRIDES[id] ?? machineIcon.get(id) ?? byStripped.get(id);
    const buf = identifier ? await fetchIcon(identifier) : null;
    if (buf) return buf;
    placeholders.push(id);
    return placeholder();
  });

  const cols = Math.ceil(Math.sqrt(icons.length));
  const rows = Math.ceil(icons.length / cols);

  const composites = await pool(icons, 16, (buf) =>
    sharp(buf)
      .resize(CELL - 4, CELL - 4, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'nearest', withoutEnlargement: true })
      .png()
      .toBuffer(),
  );

  const index: Record<string, number> = {};
  const layers = await Promise.all(
    composites.map(async (buf, i) => {
      index[itemIds[i]] = i;
      const meta = await sharp(buf).metadata();
      return {
        input: buf,
        left: (i % cols) * CELL + Math.floor((CELL - meta.width!) / 2),
        top: Math.floor(i / cols) * CELL + Math.floor((CELL - meta.height!) / 2),
      };
    }),
  );

  mkdirSync(OUT, { recursive: true });
  await sharp({ create: { width: cols * CELL, height: rows * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .webp({ lossless: true, effort: 6 })
    .toFile(resolve(OUT, 'items.webp'));

  writeFileSync(
    resolve(OUT, 'items.json'),
    JSON.stringify({ set: 'items', label: 'Items', cell: CELL, cols, rows, pixelated: true, count: icons.length, index }),
  );

  const kb = Math.round(readFileSync(resolve(OUT, 'items.webp')).length / 1024);
  console.log(`items     ${icons.length}/${itemIds.length} icons · ${cols}×${rows} @${CELL}px · ${kb} KB`);
  if (placeholders.length) console.warn(`placeholder (no official art): ${placeholders.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
