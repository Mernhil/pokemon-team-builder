/**
 * Pokédex data for the Champions book: src/data/generated/pokedex-champions.json + champions-learn.json.
 *
 * Pokémon Champions has no wild encounters (its Pokémon come from Poké Portal / transfer, not an
 * overworld) and isn't covered by PokeAPI, so unlike scripts/build-pokedex.ts this doesn't fetch
 * anything — it reuses the flavor text / genus / height already generated for Gen 9 (pokedex-gen9.json),
 * since those are keyed by National Dex number and describe the same species regardless of game,
 * filtered down to the species Champions actually has (src/data/generated/champions.json). There is no
 * level-up/TM/tutor/egg breakdown for Champions, so the learn file is left empty — the Pokédex UI falls
 * back to listing each species' full legal movepool from champions.json itself.
 *
 *   npm run pokedex:champions   (run after `npm run data` and `npm run pokedex`)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/data/generated');

// Minimal local shapes of what this reads/writes — kept in sync by hand with domain/pokedex.ts and
// the champions dataset, the way the other build scripts (which don't import from src/) do, since
// src/ compiles under a different module-resolution mode than scripts/.
interface PokedexEntry {
  heightm?: number;
  genus?: string;
  flavor?: { games: string[]; text: string }[];
  fallback?: { game: string; text: string };
}
interface PokedexData {
  generation: number;
  games: { id: string; name: string }[];
  dexes: { id: string; name: string }[];
  entries: Record<string, PokedexEntry>;
  areas: unknown[];
  methods: string[];
  conditions: string[];
  encounters: Record<string, unknown>;
}
interface LearnData {
  moveIndex: string[];
  learn: Record<string, [number, string][]>;
}
interface ChampionsDataset {
  species: Record<string, { num: number }>;
}

const champions = JSON.parse(readFileSync(resolve(OUT, 'champions.json'), 'utf8')) as ChampionsDataset;
const gen9 = JSON.parse(readFileSync(resolve(OUT, 'pokedex-gen9.json'), 'utf8')) as PokedexData;

const nums = new Set(Object.values(champions.species).map((s) => s.num));
const entries: PokedexData['entries'] = {};
for (const num of nums) {
  const entry = gen9.entries[num];
  if (entry) entries[num] = { heightm: entry.heightm, genus: entry.genus, flavor: entry.flavor, fallback: entry.fallback };
}

const pokedex: PokedexData = {
  generation: 9,
  games: [{ id: 'champions', name: 'Pokémon Champions' }],
  dexes: [],
  entries,
  areas: [],
  methods: [],
  conditions: [],
  encounters: {},
};
const learn: LearnData = { moveIndex: [], learn: {} };

writeFileSync(resolve(OUT, 'pokedex-champions.json'), JSON.stringify(pokedex));
writeFileSync(resolve(OUT, 'champions-learn.json'), JSON.stringify(learn));
console.log(`Wrote pokedex-champions.json (${Object.keys(entries).length}/${nums.size} National Dex entries matched) and champions-learn.json`);
