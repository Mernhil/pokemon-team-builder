/**
 * Sprite pipeline: downloads per-generation sprites from the PokeAPI sprites repository and packs
 * each set into one WebP atlas + JSON index under public/sprites/.
 *
 *   npm run sprites                 # all sets
 *   npm run sprites -- champions    # one or more sets
 *
 * One atlas per set means a format loads a single image, works offline and inside sandboxed hosts,
 * and needs no runtime access to a sprite CDN. Downloads are cached in .cache/sprites/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Dex } from '@pkmn/dex';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const OUT = resolve(ROOT, 'public/sprites');
const CACHE = resolve(ROOT, '.cache/sprites');
const RAW = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon.csv';

interface SetDef {
  id: string;
  label: string;
  /** Folder inside PokeAPI sprites/pokemon/. */
  path: string;
  /** Used when the preferred folder lacks a sprite (e.g. a form added later). */
  fallback: string;
  cell: number;
  pixelated: boolean;
  /** Which species go in the atlas: 'champions' = the Champions dataset, a number = Nat. Dex through that gen. */
  species: 'champions' | number;
}

export const SETS: SetDef[] = [
  { id: 'champions', label: 'Pokémon Champions', path: 'versions/generation-ix/champions', fallback: 'other/home', cell: 128, pixelated: false, species: 'champions' },
  { id: 'gen1', label: 'Red / Blue', path: 'versions/generation-i/red-blue/transparent', fallback: 'versions/generation-v/black-white', cell: 56, pixelated: true, species: 1 },
  { id: 'gen2', label: 'Crystal', path: 'versions/generation-ii/crystal/transparent', fallback: 'versions/generation-v/black-white', cell: 56, pixelated: true, species: 2 },
  { id: 'gen3', label: 'Emerald', path: 'versions/generation-iii/emerald', fallback: 'versions/generation-v/black-white', cell: 64, pixelated: true, species: 3 },
  { id: 'gen4', label: 'Platinum', path: 'versions/generation-iv/platinum', fallback: 'versions/generation-v/black-white', cell: 80, pixelated: true, species: 4 },
  { id: 'gen5', label: 'Black / White', path: 'versions/generation-v/black-white', fallback: 'other/home', cell: 96, pixelated: true, species: 5 },
  { id: 'gen6', label: 'X / Y', path: 'versions/generation-vi/x-y', fallback: 'other/home', cell: 96, pixelated: false, species: 6 },
  { id: 'gen7', label: 'Pokémon HOME (Gen 7)', path: 'other/home', fallback: 'other/official-artwork', cell: 96, pixelated: false, species: 7 },
  { id: 'gen8', label: 'Pokémon HOME (Gen 8)', path: 'other/home', fallback: 'other/official-artwork', cell: 96, pixelated: false, species: 8 },
  { id: 'gen9', label: 'Scarlet / Violet', path: 'versions/generation-ix/scarlet-violet', fallback: 'other/home', cell: 96, pixelated: false, species: 9 },
];

// ---------------------------------------------------------------------------
// Showdown species → PokeAPI numeric id
// ---------------------------------------------------------------------------

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'.:%]/g, '')
    .replace(/♀/g, '-f')
    .replace(/♂/g, '-m')
    .replace(/\s+/g, '-');

/** Showdown forme suffix → PokeAPI suffix, where they differ. */
const FORME_ALIASES: [RegExp, string][] = [
  [/-f$/, '-female'],
  [/-m$/, '-male'],
  [/-f-/, '-female-'],
  [/-m-/, '-male-'],
];

/** Showdown ids whose PokeAPI identifier can't be derived from the name. */
const OVERRIDES: Record<string, string> = {
  maushold: 'maushold-family-of-three',
  mausholdfour: 'maushold-family-of-four',
};

async function loadPokeApiIds(): Promise<{ byName: Map<string, number>; defaultByNum: Map<number, number> }> {
  const cached = resolve(CACHE, 'pokemon.csv');
  let text: string;
  if (existsSync(cached)) text = readFileSync(cached, 'utf8');
  else {
    const res = await fetch(CSV);
    if (!res.ok) throw new Error(`pokemon.csv: HTTP ${res.status}`);
    text = await res.text();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(cached, text);
  }
  const byName = new Map<string, number>();
  const defaultByNum = new Map<number, number>();
  for (const line of text.trim().split('\n').slice(1)) {
    const [id, identifier, speciesId, , , , , isDefault] = line.split(',');
    byName.set(identifier, +id);
    if (isDefault === '1') defaultByNum.set(+speciesId, +id);
  }
  return { byName, defaultByNum };
}

function pokeApiId(sp: { id: string; name: string; num: number; forme?: string }, ids: Awaited<ReturnType<typeof loadPokeApiIds>>): number | undefined {
  if (OVERRIDES[sp.id] && ids.byName.has(OVERRIDES[sp.id]))
    return ids.byName.get(OVERRIDES[sp.id]);
  const s = slug(sp.name);
  if (ids.byName.has(s)) return ids.byName.get(s);
  for (const [re, rep] of FORME_ALIASES) if (re.test(s) && ids.byName.has(s.replace(re, rep))) return ids.byName.get(s.replace(re, rep));
  // Base forme whose PokeAPI default carries a suffix (toxtricity-amped, indeedee-male, …)
  // Base formes whose PokeAPI default carries a suffix (toxtricity-amped, indeedee-male, …) and
  // cosmetic formes PokeAPI doesn't split out (Alcremie flavours, Polteageist-Antique, …) both use
  // the species' default sprite.
  return ids.defaultByNum.get(sp.num);
}

// ---------------------------------------------------------------------------
// Download (cached) + atlas packing
// ---------------------------------------------------------------------------

async function getSprite(path: string, id: number): Promise<Buffer | null> {
  const file = resolve(CACHE, path, `${id}.png`);
  if (existsSync(file)) {
    const buf = readFileSync(file);
    return buf.length ? buf : null; // empty file = cached 404
  }
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${RAW}/${path}/${id}.png`);
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

type SpeciesLite = { id: string; name: string; num: number; forme?: string };

function speciesFor(set: SetDef): SpeciesLite[] {
  if (set.species === 'champions') {
    const data = JSON.parse(readFileSync(resolve(ROOT, 'src/data/generated/champions.json'), 'utf8'));
    return Object.values(data.species as Record<string, SpeciesLite>);
  }
  const gen = set.species;
  return Dex.forGen(gen)
    .species.all()
    .filter(
      (s) =>
        s.exists &&
        s.num > 0 &&
        s.gen <= gen &&
        !['CAP', 'Custom', 'LGPE'].includes(s.isNonstandard ?? '') &&
        !/Gmax|Totem|Mega|Primal/.test(s.forme),
    )
    .map((s) => ({ id: s.id, name: s.name, num: s.num, forme: s.forme || undefined }));
}

async function buildSet(set: SetDef, ids: Awaited<ReturnType<typeof loadPokeApiIds>>) {
  const species = speciesFor(set);
  const missing: string[] = [];
  const fallbacks: string[] = [];

  const sprites = await pool(species, 24, async (sp) => {
    const pid = pokeApiId(sp, ids);
    if (!pid) {
      missing.push(`${sp.id} (no PokeAPI id)`);
      return null;
    }
    let buf = await getSprite(set.path, pid);
    if (!buf) {
      buf = await getSprite(set.fallback, pid);
      if (buf) fallbacks.push(sp.id);
    }
    // Last resort for forms: the base species' sprite in the preferred set.
    if (!buf && sp.forme) {
      const baseId = ids.defaultByNum.get(sp.num);
      if (baseId) buf = await getSprite(set.path, baseId);
      if (buf) fallbacks.push(`${sp.id}→base`);
    }
    if (!buf) missing.push(sp.id);
    return buf ? { id: sp.id, buf } : null;
  });

  const present = sprites.filter((x): x is { id: string; buf: Buffer } => !!x);
  const cols = Math.ceil(Math.sqrt(present.length));
  const rows = Math.ceil(present.length / cols);
  const c = set.cell;

  const composites = await pool(present, 16, async ({ buf }, ) => {
    // Trim transparent padding, then fit into the cell, anchored bottom-centre.
    const trimmed = await sharp(buf).ensureAlpha().trim({ threshold: 0 }).toBuffer({ resolveWithObject: true }).catch(() => null);
    const input = trimmed?.data ?? buf;
    return sharp(input)
      .resize(c - 2, c - 2, {
        fit: 'contain',
        position: 'south',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        kernel: set.pixelated ? 'nearest' : 'lanczos3',
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  });

  const index: Record<string, number> = {};
  const layers = await Promise.all(
    present.map(async (p, i) => {
      index[p.id] = i;
      const meta = await sharp(composites[i]).metadata();
      return {
        input: composites[i],
        left: (i % cols) * c + Math.floor((c - meta.width!) / 2),
        top: Math.floor(i / cols) * c + (c - meta.height!) - 1,
      };
    }),
  );

  mkdirSync(OUT, { recursive: true });
  await sharp({ create: { width: cols * c, height: rows * c, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .webp(set.pixelated ? { lossless: true, effort: 6 } : { quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(resolve(OUT, `${set.id}.webp`));

  writeFileSync(
    resolve(OUT, `${set.id}.json`),
    JSON.stringify({ set: set.id, label: set.label, cell: c, cols, rows, pixelated: set.pixelated, count: present.length, index }),
  );
  const kb = Math.round(readFileSync(resolve(OUT, `${set.id}.webp`)).length / 1024);
  console.log(
    `${set.id.padEnd(9)} ${present.length}/${species.length} sprites · ${cols}×${rows} @${c}px · ${kb} KB` +
      (fallbacks.length ? ` · ${fallbacks.length} fallback` : '') +
      (missing.length ? ` · missing: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}` : ''),
  );
}

async function main() {
  const wanted = process.argv.slice(2);
  const ids = await loadPokeApiIds();
  for (const set of SETS) if (!wanted.length || wanted.includes(set.id)) await buildSet(set, ids);
  writeFileSync(
    resolve(OUT, 'sets.json'),
    JSON.stringify(SETS.map(({ id, label, cell, pixelated }) => ({ id, label, cell, pixelated }))),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
