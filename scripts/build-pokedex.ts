/**
 * Pokédex pipeline for the Gen 1–9 side: joins each Pokédex "book" — a generation (gen<N>) or one of
 * the other main-series games (lgpe, bdsp, pla, za) — with PokeAPI's CSV tables and writes
 * src/data/generated/pokedex-<book>.json:
 *
 *   - Pokédex entries (flavor text) from that generation's games, species category ("Seed Pokémon"),
 *     height, and regional Pokédex numbers (Kanto, Johto, Hoenn, … as each game numbered them)
 *   - wild encounters in that generation's games: location / sub-area, method (grass, Surf, Old Rod,
 *     Headbutt…), level range, encounter rate and conditions (time of day, season, Swarm, Radar…)
 *
 *   npm run pokedex
 *
 * The CSVs are downloaded once into .cache/pokeapi/ (delete it to refresh). Encounters for the games
 * PokeAPI doesn't cover (BDSP, Legends: Arceus, Scarlet/Violet, Legends: Z-A) or covers only partly
 * (ORAS, SM/USUM) come from PKHeX instead (scripts/pkhex-encounters.ts).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pkhexEncounters, type PkhexEncounter } from './pkhex-encounters.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const OUT = resolve(ROOT, 'src/data/generated');
const CACHE = resolve(ROOT, '.cache/pokeapi');
const CSV_BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const EN = '9';
const toID = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const TABLES = [
  'versions', 'version_names', 'version_groups', 'pokedexes', 'pokedex_version_groups', 'pokemon_dex_numbers',
  'pokemon', 'pokemon_species_names', 'pokemon_species_flavor_text',
  'encounters', 'encounter_slots', 'encounter_method_prose', 'encounter_condition_values',
  'encounter_condition_value_prose', 'encounter_condition_value_map',
  'locations', 'location_names', 'location_areas', 'location_area_prose', 'regions', 'pokemon_forms',
] as const;
type Row = Record<string, string>;

/** Pokédex books: the games each one covers (PokeAPI version ids). DLC versions fold into their base game. */
export const BOOKS: { id: string; generation: number; versions: string[] }[] = [
  { id: 'gen1', generation: 1, versions: ['red', 'blue', 'yellow'] },
  { id: 'gen2', generation: 2, versions: ['gold', 'silver', 'crystal'] },
  { id: 'gen3', generation: 3, versions: ['ruby', 'sapphire', 'emerald', 'firered', 'leafgreen'] },
  { id: 'gen4', generation: 4, versions: ['diamond', 'pearl', 'platinum', 'heartgold', 'soulsilver'] },
  { id: 'gen5', generation: 5, versions: ['black', 'white', 'black-2', 'white-2'] },
  { id: 'gen6', generation: 6, versions: ['x', 'y', 'omega-ruby', 'alpha-sapphire'] },
  { id: 'gen7', generation: 7, versions: ['sun', 'moon', 'ultra-sun', 'ultra-moon'] },
  { id: 'gen8', generation: 8, versions: ['sword', 'shield'] },
  { id: 'gen9', generation: 9, versions: ['scarlet', 'violet'] },
  { id: 'lgpe', generation: 7, versions: ['lets-go-pikachu', 'lets-go-eevee'] },
  { id: 'bdsp', generation: 8, versions: ['brilliant-diamond', 'shining-pearl'] },
  { id: 'pla', generation: 8, versions: ['legends-arceus'] },
  { id: 'za', generation: 9, versions: ['legends-za'] },
];
/** Versions whose wild encounters come from PKHeX rather than PokeAPI. */
const PKHEX_VERSIONS = new Set([
  'omega-ruby', 'alpha-sapphire', 'sun', 'moon', 'ultra-sun', 'ultra-moon',
  'brilliant-diamond', 'shining-pearl', 'legends-arceus', 'scarlet', 'violet', 'legends-za',
]);
/**
 * PokeAPI encounter methods that are ordinary wild slots (grass, water, rods, Rock Smash, Headbutt,
 * SOS, overworld spawns, Honey Trees…). For PKHeX-sourced games these come from PKHeX; PokeAPI's other
 * rows (gifts, static encounters, Island Scan, trades, events) are kept.
 */
const WILD_METHOD_IDS = new Set([
  ...Array.from({ length: 17 }, (_, i) => String(i + 1)),
  ...['22', '23', '24', '27', '28', '29', '31', '33', '34', '37', '38', '39', '40', '41', '42', '43', '44'],
  ...['55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65', '66'],
]);
/** Region of each PKHeX-sourced version, to match its location names to PokeAPI's. */
const PKHEX_REGION: Record<string, string> = {
  'omega-ruby': 'hoenn', 'alpha-sapphire': 'hoenn', sun: 'alola', moon: 'alola', 'ultra-sun': 'alola', 'ultra-moon': 'alola',
  'brilliant-diamond': 'sinnoh', 'shining-pearl': 'sinnoh', 'legends-arceus': 'hisui', scarlet: 'paldea', violet: 'paldea',
  'legends-za': 'kalos',
};
const DLC_OF: Record<string, string> = {
  'the-isle-of-armor-sword': 'sword', 'the-crown-tundra-sword': 'sword',
  'the-isle-of-armor-shield': 'shield', 'the-crown-tundra-shield': 'shield',
  'the-teal-mask-scarlet': 'scarlet', 'the-indigo-disk-scarlet': 'scarlet',
  'the-teal-mask-violet': 'violet', 'the-indigo-disk-violet': 'violet',
  'mega-dimension': 'legends-za',
};
/** Friendlier names for regional Pokédexes. */
const DEX_LABELS: Record<string, string> = {
  kanto: 'Kanto', 'original-johto': 'Johto', 'updated-johto': 'Johto (HGSS)', hoenn: 'Hoenn', 'updated-hoenn': 'Hoenn (ORAS)',
  'original-sinnoh': 'Sinnoh (DP)', 'extended-sinnoh': 'Sinnoh (Pt)', 'original-unova': 'Unova (BW)', 'updated-unova': 'Unova (B2W2)',
  'kalos-central': 'Central Kalos', 'kalos-coastal': 'Coastal Kalos', 'kalos-mountain': 'Mountain Kalos',
  'original-alola': 'Alola (SM)', 'updated-alola': 'Alola (USUM)', galar: 'Galar', 'isle-of-armor': 'Isle of Armor',
  'crown-tundra': 'Crown Tundra', paldea: 'Paldea', kitakami: 'Kitakami', blueberry: 'Blueberry',
  'letsgo-kanto': "Kanto (Let's Go)", hisui: 'Hisui', 'lumiose-city': 'Lumiose City', hyperspace: 'Hyperspace Lumiose',
};
/** Island sub-dexes duplicate the Alola dex; skip them. */
const SKIP_DEX = /^(original|updated)-(melemele|akala|ulaula|poni)$/;

async function table(name: string): Promise<Row[]> {
  mkdirSync(CACHE, { recursive: true });
  const file = resolve(CACHE, `${name}.csv`);
  if (!existsSync(file)) {
    const res = await fetch(`${CSV_BASE}/${name}.csv`);
    if (!res.ok) throw new Error(`${name}.csv: HTTP ${res.status}`);
    writeFileSync(file, await res.text());
  }
  return parseCSV(readFileSync(file, 'utf8'));
}

/** Minimal RFC 4180 parser (quoted fields may contain commas and newlines). */
function parseCSV(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** Game text → plain text: soft hyphens at line ends join, other breaks become spaces. */
const cleanText = (s: string) =>
  s
    .replace(/­\n/g, '')
    .replace(/-\n(?=[a-z])/g, '-')
    .replace(/[\f\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/POKéMON/g, 'Pokémon')
    .trim();

async function main() {
  const T = Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await table(t)] as const))) as Record<(typeof TABLES)[number], Row[]>;
  const en = (rows: Row[], key: string, lang = 'local_language_id') => new Map(rows.filter((r) => r[lang] === EN).map((r) => [r[key], r]));

  const versions = new Map(T.versions.map((r) => [r.id, r]));
  const versionNames = en(T.version_names, 'version_id');
  const versionGroupOf = new Map(T.versions.map((r) => [r.identifier, r.version_group_id]));
  const pokedexes = new Map(T.pokedexes.map((r) => [r.id, r]));
  const speciesNames = en(T.pokemon_species_names, 'pokemon_species_id');
  const methodNames = en(T.encounter_method_prose, 'encounter_method_id');
  const condValues = new Map(T.encounter_condition_values.map((r) => [r.id, r]));
  const condNames = en(T.encounter_condition_value_prose, 'encounter_condition_value_id');
  const locations = new Map(T.locations.map((r) => [r.id, r]));
  const locationNames = en(T.location_names, 'location_id');
  const areas = new Map(T.location_areas.map((r) => [r.id, r]));
  const areaNames = en(T.location_area_prose, 'location_area_id');
  const regions = new Map(T.regions.map((r) => [r.id, r.identifier]));
  const slots = new Map(T.encounter_slots.map((r) => [r.id, r]));
  const pokemon = new Map(T.pokemon.map((r) => [r.id, r]));
  const condsOf = new Map<string, string[]>();
  for (const r of T.encounter_condition_value_map) {
    const list = condsOf.get(r.encounter_id) ?? [];
    list.push(r.encounter_condition_value_id);
    condsOf.set(r.encounter_id, list);
  }
  const defaultPokemon = new Map(T.pokemon.filter((r) => r.is_default === '1').map((r) => [Number(r.species_id), r]));
  const versionOrder = (id: string) => Number(versions.get(id)?.id ?? 0);

  // PKHeX (species, form) → PokeAPI pokemon: forms in form_order, battle-only ones (Gigantamax…) excluded.
  const formPokemon = new Map<string, string>();
  {
    const bySpecies = new Map<string, Row[]>();
    for (const f of T.pokemon_forms) {
      if (f.is_battle_only === '1') continue;
      const sp = pokemon.get(f.pokemon_id)?.species_id;
      if (!sp) continue;
      bySpecies.set(sp, [...(bySpecies.get(sp) ?? []), f]);
    }
    for (const forms of bySpecies.values())
      forms.sort((a, b) => Number(a.form_order) - Number(b.form_order)).forEach((f, i) => formPokemon.set(`${pokemon.get(f.pokemon_id)!.species_id}:${i}`, f.pokemon_id));
  }
  // PKHeX location names → PokeAPI location identifiers, per region ("Mount Coronet" = "Mt. Coronet").
  const norm = (n: string) => toID(n.replace(/^Mount /, 'Mt. '));
  const locByName = new Map<string, string>();
  for (const l of T.locations) {
    const name = locationNames.get(l.id)?.name;
    const key = `${regions.get(l.region_id)}:${norm(name ?? '')}`;
    // Sub-locations ("ten-carat-hill--farthest-hollow") share their parent's name; keep the parent.
    if (name && (!locByName.has(key) || locByName.get(key)!.includes('--'))) locByName.set(key, l.identifier);
  }
  const kebab = (n: string) =>
    n.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const pkhex = pkhexEncounters();

  for (const book of BOOKS) {
    const gen = book.generation;
    const data = JSON.parse(readFileSync(resolve(OUT, `${book.id}.json`), 'utf8')) as {
      species: Record<string, { id: string; num: number; forme?: string; isMega: boolean; baseSpecies: string }>;
    };
    const species = Object.values(data.species).filter((s) => !s.isMega);
    const ids = new Set(species.map((s) => s.id));
    const baseByNum = new Map<number, string>();
    for (const s of species) if (!s.forme && !baseByNum.has(s.num)) baseByNum.set(s.num, s.id);

    const gameIds = book.versions;
    const versionIdOf = new Map(T.versions.map((r) => [r.identifier, r.id]));
    const gameVersionIds = new Set(gameIds.map((v) => versionIdOf.get(v)!));
    const groups = new Set(gameIds.map((v) => versionGroupOf.get(v)!));
    const games = gameIds.map((v) => ({ id: v, name: versionNames.get(versionIdOf.get(v)!)?.name ?? v }));
    const gameIndex = new Map(gameIds.map((v, i) => [v, i]));

    // ---- Regional Pokédexes used by this generation's games ----
    const dexIds = [...new Set(T.pokedex_version_groups.filter((r) => groups.has(r.version_group_id)).map((r) => r.pokedex_id))]
      .filter((id) => !SKIP_DEX.test(pokedexes.get(id)!.identifier) && (book.id === 'lgpe') === (pokedexes.get(id)!.identifier === 'letsgo-kanto'))
      .sort((a, b) => Number(a) - Number(b));
    const dexes = dexIds.map((id) => ({ id: pokedexes.get(id)!.identifier, name: DEX_LABELS[pokedexes.get(id)!.identifier] ?? pokedexes.get(id)!.identifier }));
    const dexNums = new Map<number, Record<string, number>>();
    for (const r of T.pokemon_dex_numbers) {
      if (!dexIds.includes(r.pokedex_id)) continue;
      const num = Number(r.species_id);
      const rec = dexNums.get(num) ?? {};
      rec[pokedexes.get(r.pokedex_id)!.identifier] = Number(r.pokedex_number);
      dexNums.set(num, rec);
    }

    // ---- Flavor text: this generation's games, else the latest earlier game (flagged) ----
    const flavorByNum = new Map<number, Row[]>();
    for (const r of T.pokemon_species_flavor_text) {
      if (r.language_id !== EN) continue;
      const list = flavorByNum.get(Number(r.species_id)) ?? [];
      list.push(r);
      flavorByNum.set(Number(r.species_id), list);
    }
    const firstGameId = Math.min(...[...gameVersionIds].map(Number));

    const entries: Record<string, unknown> = {};
    for (const num of new Set(species.map((s) => s.num))) {
      const rows = flavorByNum.get(num) ?? [];
      const own = rows.filter((r) => gameVersionIds.has(r.version_id)).sort((a, b) => versionOrder(a.version_id) - versionOrder(b.version_id));
      const texts: { games: string[]; text: string }[] = [];
      for (const r of own) {
        const text = cleanText(r.flavor_text);
        const game = versions.get(r.version_id)!.identifier;
        const same = texts.find((t) => t.text === text);
        if (same) same.games.push(game);
        else texts.push({ games: [game], text });
      }
      let fallback: { game: string; text: string } | undefined;
      if (!texts.length) {
        const prev = rows.filter((r) => Number(r.version_id) < firstGameId).sort((a, b) => versionOrder(b.version_id) - versionOrder(a.version_id))[0];
        if (prev) fallback = { game: versionNames.get(prev.version_id)?.name ?? versions.get(prev.version_id)!.identifier, text: cleanText(prev.flavor_text) };
      }
      const mon = defaultPokemon.get(num);
      entries[num] = {
        heightm: mon ? Number(mon.height) / 10 : undefined,
        genus: speciesNames.get(String(num))?.genus || undefined,
        flavor: texts.length ? texts : undefined,
        fallback,
        dex: dexNums.get(num),
      };
    }

    // ---- Encounters ----
    const pokeapiToId = (pid: string): string | undefined => {
      const p = pokemon.get(pid);
      if (!p) return undefined;
      const direct = toID(p.identifier);
      if (ids.has(direct)) return direct;
      return p.is_default === '1' ? baseByNum.get(Number(p.species_id)) : undefined;
    };
    type Agg = { species: string; game: number; area: string; method: string; conds: string[]; min: number; max: number; rate: number };
    const agg = new Map<string, Agg>();
    const areaTable = new Map<string, { loc: string; name: string; region?: string; sub?: string }>();
    for (const e of T.encounters) {
      const vid = e.version_id;
      const vname = DLC_OF[versions.get(vid)!.identifier] ?? versions.get(vid)!.identifier;
      if (!gameIndex.has(vname)) continue;
      if (PKHEX_VERSIONS.has(vname) && WILD_METHOD_IDS.has(slots.get(e.encounter_slot_id)!.encounter_method_id)) continue;
      const sid = pokeapiToId(e.pokemon_id);
      if (!sid) continue;
      const area = areas.get(e.location_area_id)!;
      const loc = locations.get(area.location_id)!;
      const areaKey = area.id;
      if (!areaTable.has(areaKey)) {
        const locName = locationNames.get(loc.id)?.name ?? loc.identifier;
        const full = areaNames.get(area.id)?.name;
        // PokeAPI area names read "Mt. Moon (1F)", "Oreburgh mine (B1F)", "Kanto Route 1"…: keep the part that
        // isn't the location's own name.
        const paren = full?.match(/\(([^)]+)\)\s*$/)?.[1];
        const rest = paren ?? (full && full.toLowerCase() !== locName.toLowerCase() ? full.replace(new RegExp(locName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/^[\s\-–:]+|\s+$/g, '') : '');
        const sub = rest && !toID(locName).includes(toID(rest)) && !/^road \d+$/i.test(rest) ? rest : undefined;
        areaTable.set(areaKey, { loc: loc.identifier, name: locName, region: regions.get(loc.region_id), sub });
      }
      const slot = slots.get(e.encounter_slot_id)!;
      const method = methodNames.get(slot.encounter_method_id)?.name ?? slot.encounter_method_id;
      const conds = (condsOf.get(e.id) ?? [])
        .map((c) => condValues.get(c)!)
        // Max Raid Den star ratings / rarity tiers would multiply Sword/Shield's rows; fold them.
        .filter((c) => c.is_default !== '1' && !c.identifier.startsWith('max-den-'))
        .map((c) => condNames.get(c.id)?.name ?? c.identifier)
        .sort();
      const key = [sid, gameIndex.get(vname), areaKey, method, conds.join('|')].join('~');
      const cur = agg.get(key);
      const rate = Number(slot.rarity) || 0;
      if (cur) {
        cur.min = Math.min(cur.min, Number(e.min_level));
        cur.max = Math.max(cur.max, Number(e.max_level));
        cur.rate += rate;
      } else {
        agg.set(key, { species: sid, game: gameIndex.get(vname)!, area: areaKey, method, conds, min: Number(e.min_level), max: Number(e.max_level), rate });
      }
    }
    // PKHeX-sourced games: same aggregation, keyed by location name.
    for (const v of gameIds.filter((g) => PKHEX_VERSIONS.has(g))) {
      for (const e of pkhex.get(v) ?? ([] as PkhexEncounter[])) {
        const pid = formPokemon.get(`${e.species}:${e.form}`);
        const sid = (pid && pokeapiToId(pid)) || baseByNum.get(e.species);
        if (!sid) continue;
        // "Grand Underground (Spacious Cave)" → Grand Underground, sub-area Spacious Cave.
        const ug = e.location.match(/^(Grand Underground) \((.+)\)$/);
        const name = ug ? ug[1] : e.location;
        const region = PKHEX_REGION[v];
        const loc = locByName.get(`${region}:${norm(name)}`) ?? `${region}-${kebab(name)}`;
        const areaKey = `pk:${loc}:${ug?.[2] ?? ''}`;
        if (!areaTable.has(areaKey)) areaTable.set(areaKey, { loc, name, region, sub: ug?.[2] });
        const key = [sid, gameIndex.get(v), areaKey, e.method, e.conditions.join('|')].join('~');
        const cur = agg.get(key);
        if (cur) {
          cur.min = Math.min(cur.min, e.min);
          cur.max = Math.max(cur.max, e.max);
        } else agg.set(key, { species: sid, game: gameIndex.get(v)!, area: areaKey, method: e.method, conds: e.conditions, min: e.min, max: e.max, rate: 0 });
      }
    }

    // Compact tables: areas, methods and conditions are referenced by index.
    const areaKeys = [...new Set([...agg.values()].map((a) => a.area))];
    const areaIdx = new Map(areaKeys.map((k, i) => [k, i]));
    const methods = [...new Set([...agg.values()].map((a) => a.method))];
    const conditions = [...new Set([...agg.values()].flatMap((a) => a.conds))].sort();
    const encounters: Record<string, (number | number[])[][]> = {};
    for (const a of [...agg.values()].sort((x, y) => x.game - y.game || areaIdx.get(x.area)! - areaIdx.get(y.area)!)) {
      (encounters[a.species] ??= []).push([
        a.game,
        areaIdx.get(a.area)!,
        methods.indexOf(a.method),
        a.min,
        a.max,
        Math.min(100, a.rate),
        a.conds.map((c) => conditions.indexOf(c)),
      ]);
    }

    const out = {
      book: book.id,
      generation: gen,
      games,
      dexes,
      entries,
      areas: areaKeys.map((k) => areaTable.get(k)!),
      methods,
      conditions,
      encounters,
    };
    writeFileSync(resolve(OUT, `pokedex-${book.id}.json`), JSON.stringify(out));
    console.log(
      `wrote pokedex-${book.id}.json: ${Object.keys(entries).length} entries, ${dexes.map((d) => d.name).join(' / ')}, ` +
        `${Object.keys(encounters).length} species with wild encounters in ${areaKeys.length} areas`,
    );
  }
}

main();
