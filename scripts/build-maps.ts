/**
 * Region maps for the Pokédex "Area" page.
 *
 * Gen 1–3 use the games' own maps, rendered from the pret disassemblies/decompilations, and each
 * location sits where the game put it:
 *   kanto-rby    Red/Blue/Yellow town map (pokered: town_map.rle + tiles, SGB town-map palette)
 *   johto-gsc,   Crystal Pokégear maps (pokecrystal: johto.bin / kanto.bin + CGB palettes),
 *   kanto-gsc    nests at data/maps/landmarks.asm
 *   hoenn-rse    Emerald Pokédex area map (pokeemerald: graphics/pokedex/region_map.*),
 *                glowing squares from region_map_sections.json
 *   kanto-frlg,  FireRed/LeafGreen region maps (pokefirered: graphics/region_map/*.bin),
 *   sevii-*      squares from src/data/region_map/region_map_layout_*.h
 * Later regions come from hand-placed schematic layouts in src/data/maps/*.json.
 *
 * Writes public/maps/<id>.png and src/data/generated/maps.json.
 *   npm run maps          (clones the needed pret repos into .cache/pret on first run)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const PRET = resolve(ROOT, '.cache/pret');
const OUT_IMG = resolve(ROOT, 'public/maps');
const OUT_JSON = resolve(ROOT, 'src/data/generated/maps.json');
const SCHEMATIC_DIR = resolve(ROOT, 'src/data/maps');
const POKEAPI = resolve(ROOT, '.cache/pokeapi');

type Rect = [number, number, number, number];
type RGB = [number, number, number];

export interface RegionMapOut {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Path under public/ of the rendered in-game map (schematic maps have none). */
  image?: string;
  /** How the game marked a Pokémon's area: blinking nest icons (Gen 1–2) or glowing squares (Gen 3+). */
  style: 'nest' | 'area' | 'schematic';
  /** PokeAPI location identifier → rectangles in map pixels. */
  places: Record<string, Rect[]>;
  /** Nest-style maps: the game's 8×8 nest sprite, one string per row ('#' dark, '+' mid, '.' transparent). */
  nestIcon?: string[];
  /** Schematic maps only: land shapes and place kinds/labels for drawing. */
  land?: string[];
  kinds?: Record<string, string>;
  labels?: Record<string, string>;
  source: string;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const REPOS: Record<string, { branch: string; paths: string[] }> = {
  pokered: { branch: 'master', paths: ['gfx/town_map', 'data/maps/town_map_entries.asm'] },
  pokecrystal: { branch: 'master', paths: ['gfx/pokegear', 'data/maps/landmarks.asm'] },
  pokeemerald: { branch: 'master', paths: ['graphics/pokedex/region_map.bin', 'graphics/pokedex/region_map.png', 'graphics/pokedex/region_map.pal', 'src/data/region_map/region_map_sections.json'] },
  pokefirered: { branch: 'master', paths: ['graphics/region_map', 'src/data/region_map'] },
};

function ensureRepo(name: string) {
  const dir = resolve(PRET, name);
  const { branch, paths } = REPOS[name];
  if (!existsSync(dir)) {
    mkdirSync(PRET, { recursive: true });
    execSync(`git clone -q --depth 1 --filter=blob:none --no-checkout --branch ${branch} https://github.com/pret/${name} ${name}`, { cwd: PRET, stdio: 'inherit' });
  }
  const missing = paths.filter((p) => !existsSync(resolve(dir, p)));
  if (missing.length) execSync(`git checkout HEAD -- ${missing.join(' ')}`, { cwd: dir, stdio: 'inherit' });
  return dir;
}

// ---------------------------------------------------------------------------
// Minimal PNG decoder → palette indices / gray levels (the decomps' tile sheets are indexed or 2bpp gray)
// ---------------------------------------------------------------------------

interface IndexedImage {
  width: number;
  height: number;
  /** One value per pixel: palette index (indexed) or gray level scaled to 0..(2^depth − 1). */
  data: Uint8Array;
  palette?: RGB[];
  depth: number;
  gray: boolean;
}

function decodePNG(file: string): IndexedImage {
  const buf = readFileSync(file);
  let pos = 8;
  let width = 0, height = 0, depth = 0, colorType = 0;
  const idat: Buffer[] = [];
  let palette: RGB[] | undefined;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      if (body[12]) throw new Error(`${file}: interlaced PNGs are not supported`);
    } else if (type === 'PLTE') {
      palette = [];
      for (let i = 0; i < body.length; i += 3) palette.push([body[i], body[i + 1], body[i + 2]]);
    } else if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  if (colorType !== 0 && colorType !== 3) throw new Error(`${file}: colour type ${colorType} not supported`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = Math.ceil((width * depth) / 8);
  const bpp = Math.max(1, depth / 8);
  const rows: Uint8Array[] = [];
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      if (f === 1) line[i] = (line[i] + a) & 255;
      else if (f === 2) line[i] = (line[i] + b) & 255;
      else if (f === 3) line[i] = (line[i] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    rows.push(line);
    prev = line;
  }
  const data = new Uint8Array(width * height);
  const mask = (1 << depth) - 1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      data[y * width + x] = depth === 8 ? rows[y][x] : (rows[y][bit >> 3] >> (8 - depth - (bit & 7))) & mask;
    }
  return { width, height, data, palette, depth, gray: colorType === 0 };
}

const readJASC = (file: string): RGB[] =>
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .slice(3)
    .filter((l) => l.trim())
    .map((l) => l.trim().split(/\s+/).map(Number) as RGB);
const gbc = (r: number, g: number, b: number): RGB => [(r * 255) / 31, (g * 255) / 31, (b * 255) / 31].map(Math.round) as RGB;

/** Paint a tilemap into an RGB canvas. `tile(i)` gives the 8×8 tile's colour for pixel (x, y). */
class Canvas {
  readonly px: Uint8Array;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height * 3);
  }
  set(x: number, y: number, [r, g, b]: RGB) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const o = (y * this.width + x) * 3;
    this.px[o] = r;
    this.px[o + 1] = g;
    this.px[o + 2] = b;
  }
  async save(file: string) {
    await sharp(Buffer.from(this.px), { raw: { width: this.width, height: this.height, channels: 3 } })
      .png({ palette: true, compressionLevel: 9 })
      .toFile(file);
  }
}

/** Colour of pixel (px, py) of tile `t` in a tile sheet (8×8 tiles, row-major). */
const tilePixel = (sheet: IndexedImage, t: number, px: number, py: number) => {
  const cols = sheet.width / 8;
  const x = (t % cols) * 8 + px;
  const y = Math.floor(t / cols) * 8 + py;
  return y < sheet.height ? sheet.data[y * sheet.width + x] : 0;
};

/** A Game Boy sprite as rows of '#' (black), '+' (grey) and '.' (colour 0: transparent). */
function nestIcon(file: string): string[] {
  const im = decodePNG(file);
  const max = (1 << im.depth) - 1;
  const rows: string[] = [];
  for (let y = 0; y < im.height; y++) {
    let r = '';
    for (let x = 0; x < im.width; x++) {
      const v = im.data[y * im.width + x];
      r += v === max ? '.' : v === 0 ? '#' : '+';
    }
    rows.push(r);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Location names → PokeAPI location identifiers
// ---------------------------------------------------------------------------

const kebab = (s: string) =>
  s
    .replace(/Name$/, '')
    .replace(/^MAPSEC_/, '')
    .replace(/([a-z])([A-Z0-9])/g, '$1-$2')
    .replace(/([0-9])([A-Za-z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();

/** Candidate PokeAPI identifiers for a decomp location name in a region. */
function candidates(name: string, region: string): string[] {
  const k = kebab(name);
  const alias: Record<string, string[]> = {
    'mount-moon': ['mt-moon'],
    'mt-moon': ['mt-moon'],
    'power-plant': ['kanto-power-plant'],
    'safari-zone': [`${region}-safari-zone`],
    'victory-road': [`${region}-victory-road-2`, `${region}-victory-road-1`, `${region}-victory-road`],
    'kanto-victory-road': ['kanto-victory-road-2', 'kanto-victory-road-1'],
    'underground-path': ['kanto-underground-path'],
    'digletts-cave': ['digletts-cave'],
    'pokemon-league': [`${region}-pokemon-league`],
    'ss-anne': ['ss-anne'],
    'tin-tower': ['bell-tower'],
    'lake-of-rage': ['lake-of-rage'],
    'rocket-hq': ['team-rocket-hq'],
    'mt-silver': ['mt-silver'],
    'silver-cave': ['mt-silver'],
    'mt-mortar': ['mt-mortar'],
    'altering-cave': [`${region}-altering-cave`],
    'aqua-hideout': ['team-aqua-hideout'],
    'magma-hideout': ['team-magma-hideout', 'magma-hideout'],
    'mt-chimney': ['mt-chimney'],
    'underwater-128': ['hoenn-route-128'],
    'underwater-124': ['hoenn-route-124'],
    'underwater-126': ['hoenn-route-126'],
    'underwater-127': ['hoenn-route-127'],
    'underwater-sootopolis': ['sootopolis-city'],
    'underwater-seafloor-cavern': ['seafloor-cavern'],
    'underwater-sealed-chamber': ['sealed-chamber'],
    'battle-frontier': ['hoenn-battle-frontier'],
    'navel-rock': ['navel-rock'],
    'birth-island': ['birth-island'],
    'mt-ember': ['mt-ember'],
    'rocket-warehouse': ['team-rocket-warehouse'],
  };
  const route = k.match(/^route-(\d+)$/);
  const list = [...(alias[k] ?? []), k, `${region}-${k}`];
  if (route) list.unshift(`${region}-route-${route[1]}`, `${region}-sea-route-${route[1]}`);
  return list;
}

/** Location identifiers that have encounters in the given PokeAPI versions (for matching + reporting). */
function encounterLocations(versions: string[]): Set<string> {
  const csv = (f: string) => readFileSync(resolve(POKEAPI, `${f}.csv`), 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const ver = new Map(csv('versions').map(([id, , ident]) => [ident, id]));
  const wanted = new Set(versions.map((v) => ver.get(v)));
  const areaLoc = new Map(csv('location_areas').map(([id, loc]) => [id, loc]));
  const locIdent = new Map(csv('locations').map(([id, , ident]) => [id, ident]));
  const out = new Set<string>();
  for (const [, v, area] of csv('encounters')) if (wanted.has(v)) out.add(locIdent.get(areaLoc.get(area)!)!);
  return out;
}

/**
 * Resolve a decomp name to PokeAPI identifiers. Every candidate with encounters gets the rect (Emerald's
 * and ORAS's Magma Hideout are different ids); otherwise the region-prefixed guess.
 */
function place(places: Record<string, Rect[]>, name: string, region: string, known: Set<string>, rect: Rect) {
  const ids = candidates(name, region);
  const hits = ids.filter((c) => known.has(c));
  // No encounters here: routes get the region prefix PokeAPI uses, anything else its plain name.
  const fallback = /^route-\d+$/.test(kebab(name)) ? ids[0] : kebab(name);
  for (const id of hits.length ? [...new Set(hits)] : [fallback]) (places[id] ??= []).push(rect);
}

/**
 * Locations the older map doesn't show (HeartGold/SoulSilver, Omega Ruby/Alpha Sapphire additions,
 * FireRed/LeafGreen interiors): anchored next to a place that is on it. [location, anchor, dx, dy] in cells.
 */
const ANCHORS: Record<string, [string, string, number, number][]> = {
  'johto-gsc': [
    ['johto-route-47', 'cianwood-city', -1, 0],
    ['embedded-tower', 'cianwood-city', -1, 0],
    ['johto-route-48', 'cianwood-city', -2, -1],
    ['johto-safari-zone', 'cianwood-city', -2, -2],
    ['safari-zone-gate', 'cianwood-city', -2, -2],
    ['team-rocket-hq', 'mahogany-town', 0, 0],
    ['sinjoh-ruins', 'ruins-of-alph', 0, 0],
  ],
  'kanto-gsc': [
    ['viridian-forest', 'kanto-route-2', 0, 0],
    ['cerulean-cave', 'cerulean-city', 0, -1],
    ['mt-silver', 'kanto-route-28', -1, 0],
  ],
  'hoenn-rse': [
    ['sea-mauville', 'hoenn-route-108', 0, 0],
    ['battle-resort', 'hoenn-battle-frontier', 0, 0],
    ['mossdeep-space-center', 'mossdeep-city', 0, 0],
    ['magma-hideout', 'jagged-pass', 0, 0],
  ],
  'kanto-frlg': [
    ['ss-anne', 'vermilion-city', 0, 0],
    // Let's Go names Victory Road by its Gen 1 id.
    ['kanto-victory-road-1', 'kanto-victory-road-2', 0, 0],
    ['kanto-underground-path', 'saffron-city', 0, 0],
  ],
  'sevii-67': ['monean-chamber', 'liptoo-chamber', 'weepth-chamber', 'dilford-chamber', 'scufib-chamber', 'rixy-chamber', 'viapos-chamber'].map(
    (c) => [c, 'tanoby-ruins', 0, 0] as [string, string, number, number],
  ),
};

function anchor(map: RegionMapOut, cell: number) {
  for (const [loc, ref, dx, dy] of ANCHORS[map.id] ?? []) {
    const r = map.places[ref]?.[0];
    if (!r || map.places[loc]) continue;
    map.places[loc] = [[r[0] + dx * cell, r[1] + dy * cell, map.style === 'nest' ? 8 : r[2], map.style === 'nest' ? 8 : r[3]]];
  }
}

function report(map: RegionMapOut, known: Set<string>, region: string | string[]) {
  const regions = Array.isArray(region) ? region : [region];
  const missing = [...known].filter((l) => !map.places[l] && !/^roaming|pokemart|pokecenter|^unknown/.test(l));
  const regionOf = (l: string) => regions.some((r) => l.startsWith(r)) || true;
  const list = missing.filter(regionOf);
  console.log(`  ${map.id}: ${Object.keys(map.places).length} places${list.length ? ` · unplaced: ${list.join(', ')}` : ''}`);
}

// ---------------------------------------------------------------------------
// Gen 1: Red / Blue / Yellow
// ---------------------------------------------------------------------------

async function kantoRBY(): Promise<RegionMapOut> {
  const dir = ensureRepo('pokered');
  const sheet = decodePNG(resolve(dir, 'gfx/town_map/town_map.png'));
  const rle = readFileSync(resolve(dir, 'gfx/town_map/town_map.rle'));
  const tiles: number[] = [];
  for (const b of rle) {
    if (!b) break;
    for (let i = 0; i < (b & 15); i++) tiles.push(b >> 4);
  }
  // Super Game Boy PAL_TOWNMAP (data/sgb/sgb_palettes.asm), lightest → darkest.
  const pal = [gbc(31, 29, 31), gbc(20, 26, 31), gbc(17, 23, 10), gbc(3, 2, 2)];
  const c = new Canvas(160, 144);
  tiles.forEach((t, i) => {
    const tx = (i % 20) * 8, ty = Math.floor(i / 20) * 8;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) c.set(tx + x, ty + y, pal[3 - tilePixel(sheet, t, x, y)]);
  });
  await c.save(resolve(OUT_IMG, 'kanto-rby.png'));

  const known = encounterLocations(['red', 'blue', 'yellow']);
  const places: Record<string, Rect[]> = {};
  const asm = readFileSync(resolve(dir, 'data/maps/town_map_entries.asm'), 'utf8');
  // outdoor_map x, y, Name  /  indoor_map GROUP, x, y, Name — the nest icon is drawn at (8x+16, 8y+8).
  for (const m of asm.matchAll(/outdoor_map\s+(\d+),\s*(\d+),\s*(\w+)|indoor_map\s+\w+,\s*(\d+),\s*(\d+),\s*(\w+)/g)) {
    const [x, y, name] = m[1] !== undefined ? [+m[1], +m[2], m[3]] : [+m[4], +m[5], m[6]];
    if (!x && !y) continue; // unused entry
    const rect: Rect = [x * 8 + 16, y * 8 + 8, 8, 8];
    const ids = candidates(name, 'kanto');
    const id = ids.find((cand) => known.has(cand)) ?? ids.find((cand) => cand.startsWith('kanto')) ?? ids[0];
    if (!(places[id] ?? []).some((r) => r[0] === rect[0] && r[1] === rect[1])) (places[id] ??= []).push(rect);
  }
  const map: RegionMapOut = { id: 'kanto-rby', name: 'Kanto', width: 160, height: 144, image: 'maps/kanto-rby.png', style: 'nest', places, nestIcon: nestIcon(resolve(dir, 'gfx/town_map/mon_nest_icon.png')), source: 'pret/pokered' };
  report(map, known, 'kanto');
  return map;
}

// ---------------------------------------------------------------------------
// Gen 2: Crystal (Johto + Kanto)
// ---------------------------------------------------------------------------

async function crystal(): Promise<RegionMapOut[]> {
  const dir = ensureRepo('pokecrystal');
  const sheet = decodePNG(resolve(dir, 'gfx/pokegear/town_map.png'));
  const palText = readFileSync(resolve(dir, 'gfx/pokegear/pokegear.pal'), 'utf8');
  const colors = [...palText.matchAll(/RGB\s+(\d+),\s*(\d+),\s*(\d+)/g)].map((m) => gbc(+m[1], +m[2], +m[3]));
  const pals = [0, 1, 2, 3, 4, 5].map((p) => colors.slice(p * 4, p * 4 + 4));
  const palNames = ['BORDER', 'EARTH', 'MOUNTAIN', 'CITY', 'POI', 'POI_MTN'];
  // townmappals A, B, … are stored as `dn B, A` pairs; the tile order is A, B.
  const palMapText = readFileSync(resolve(dir, 'gfx/pokegear/town_map_palette_map.asm'), 'utf8').split('; gfx/pokegear/pokegear.png')[0];
  const tilePal = [...palMapText.matchAll(/townmappals\s+([^\n]+)/g)].flatMap((m) => m[1].split(',').map((s) => palNames.indexOf(s.trim())));

  const known = encounterLocations(['gold', 'silver', 'crystal', 'heartgold', 'soulsilver']);
  const landmarks = [...readFileSync(resolve(dir, 'data/maps/landmarks.asm'), 'utf8').matchAll(/landmark\s+(-?\d+),\s*(-?\d+),\s*(\w+)/g)].map((m) => ({
    x: +m[1],
    y: +m[2],
    name: m[3],
  }));
  // Johto landmarks come first; Kanto's start at Pallet Town (constants/landmark_constants.asm: KANTO_LANDMARK).
  const kantoStart = landmarks.findIndex((l) => l.name === 'PalletTownName');

  const out: RegionMapOut[] = [];
  for (const [id, file, region, from, to] of [
    ['johto-gsc', 'johto.bin', 'johto', 1, kantoStart],
    ['kanto-gsc', 'kanto.bin', 'kanto', kantoStart, landmarks.length],
  ] as const) {
    const tm = readFileSync(resolve(dir, 'gfx/pokegear', file));
    const c = new Canvas(160, 144);
    for (let i = 0; i < 360; i++) {
      const t = tm[i];
      const pal = pals[tilePal[t] ?? 0] ?? pals[0];
      const tx = (i % 20) * 8, ty = Math.floor(i / 20) * 8;
      // 2bpp gray 3 (white) is GB colour 0.
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) c.set(tx + x, ty + y, pal[3 - tilePixel(sheet, t, x, y)]);
    }
    await c.save(resolve(OUT_IMG, `${id}.png`));
    const places: Record<string, Rect[]> = {};
    // The nest icon (8×8) is centred on the landmark point.
    for (const lm of landmarks.slice(from, to)) place(places, lm.name, region, known, [lm.x - 4, lm.y - 4, 8, 8]);
    const map: RegionMapOut = { id, name: region === 'johto' ? 'Johto' : 'Kanto', width: 160, height: 144, image: `maps/${id}.png`, style: 'nest', places, nestIcon: nestIcon(resolve(dir, 'gfx/pokegear/dexmap_nest_icon.png')), source: 'pret/pokecrystal' };
    anchor(map, 8);
    report(map, new Set([...known].filter((l) => (region === 'johto' ? !l.startsWith('kanto') && !kantoNames.has(l) : l.startsWith('kanto') || kantoNames.has(l)))), region);
    out.push(map);
  }
  return out;
}
/** Kanto locations without a "kanto-" prefix in PokeAPI. */
const kantoNames = new Set([
  'pallet-town', 'viridian-city', 'pewter-city', 'cerulean-city', 'vermilion-city', 'lavender-town', 'celadon-city', 'saffron-city', 'fuchsia-city',
  'cinnabar-island', 'viridian-forest', 'mt-moon', 'digletts-cave', 'rock-tunnel', 'pokemon-tower', 'seafoam-islands', 'pokemon-mansion',
  'cerulean-cave', 'ss-anne', 'mt-silver', 'tohjo-falls',
]);

// ---------------------------------------------------------------------------
// Gen 3: Emerald (Hoenn) and FireRed / LeafGreen (Kanto + Sevii Islands)
// ---------------------------------------------------------------------------

async function hoennRSE(): Promise<RegionMapOut> {
  const dir = ensureRepo('pokeemerald');
  const sheet = decodePNG(resolve(dir, 'graphics/pokedex/region_map.png'));
  const pal = readJASC(resolve(dir, 'graphics/pokedex/region_map.pal'));
  const tm = readFileSync(resolve(dir, 'graphics/pokedex/region_map.bin'));
  // Tilemap: 32×32 u16 entries (tile | hflip<<10 | vflip<<11); the area screen shows the top 240×160.
  const W = 240, H = 160;
  const c = new Canvas(W, H);
  for (let i = 0; i < 32 * 32; i++) {
    const e = tm.readUInt16LE(i * 2);
    const t = e & 0x3ff, hf = e & 0x400, vf = e & 0x800;
    const tx = (i % 32) * 8, ty = Math.floor(i / 32) * 8;
    if (tx >= W || ty >= H) continue;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        // The sheet's indices point into BG palette slot 7 (colours 112+), where the game loads the palette.
        const idx = tilePixel(sheet, t, hf ? 7 - x : x, vf ? 7 - y : y);
        c.set(tx + x, ty + y, pal[idx ? idx - 112 : 0] ?? [0, 0, 0]);
      }
  }
  await c.save(resolve(OUT_IMG, 'hoenn-rse.png'));

  const known = encounterLocations(['ruby', 'sapphire', 'emerald', 'omega-ruby', 'alpha-sapphire']);
  const sections = JSON.parse(readFileSync(resolve(dir, 'src/data/region_map/region_map_sections.json'), 'utf8')).map_sections as {
    id: string; x?: number; y?: number; width?: number; height?: number;
  }[];
  const places: Record<string, Rect[]> = {};
  // Map cells are 8 px, offset by (MAPCURSOR_X_MIN, MAPCURSOR_Y_MIN) = (1, 2) tiles.
  for (const s of sections) {
    if (s.x === undefined || !s.width || s.id.includes('NONE')) continue;
    place(places, s.id, 'hoenn', known, [(s.x + 1) * 8, (s.y! + 2) * 8, s.width * 8, s.height! * 8]);
  }
  const map: RegionMapOut = { id: 'hoenn-rse', name: 'Hoenn', width: W, height: H, image: 'maps/hoenn-rse.png', style: 'area', places, source: 'pret/pokeemerald' };
  anchor(map, 8);
  report(map, known, 'hoenn');
  return map;
}

async function frlg(): Promise<RegionMapOut[]> {
  const dir = ensureRepo('pokefirered');
  const sheet = decodePNG(resolve(dir, 'graphics/region_map/region_map.png'));
  const pal = readJASC(resolve(dir, 'graphics/region_map/region_map.pal'));
  const known = encounterLocations(['firered', 'leafgreen']);
  const out: RegionMapOut[] = [];
  for (const [id, name, bin, layout] of [
    ['kanto-frlg', 'Kanto', 'kanto.bin', 'region_map_layout_kanto.h'],
    ['sevii-123', 'Sevii Islands 1–3', 'sevii_123.bin', 'region_map_layout_sevii_123.h'],
    ['sevii-45', 'Sevii Islands 4–5', 'sevii_45.bin', 'region_map_layout_sevii_45.h'],
    ['sevii-67', 'Sevii Islands 6–7', 'sevii_67.bin', 'region_map_layout_sevii_67.h'],
  ] as const) {
    // Tilemap: 30×20 u16 entries (tile | hflip | vflip | palette bank << 12) over 4bpp tiles.
    const tm = readFileSync(resolve(dir, 'graphics/region_map', bin));
    const W = 240, H = 160;
    const c = new Canvas(W, H);
    for (let i = 0; i < 30 * 20; i++) {
      const e = tm.readUInt16LE(i * 2);
      const t = e & 0x3ff, hf = e & 0x400, vf = e & 0x800, bank = e >> 12;
      const tx = (i % 30) * 8, ty = Math.floor(i / 30) * 8;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) c.set(tx + x, ty + y, pal[bank * 16 + (tilePixel(sheet, t, hf ? 7 - x : x, vf ? 7 - y : y) & 15)] ?? [0, 0, 0]);
    }
    await c.save(resolve(OUT_IMG, `${id}.png`));

    // Section grid: [layer][row][col] of MAPSEC_ names, 22×15 cells of 8 px from tile (1, 2).
    const src = readFileSync(resolve(dir, 'src/data/region_map', layout), 'utf8');
    const places: Record<string, Rect[]> = {};
    for (const layer of src.split(/\[LAYER_\w+\]\s*=/).slice(1)) {
      const rows = [...layer.matchAll(/\{([^{}]*MAPSEC[^{}]*)\}/g)].map((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
      rows.forEach((row, y) =>
        row.forEach((sec, x) => {
          if (sec === 'MAPSEC_NONE') return;
          const clean = sec.replace(/_POKECENTER$/, '');
          place(places, clean, 'kanto', known, [(x + 1) * 8, (y + 2) * 8, 8, 8]);
        }),
      );
    }
    const map: RegionMapOut = { id, name, width: W, height: H, image: `maps/${id}.png`, style: 'area', places, source: 'pret/pokefirered' };
    anchor(map, 8);
    out.push(map);
  }
  const union: Record<string, Rect[]> = {};
  for (const m of out) for (const k of Object.keys(m.places)) union[k] = [];
  report({ ...out[0], id: 'kanto-frlg + sevii', places: union }, known, 'kanto');
  return out;
}

// ---------------------------------------------------------------------------
// Schematic maps (Gen 4+): src/data/maps/<id>.json, validated against the encounter data
// ---------------------------------------------------------------------------

interface SchematicFile {
  id: string;
  name: string;
  width: number;
  height: number;
  /** PokeAPI versions whose encounters this map should place (for the coverage report). */
  versions: string[];
  /** Games whose Area page shows this map (defaults to `versions`); DLC maps list their base game. */
  games?: string[];
  /** Tab order among a game's maps (default 0). */
  order?: number;
  land?: string[];
  /** id → [x, y, w, h, kind?, label?] */
  places: Record<string, [number, number, number, number, string?, string?]>;
}

function schematicFiles(): SchematicFile[] {
  if (!existsSync(SCHEMATIC_DIR)) return [];
  return readdirSync(SCHEMATIC_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(resolve(SCHEMATIC_DIR, f), 'utf8')) as SchematicFile)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

function schematics(): RegionMapOut[] {
  return schematicFiles().map((s) => {
      const places: Record<string, Rect[]> = {};
      const kinds: Record<string, string> = {};
      const labels: Record<string, string> = {};
      for (const [id, [x, y, w, h, kind, label]] of Object.entries(s.places)) {
        places[id] = [[x, y, w, h]];
        if (kind) kinds[id] = kind;
        if (label) labels[id] = label;
      }
      const map: RegionMapOut = { id: s.id, name: s.name, width: s.width, height: s.height, style: 'schematic', places, land: s.land, kinds, labels, source: 'schematic' };
      report(map, encounterLocations(s.versions), s.id);
      return map;
  });
}

// ---------------------------------------------------------------------------

/** Which maps each game's Area page shows (PokeAPI version identifiers). */
export const GAME_MAPS: Record<string, string[]> = {
  red: ['kanto-rby'], blue: ['kanto-rby'], yellow: ['kanto-rby'],
  gold: ['johto-gsc', 'kanto-gsc'], silver: ['johto-gsc', 'kanto-gsc'], crystal: ['johto-gsc', 'kanto-gsc'],
  ruby: ['hoenn-rse'], sapphire: ['hoenn-rse'], emerald: ['hoenn-rse'],
  firered: ['kanto-frlg', 'sevii-123', 'sevii-45', 'sevii-67'], leafgreen: ['kanto-frlg', 'sevii-123', 'sevii-45', 'sevii-67'],
  heartgold: ['johto-gsc', 'kanto-gsc'], soulsilver: ['johto-gsc', 'kanto-gsc'],
  'omega-ruby': ['hoenn-rse'], 'alpha-sapphire': ['hoenn-rse'],
  // Let's Go's Kanto is Red/Blue's; FireRed/LeafGreen's map has every place it uses.
  'lets-go-pikachu': ['kanto-frlg'], 'lets-go-eevee': ['kanto-frlg'],
};

async function main() {
  mkdirSync(OUT_IMG, { recursive: true });
  const maps: RegionMapOut[] = [await kantoRBY(), ...(await crystal()), await hoennRSE(), ...(await frlg()), ...schematics()];
  const games: Record<string, string[]> = { ...GAME_MAPS };
  for (const s of schematicFiles()) for (const v of s.games ?? s.versions) games[v] = [...(games[v] ?? []).filter((m) => m !== s.id), s.id];
  writeFileSync(OUT_JSON, JSON.stringify({ maps: Object.fromEntries(maps.map((m) => [m.id, m])), games }));
  console.log(`wrote ${maps.length} maps → public/maps/, src/data/generated/maps.json`);
}

main();
