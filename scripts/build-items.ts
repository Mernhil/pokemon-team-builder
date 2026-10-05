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
 * Items with no official artwork we can fetch (the new Mega Stones of Pokémon Champions, Fairy Feather,
 * Generation 2's mails and berries, the Kanto badges…) get an icon drawn in-process per kind of item
 * (scripts/items/drawn.ts; Mega Stones in their Pokémon's type colour), and are logged so the override
 * table can be extended once real art exists. PokeSprite fills in what PokeAPI lacks.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex } from '@pkmn/dex';
import sharp from 'sharp';
import * as drawn from './items/drawn.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const OUT = resolve(ROOT, 'public/sprites');
const CACHE = resolve(ROOT, '.cache/items');
const RAW = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items';
const CSV = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/items.csv';

const CELL = 32;

/**
 * Item id -> where its icon is, for ids that aren't just the de-hyphenated PokeAPI identifier: a PokeAPI
 * identifier, or `pokesprite:<category>/<name>` (https://github.com/msikma/pokesprite) for what PokeAPI lacks.
 * The atlas' bag items use the old games' spellings (Elixer, Blk Apricorn, Rm. 1 Key…).
 */
const OVERRIDES: Record<string, string> = {
  leek: 'stick',
  elixer: 'elixir', maxelixer: 'max-elixir', blackbelti: 'black-belt', parlyzheal: 'paralyze-heal', xdefend: 'x-defense', xspecial: 'x-sp-atk', expall: 'exp-share',
  blkapricorn: 'pokesprite:apricorn/black', bluapricorn: 'pokesprite:apricorn/blue', grnapricorn: 'pokesprite:apricorn/green', pnkapricorn: 'pokesprite:apricorn/pink',
  whtapricorn: 'pokesprite:apricorn/white', ylwapricorn: 'pokesprite:apricorn/yellow',
  dowsingmchn: 'pokesprite:key-item/dowsing-machine',
  room1key: 'pokesprite:key-item/key-to-room-1', room2key: 'pokesprite:key-item/key-to-room-2', room4key: 'pokesprite:key-item/key-to-room-4', room6key: 'pokesprite:key-item/key-to-room-6',
  goldleaf: 'pokesprite:partner-gift/gold-leaf', silverleaf: 'pokesprite:partner-gift/silver-leaf',
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

const POKESPRITE = 'https://raw.githubusercontent.com/msikma/pokesprite/master/items';

/** PokeAPI's sprite of an identifier ("life-orb"), or PokeSprite's ("pokesprite:key-item/dowsing-machine"). */
async function fetchIcon(identifier: string): Promise<Buffer | null> {
  const ps = /^pokesprite:(.+)$/.exec(identifier)?.[1];
  const file = resolve(CACHE, ps ? `pokesprite-${ps.replace('/', '-')}.png` : `${identifier}.png`);
  if (existsSync(file)) {
    const buf = readFileSync(file);
    return buf.length ? buf : null; // empty file = cached 404
  }
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(ps ? `${POKESPRITE}/${ps}.png` : `${RAW}/${identifier}.png`);
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

  // What the atlases and the Champions data know about each item (name, TM/HM move, Mega Stone).
  const info = new Map<string, { name?: string; move?: string }>();
  for (const f of readdirSync(generated).filter((f) => /^atlas-.*\.json$/.test(f)))
    for (const [id, it] of Object.entries<{ name?: string; move?: string }>(JSON.parse(readFileSync(resolve(generated, f), 'utf8')).items ?? {})) info.set(id, { ...info.get(id), ...it });
  const gen9 = Dex.forGen(9);
  const typeOfMove = (move: string) => {
    const m = gen9.moves.get(move);
    return m.exists ? m.type.toLowerCase() : undefined;
  };
  /** TMs and HMs: PokeAPI has one icon per move type (tm-fire, hm-water…); the id says the move, or the atlas does. */
  const machineOf = (id: string): string | undefined => {
    const m = /^(tm|hm)([a-z]+)$/.exec(id);
    const move = info.get(id)?.move ?? (m && typeOfMove(m[2]) ? m[2] : undefined);
    const type = move ? typeOfMove(move) : undefined;
    return m && type ? `${m[1]}-${type}` : /^tm\d+$/.test(id) && type ? `tm-${type}` : undefined;
  };
  const HM_MOVES: Record<string, string> = { hmcut: 'cut', hmfly: 'fly', hmsurf: 'surf', hmstrength: 'strength', hmflash: 'flash', hmrocksmash: 'rocksmash', hmwaterfall: 'waterfall', hmdive: 'dive' };
  const hmOf = (id: string) => (HM_MOVES[id] && typeOfMove(HM_MOVES[id]) ? `hm-${typeOfMove(HM_MOVES[id])}` : undefined);
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const MAIL: Record<string, string> = { blueskymail: '#6fb3e8', flowermail: '#f08cc4', surfmail: '#4aa3f0', litebluemail: '#9fd0ee', lovelymail: '#f06f8f', eonmail: '#7ab6e8', morphmail: '#b58ad8', musicmail: '#e8a84a', miragemail: '#c9a6e8', portraitmail: '#e8d38a' };
  const BADGE: Record<string, string> = { boulderbadge: '#8a8a8a', cascadebadge: '#4aa3f0', thunderbadge: '#f4c430', rainbowbadge: '#7ac74c', soulbadge: '#d6638c', marshbadge: '#c070e0', volcanobadge: '#ee6a30', earthbadge: '#8a6a3a' };
  const BERRY: Record<string, string> = { berry: '#e0553a', bitterberry: '#7a9c3a', burntberry: '#8a4a2a', goldberry: '#f4c430', iceberry: '#96d9d6', mintberry: '#5bd6a2', miracleberry: '#e8c25a', mysteryberry: '#b07ad8', przcureberry: '#f07ab0', psncureberry: '#b05ad8' };
  /** A drawn stand-in, per kind of item (see scripts/items/drawn.ts); every id gets one that says what it is. */
  const drawnFor = (id: string): string => {
    const champ = data.items[id] as { name?: string; megaStone?: Record<string, string> } | undefined;
    const stone = champ?.megaStone && Object.keys(champ.megaStone)[0];
    if (stone) {
      const types: string[] = data.species[stone]?.types ?? [];
      return drawn.megaStone(drawn.TYPE_COLOR[types[0]] ?? '#9a9a9a', /itez$/.test(id));
    }
    if (id === 'fairyfeather') return drawn.fairyFeather();
    if (MAIL[id]) return drawn.mail(MAIL[id]);
    if (BADGE[id]) return drawn.badge(BADGE[id]);
    if (BERRY[id]) return drawn.berry(BERRY[id]);
    if (id === 'coin') return drawn.coin();
    if (id === 'gsball') return drawn.orb('#e0b83a');
    if (id === 'eggticket') return drawn.ticket('#7ac0e8');
    if (id === 'gorgeousbox') return drawn.box('#e8c25a');
    if (id === 'normalbox') return drawn.box('#a8a77a');
    if (id === 'brickpiece') return drawn.brick();
    if (id === 'pinkbow') return drawn.bow('#f08cc4');
    if (id === 'polkadotbow') return drawn.bow('#d6455d', true);
    if (id === 'itemfinder') return drawn.device('#7a8b9c');
    if (id === 'pokedex') return drawn.device('#d6455d');
    return drawn.question(); // unnamed slots of the item table ("Teru Sama") and anything not known by name
  };

  const icons = await pool(itemIds, 16, async (id) => {
    const nameSlug = info.get(id)?.name ? slug(info.get(id)!.name!) : undefined;
    const identifiers = [OVERRIDES[id], machineIcon.get(id), machineOf(id), hmOf(id), byStripped.get(id), nameSlug && byStripped.get(nameSlug.replace(/-/g, ''))].filter((x): x is string => !!x);
    for (const identifier of identifiers) {
      const buf = await fetchIcon(identifier);
      if (buf) return buf;
    }
    placeholders.push(id);
    return sharp(Buffer.from(drawnFor(id))).png().toBuffer();
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
  if (placeholders.length) console.warn(`drawn stand-ins (no official art found), ${placeholders.length}: ${placeholders.sort().join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
