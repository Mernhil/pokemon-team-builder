/**
 * Helpers shared by the per-game atlas builders (scripts/atlas/<game>.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const OUT = resolve(ROOT, 'src/data/generated');
export const GAPS = resolve(ROOT, 'docs/data-gaps');


export const readJSON = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
export const lines = (f: string) => readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
/** SPECIES_MR_MIME → mrmime, ITEM_POKE_BALL → pokeball: the Showdown id of a decomp constant. */
export const cid = (c: string) => {
  const id = c.replace(/^(SPECIES|MOVE|ITEM|ABILITY)_/, '').replace(/_/g, '').toLowerCase();
  return DECOMP_ALIASES[id] ?? id;
};
/** Decomp constants that are spelled differently from Showdown's ids. */
const DECOMP_ALIASES: Record<string, string> = { faintattack: 'feintattack', hijumpkick: 'highjumpkick', smellingsalt: 'smellingsalts', vicegrip: 'visegrip' };
export const title = (s: string) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const spaced = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

export const NATURES = ['hardy', 'lonely', 'brave', 'adamant', 'naughty', 'bold', 'docile', 'relaxed', 'impish', 'lax', 'timid', 'hasty', 'serious', 'jolly', 'naive', 'modest', 'mild', 'quiet', 'bashful', 'rash', 'calm', 'gentle', 'sassy', 'careful', 'quirky'];
export const GENDER_RATIO: Record<string, number> = { FEMALE_12_5: 31, FEMALE_25: 63, FEMALE_50: 127, FEMALE_75: 191, FEMALE_ONLY: 254, MALE_ONLY: 0, NO_GENDER: 255 };

/** Text messages of a message bank with the game's control codes made readable. */
export function cleanText(parts: string | string[]): string {
  const raw = Array.isArray(parts) ? parts.join('') : parts;
  return raw
    .replace(/\{STRVAR_1 \d+, \d+, \d+\}/g, '[name]')
    .replace(/\{[^}]*\}/g, '')
    .replace(/\\[nr]|[\n\r]+(?=\S)/g, (m) => (m.includes('r') ? '\n' : ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}


/**
 * Why a trainer has no place on a map, in words ("Other trainers" in the Pokénav). `where` is what the
 * decompilation says about it, when it says anything (the script that fights it).
 */
function whyUnplaced(t: { id: string; name: string; cls?: string }, where?: string): string {
  if (/DUMMY/.test(t.id) || (/^(Mickey|Angelica|Tara & Tim)$/.test(t.name) && !where)) return 'Unused placeholder slot: it is in the game data but nothing ever fights it.';
  if (/UNUSED|DEBUG|TEST|PLACEHOLDER/.test(t.id)) return 'Unused in the game: its slot exists in the data but no map or script fights it.';
  if (where) return where;
  if (/BATTLEGROUND|FRONTIER|TOWER|FACTORY|ARCADE|CASTLE|HALL|PALACE|PIKE|PYRAMID|ARENA|COLOSSEUM|LINK|WIRELESS/.test(t.id)) return 'Battle facility or link battle: it has no overworld map.';
  return 'No map or script in the decompilation fights it (unused, or fought through a path the data does not show).';
}

/** `{ id: why }` for every unplaced trainer id. */
export function otherTrainersOf(trainers: Record<string, { id: string; name: string; cls?: string }>, unplaced: string[], where: (id: string) => string | undefined = () => undefined): Record<string, string> {
  return Object.fromEntries(unplaced.map((id) => [id, whyUnplaced(trainers[id], where(id))]));
}

/**
 * The Town Map lists a sea route apart from the land route of the same number (Sinnoh's routes 220, 223,
 * 226 and 230; Kanto's 19 to 21), but the game has one map for both. The sea route gets no data of its
 * own: `sameAs` points at the place that has it, so it isn't reported as missing and the Pokénav says so.
 * Returns the ids linked.
 */
export function linkSeaRoutes(locations: Record<string, { id: string; maps: string[]; sameAs?: string }>): string[] {
  const out: string[] = [];
  for (const loc of Object.values(locations)) {
    const m = /^(.*)-sea-route-(\d+)$/.exec(loc.id);
    if (!m || loc.maps.length) continue;
    const twin = locations[`${m[1]}-route-${m[2]}`];
    if (twin?.maps.length) {
      loc.sameAs = twin.id;
      out.push(loc.id);
    }
  }
  return out;
}

/** The Pokédex book and game id whose encounter tables belong to a builder's game. */
const ENCOUNTER_BOOKS: Record<string, { book: string; game: string }> = {
  red: { book: 'gen1', game: 'red' }, yellow: { book: 'gen1', game: 'yellow' },
  gold: { book: 'gen2', game: 'gold' }, crystal: { book: 'gen2', game: 'crystal' },
  ruby: { book: 'gen3', game: 'ruby' }, emerald: { book: 'gen3', game: 'emerald' }, firered: { book: 'gen3', game: 'firered' },
  diamond: { book: 'gen4', game: 'diamond' }, platinum: { book: 'gen4', game: 'platinum' }, heartgold: { book: 'gen4', game: 'heartgold' },
};

/**
 * Wild-encounter places that have no map in the game (roaming Pokémon, Emerald's Terra Cave and Marine
 * Cave, Navel Rock, Birth Island, HeartGold's region-wide tables…) still have encounters in the Pokédex, so
 * the atlas lists them too: no map pin, just the place and its wild tab. Returns the ids added.
 */
export function addOffMapEncounterPlaces(file: { locations: Record<string, unknown> }, gameId: string): string[] {
  const cfg = ENCOUNTER_BOOKS[gameId];
  if (!cfg) return [];
  const dex = readJSON<{ games: { id: string }[]; areas: { loc: string; name: string }[]; encounters: Record<string, number[][]> }>(resolve(OUT, `pokedex-${cfg.book}.json`));
  const gi = dex.games.findIndex((g) => g.id === cfg.game);
  const added: string[] = [];
  const names = new Map(dex.areas.map((a) => [a.loc, a.name]));
  const wanted = new Set<string>();
  for (const rows of Object.values(dex.encounters)) for (const r of rows) if (r[0] === gi) wanted.add(dex.areas[r[1]].loc);
  for (const loc of [...wanted].sort()) {
    if (file.locations[loc]) continue;
    // pokecenters and marts the Pokédex files under their own name are building lists, not places
    const roaming = /^roaming-/.test(loc);
    const nice = roaming ? `Roaming Pokémon (${title(loc.replace(/^roaming-/, ''))})` : names.get(loc) ?? title(loc.replace(/^(johto|kanto|hoenn|sinnoh|unknown)-/, ''));
    file.locations[loc] = {
      id: loc, name: nice, kind: roaming ? 'roaming' : 'landmark', maps: [], connections: [], pokecenter: false, shops: [], obstacles: [], items: [], npcs: [], trainers: [],
      events: [roaming ? 'These Pokémon roam the whole region: they move to another route each time you change area, so there is no fixed place to look.' : 'This place has wild Pokémon but no map of its own in the game data (an event area or a region-wide table).'],
    };
    added.push(loc);
  }
  return added;
}
