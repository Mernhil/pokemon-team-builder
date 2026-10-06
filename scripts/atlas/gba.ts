/**
 * Gen 3 atlases (Emerald, FireRed / LeafGreen), from the pret/pokeemerald and pret/pokefirered decompilations,
 * which share one engine and data layout:
 *   src/data/trainers.h + trainer_parties.h   trainer classes, names, parties (levels, items, explicit moves)
 *   src/data/pokemon/*                        species types, abilities, gender ratios, level-up learnsets
 *   src/battle_main.c                         how the game derives a trainer mon's personality → nature, ability, gender
 *   src/battle_setup.c                        the rematch table
 *   data/maps/<Map>/map.json + scripts.inc    per-map NPC / trainer / item-ball / hidden-item placements, dialogue, marts
 *   data/scripts/item_ball_scripts.inc        what each item ball holds
 *   src/data/items.h, text/item_descriptions.h item names, prices, descriptions; include/constants/tms_hms.h TM/HM moves
 * Every map names the region-map section it belongs to, which is how it lands on a Town Map place.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Dex } from '@pkmn/dex';
import type { AtlasFile, AtlasGym, AtlasItemInfo, AtlasLocation, AtlasMon, AtlasNpc, AtlasShop, AtlasTrainer, LocationKind, TrainerKind } from '../../src/domain/atlasTypes.ts';
import { ensure } from '../sources.ts';
import { NATURES, OUT, cid, cleanText, otherTrainersOf, readJSON, spaced, title } from './common.ts';

interface GbaConfig {
  game: string;
  name: string;
  repo: 'pokeemerald' | 'pokefirered' | 'pokeruby';
  url: string;
  commit: string;
  /** PokeAPI region prefix of place ids ("hoenn-route-104"). */
  prefix: string;
  /** maps.json map ids whose places are this game's locations. */
  mapIds: string[];
  dexGame: string;
  badges: string[];
  /** Region-map section → place id, where the kebab-case rule doesn't apply. */
  aliases: Record<string, string>;
  /** Extra text at the top of the gaps report. */
  note: string;
}
const read = (dir: string, f: string) => readFileSync(resolve(dir, f), 'utf8');

/** Hoenn region-map sections whose PokeAPI place id isn't the obvious kebab-case. */
const HOENN_ALIASES: Record<string, string> = {
  MAPSEC_SAFARI_ZONE: 'hoenn-safari-zone',
  MAPSEC_BATTLE_FRONTIER: 'hoenn-battle-frontier',
  MAPSEC_VICTORY_ROAD: 'hoenn-victory-road',
  MAPSEC_UNDERWATER_105: 'underwater-105',
  MAPSEC_UNDERWATER_124: 'hoenn-route-124',
  MAPSEC_UNDERWATER_125: 'underwater-125',
  MAPSEC_UNDERWATER_126: 'hoenn-route-126',
  MAPSEC_UNDERWATER_127: 'hoenn-route-127',
  MAPSEC_UNDERWATER_128: 'hoenn-route-128',
  MAPSEC_UNDERWATER_129: 'underwater-129',
  MAPSEC_UNDERWATER_SOOTOPOLIS: 'sootopolis-city',
  MAPSEC_UNDERWATER_SEALED_CHAMBER: 'underwater-sealed-chamber',
  MAPSEC_AQUA_HIDEOUT: 'team-aqua-hideout',
  MAPSEC_MAGMA_HIDEOUT: 'team-magma-hideout',
  MAPSEC_AQUA_HIDEOUT_OLD: 'aqua-hideout-old',
  MAPSEC_NEW_MAUVILLE: 'new-mauville',
  MAPSEC_SKY_PILLAR: 'sky-pillar',
  MAPSEC_TRAINER_HILL: 'trainer-hill',
  MAPSEC_ALTERING_CAVE: 'hoenn-altering-cave',
  MAPSEC_ARTISAN_CAVE: 'artisan-cave',
  MAPSEC_MT_CHIMNEY: 'mt-chimney',
  MAPSEC_MT_PYRE: 'mt-pyre',
  MAPSEC_MT_PYRE_EXTERIOR: 'mt-pyre',
  MAPSEC_MT_PYRE_SUMMIT: 'mt-pyre',
};

interface Kv {
  [k: string]: string;
}

/** The body of the `{…}` block that starts at `open` (brace-matched). */
function block(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

function fields(body: string): Kv {
  const out: Kv = {};
  // `.name = value,` where value may hold braces / parentheses
  const re = /\.(\w+)\s*=\s*((?:[^,{}()]|\([^)]*\)|\{[^}]*\})+)(?:,|$)/g;
  for (const m of body.matchAll(re)) out[m[1]] = m[2].trim();
  return out;
}

const KANTO_ALIASES: Record<string, string> = {
  MAPSEC_SAFARI_ZONE: 'kanto-safari-zone',
  MAPSEC_POWER_PLANT: 'kanto-power-plant',
  MAPSEC_VICTORY_ROAD: 'kanto-victory-road-1',
  MAPSEC_ROUTE_19: 'kanto-sea-route-19',
  MAPSEC_ROUTE_20: 'kanto-sea-route-20',
  MAPSEC_ROUTE_21: 'kanto-sea-route-21',
  MAPSEC_ROUTE_21_NORTH: 'kanto-sea-route-21',
  MAPSEC_ROUTE_21_SOUTH: 'kanto-sea-route-21',
  MAPSEC_ROCKET_HIDEOUT: 'celadon-city',
  MAPSEC_SILPH_CO: 'saffron-city',
  MAPSEC_POKEMON_LEAGUE: 'indigo-plateau',
  MAPSEC_CERULEAN_CAVE: 'cerulean-cave',
  MAPSEC_ALTERING_CAVE: 'kanto-altering-cave',
  MAPSEC_S_S_ANNE: 'ss-anne',
  MAPSEC_KANTO_VICTORY_ROAD: 'kanto-victory-road-1',
  MAPSEC_TRAINER_TOWER_2: 'trainer-tower',
  MAPSEC_UNDERGROUND_PATH_2: 'kanto-underground-path',
  MAPSEC_EMBER_SPA: 'kindle-road',
  MAPSEC_ROCKET_WAREHOUSE: 'five-island',
  MAPSEC_VIAPOIS_CHAMBER: 'viapos-chamber',
};

const EMERALD: GbaConfig = {
  game: 'emerald', name: 'Pokémon Emerald', repo: 'pokeemerald', url: 'pret/pokeemerald', commit: 'c925b8482d05fb882d6b64e523653cae599e025f',
  prefix: 'hoenn', mapIds: ['hoenn-rse'], dexGame: 'emerald', badges: ['Stone', 'Knuckle', 'Dynamo', 'Heat', 'Balance', 'Feather', 'Mind', 'Rain'],
  aliases: HOENN_ALIASES,
  note: "Ruby and Sapphire share Hoenn's map and most of its data; their own differences (version exclusives, trainer teams) are not in this file.",
};
const FIRERED: GbaConfig = {
  game: 'firered', name: 'Pokémon FireRed', repo: 'pokefirered', url: 'pret/pokefirered', commit: '037335f4c725d7c9aecdac87066f2002b4bd7e14',
  prefix: 'kanto', mapIds: ['kanto-frlg', 'sevii-123', 'sevii-45', 'sevii-67'], dexGame: 'firered', badges: ['Boulder', 'Cascade', 'Thunder', 'Rainbow', 'Soul', 'Marsh', 'Volcano', 'Earth'],
  aliases: KANTO_ALIASES,
  note: 'LeafGreen uses this file too: the decompilation builds both from shared data, and only the `#if defined(LEAFGREEN)` differences (wild Pokémon, a few gift and shop items) are not applied.',
};

export const buildEmerald = () => buildGba(EMERALD);
const RUBY: GbaConfig = {
  game: 'ruby', name: 'Pokémon Ruby', repo: 'pokeruby', url: 'pret/pokeruby', commit: '5784633ce4ef7ade1a7f2d2d0c288e3d5e6cdd7f',
  prefix: 'hoenn', mapIds: ['hoenn-rse'], dexGame: 'ruby', badges: ['Stone', 'Knuckle', 'Dynamo', 'Heat', 'Balance', 'Feather', 'Mind', 'Rain'],
  aliases: HOENN_ALIASES,
  note: 'Sapphire uses this file too: the decompilation builds both from shared data, and only the `#ifdef SAPPHIRE` differences (version exclusives, Team Aqua / Magma roles) are not applied.',
};
export const buildFireRed = () => buildGba(FIRERED);
export const buildRuby = () => buildGba(RUBY);

function buildGba(cfg: GbaConfig): { file: AtlasFile; gaps: string } {
  const COMMIT = cfg.commit;
  const BADGES = cfg.badges;
  const SECTION_ALIASES = cfg.aliases;
  const dir = ensure(cfg.repo, cfg.repo === 'pokeruby' ? ['data', 'src', 'include', 'charmap.txt', 'constants'] : ['data', 'src', 'include', 'charmap.txt']);
  const gen3 = Dex.forGen(3);
  const allMaps = readJSON<{ maps: Record<string, { places: Record<string, unknown> }> }>(resolve(OUT, 'maps.json')).maps;
  const placeIds = new Set(cfg.mapIds.flatMap((m) => Object.keys(allMaps[m].places)));
  const pokedex = readJSON<{ games: { id: string }[]; areas: { loc: string; name: string }[]; encounters: Record<string, number[][]> }>(resolve(OUT, 'pokedex-gen3.json'));
  const areaName = new Map(pokedex.areas.map((a) => [a.loc, a.name]));

  // --- character codes (for the game's name hash) ---------------------------------------------
  const charBytes = new Map<string, number>();
  for (const l of read(dir, 'charmap.txt').split('\n')) {
    const m = /^'(.+)'\s*=\s*([0-9A-Fa-f ]+)/.exec(l.trim());
    if (m) charBytes.set(m[1], [...m[2].trim().split(/\s+/)].reduce((s, h) => s + parseInt(h, 16), 0));
  }
  const nameSum = (name: string) => [...name].reduce((s, ch) => s + (charBytes.get(ch) ?? 0), 0);

  // --- species data ----------------------------------------------------------------------------
  const pick = (...rel: string[]) => rel.find((r) => existsSync(resolve(dir, r))) ?? rel[0];
  const speciesText = read(dir, pick('src/data/text/species_names.h', 'src/data/text/species_names_en.h'));
  const speciesName = new Map([...speciesText.matchAll(/\[(SPECIES_\w+)\]\s*=\s*_\("([^"]*)"\)/g)].map((m) => [m[1], m[2]]));
  const infoSrc = read(dir, pick('src/data/pokemon/species_info.h', 'src/data/pokemon/base_stats.h'));
  const info = new Map<string, { types: string[]; ratio: number; abilities: string[] }>();
  for (const m of infoSrc.matchAll(/\[(SPECIES_\w+)\]\s*=\s*\{/g)) {
    const body = block(infoSrc, m.index! + m[0].length - 1);
    const types = /\.types\s*=\s*\{\s*(TYPE_\w+)\s*,\s*(TYPE_\w+)/.exec(body) ?? /\.type1\s*=\s*(TYPE_\w+)\s*,\s*\.type2\s*=\s*(TYPE_\w+)/.exec(body);
    const gr = /\.genderRatio\s*=\s*([^,]+),/.exec(body)?.[1].trim() ?? '127';
    const ratio = /MON_GENDERLESS/.test(gr) ? 255 : /MON_FEMALE/.test(gr) ? 254 : /MON_MALE/.test(gr) ? 0 : (() => {
      const p = /PERCENT_FEMALE\(([\d.]+)\)/.exec(gr);
      return p ? Math.min(254, Math.floor((Number(p[1]) * 255) / 100)) : 127;
    })();
    const ab = /\.abilities\s*=\s*\{\s*(ABILITY_\w+)\s*,\s*(ABILITY_\w+)/.exec(body) ?? /\.ability1\s*=\s*(ABILITY_\w+)\s*,[^]*?\.ability2\s*=\s*(ABILITY_\w+)/.exec(body);
    if (types) info.set(m[1], { types: [...new Set([types[1], types[2]])], ratio, abilities: ab ? [ab[1], ab[2]] : ['ABILITY_NONE', 'ABILITY_NONE'] });
  }
  const learnPtr = new Map([...read(dir, 'src/data/pokemon/level_up_learnset_pointers.h').matchAll(/\[(SPECIES_\w+)\]\s*=\s*(\w+)/g)].map((m) => [m[1], m[2]]));
  const learnsets = new Map<string, [number, string][]>();
  for (const m of read(dir, 'src/data/pokemon/level_up_learnsets.h').matchAll(/(\w+)\[\]\s*=\s*\{([^}]*)\}/g))
    learnsets.set(m[1], [...m[2].matchAll(/LEVEL_UP_MOVE\(\s*(\d+),\s*(MOVE_\w+)\)/g)].map((x) => [Number(x[1]), x[2]]));
  const learnOf = (species: string) => learnsets.get(learnPtr.get(species) ?? '') ?? [];

  // --- items -----------------------------------------------------------------------------------
  const descText = new Map<string, string>();
  for (const dp of ['src/data/text/item_descriptions.h', 'src/data/item_descriptions_en.h'].filter((x) => existsSync(resolve(dir, x))))
  for (const m of read(dir, dp).matchAll(/(\w+)\[\]\s*=\s*_\(([^;]*?)\);/gs))
    descText.set(m[1], [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join('').replace(/\\n/g, ' '));
  // TM / HM moves: `#define ITEM_TM01_FOCUS_PUNCH ITEM_TM01` (FireRed) or the FOREACH_TM list (Emerald)
  const constItems = read(dir, 'include/constants/items.h');
  const tmByNumber = new Map<string, string>();
  for (const m of constItems.matchAll(/#define ITEM_(TM|HM)(\d+)_(\w+)/g)) tmByNumber.set(`${m[1]}${Number(m[2])}`, `MOVE_${m[3]}`);
  if (!tmByNumber.size && existsSync(resolve(dir, 'include/constants/tms_hms.h'))) {
    const tmsSrc = read(dir, 'include/constants/tms_hms.h');
    const tms = [...tmsSrc.split('FOREACH_HM')[0].matchAll(/F\((\w+)\)/g)].map((m) => `MOVE_${m[1]}`);
    const hms = [...(tmsSrc.split('FOREACH_HM')[1] ?? '').matchAll(/F\((\w+)\)/g)].map((m) => `MOVE_${m[1]}`);
    tms.forEach((mv, i) => tmByNumber.set(`TM${i + 1}`, mv));
    hms.forEach((mv, i) => tmByNumber.set(`HM${i + 1}`, mv));
  }
  const items: Record<string, AtlasItemInfo> = {};
  /** TMs and HMs are keyed tm01 / hm01 (their constants carry the move: ITEM_TM01_FOCUS_PUNCH). */
  const itemId = (c: string) => {
    const t = /^ITEM_(TM|HM)(\d+)/.exec(c);
    return t ? `${t[1].toLowerCase()}${t[2]}` : cid(c);
  };
  interface RawItem { c: string; name: string; price: number; description: string; pocket: string }
  const rawItems: RawItem[] = [];
  const itemsFile = pick('src/data/items.h', 'src/data/items_en.h');
  if (existsSync(resolve(dir, itemsFile))) {
    const itemsSrc = read(dir, itemsFile);
    const push = (c: string, f: Kv) => rawItems.push({ c, name: /_\("([^"]*)"\)/.exec(f.name ?? '')?.[1] ?? c, price: Number(f.price ?? 0), description: (f.description && descText.get(f.description)) || '', pocket: (f.pocket ?? '').replace('POCKET_', '').toLowerCase() });
    const keyed = [...itemsSrc.matchAll(/\[(ITEM_\w+)\]\s*=\s*\{/g)];
    if (keyed.length) for (const m of keyed) push(m[1], fields(block(itemsSrc, m.index! + m[0].length - 1)));
    // Ruby: positional entries, each carrying its own .itemId
    else for (const m of itemsSrc.matchAll(/\{\s*\.name\s*=/g)) { const f = fields(block(itemsSrc, m.index!)); if (f.itemId) push(f.itemId, f); }
  } else {
    // FireRed: src/data/items.json
    for (const it of readJSON<{ items: { english: string; itemId: string; price: number; description_english: string | string[]; pocket: string }[] }>(resolve(dir, 'src/data/items.json')).items)
      rawItems.push({ c: it.itemId, name: it.english, price: it.price, description: Array.isArray(it.description_english) ? it.description_english.join(' ') : String(it.description_english ?? '').replace(/\\n/g, ' '), pocket: it.pocket.replace('POCKET_', '').toLowerCase() });
  }
  for (const r of rawItems) {
    if (r.c === 'ITEM_NONE' || /^\?+$/.test(r.name)) continue; // unused slots
    const pretty = title(r.name.toLowerCase().replace(/pok[eé]mon/g, 'Pokémon')).replace(/Pokémon/g, 'Pokémon');
    const tm = /^ITEM_(TM|HM)(\d+)/.exec(r.c);
    const moveConst = tm ? tmByNumber.get(`${tm[1]}${Number(tm[2])}`) : undefined;
    const moveId = moveConst ? cid(moveConst) : undefined;
    items[itemId(r.c)] = {
      name: tm ? `${tm[1]}${tm[2]}` : pretty, price: r.price, description: r.description.replace(/\s+/g, ' ').trim(), pocket: r.pocket,
      ...(moveId ? { move: moveId, moveType: gen3.moves.get(moveId).type } : {}),
    };
  }

  // --- scripts (all labels in one table) + text -----------------------------------------------
  const labels = new Map<string, string[]>();
  const texts = new Map<string, string>();
  const mapDirsAll = readdirSync(resolve(dir, 'data/maps')).filter((d) => existsSync(resolve(dir, 'data/maps', d, 'map.json')));
  const incFiles = (rel: string) => (existsSync(resolve(dir, rel)) ? readdirSync(resolve(dir, rel)).map((x) => `${rel}/${x}`) : []);
  for (const f of [...mapDirsAll.flatMap((d) => incFiles(`data/maps/${d}`)), ...incFiles('data/scripts'), ...incFiles('data/text'), ...incFiles('data').filter((x) => !x.endsWith('/'))]) {
    if (!f.endsWith('.inc')) continue;
    let cur: string[] | undefined;
    let curText: string[] | undefined;
    let curLabel = '';
    for (const raw of read(dir, f).split('\n')) {
      const l = raw.replace(/@.*$/, '').trim();
      if (!l) continue;
      const lab = /^(\w+)::?$/.exec(l);
      if (lab) {
        curLabel = lab[1];
        labels.set(curLabel, (cur = []));
        curText = undefined;
        continue;
      }
      const str = /^\.string\s+"((?:[^"\\]|\\.)*)"/.exec(l);
      if (str) {
        curText = curText ?? [];
        curText.push(str[1]);
        texts.set(curLabel, curText.join(''));
        continue;
      }
      cur?.push(l);
    }
  }
  const dialog = (s: string) =>
    cleanText(
      s
        .replace(/\$$/, '')
        .replace(/\\p/g, '\n')
        .replace(/\\[nl]/g, ' ')
        .replace(/\{PLAYER\}/g, '[name]')
        .replace(/\{RIVAL\}/g, '[rival]')
        .replace(/\{STR_VAR_\d\}/g, '…')
        .replace(/\{[A-Z_0-9 ]+\}/g, ''),
    );
  /** Labels reachable from `start` through goto / call / branch commands. */
  const reach = (start: string, limit = 30): string[] => {
    const seen: string[] = [];
    const queue = [start];
    while (queue.length && seen.length < limit) {
      const l = queue.shift()!;
      if (seen.includes(l) || !labels.has(l)) continue;
      seen.push(l);
      for (const line of labels.get(l)!) {
        const m = /^(?:goto|call)(?:_if_\w+)?\s+(?:[^,]+,\s*){0,2}(\w+)$/.exec(line) ?? /^(?:goto|call)\s+(\w+)$/.exec(line);
        if (m) queue.push(m[1]);
      }
    }
    return seen;
  };

  // --- trainers --------------------------------------------------------------------------------
  const classNames = new Map<string, string>();
  const classText = read(dir, pick('src/data/text/trainer_class_names.h', 'src/data/text/trainer_class_names_en.h'));
  const prettyClass = (n: string) => title(n.replace(/\{PKMN\}/g, 'Pokémon').toLowerCase());
  for (const m of classText.matchAll(/\[(TRAINER_CLASS_\w+)\]\s*=\s*_\("([^"]*)"\)/g)) classNames.set(m[1], prettyClass(m[2]));
  if (!classNames.size) {
    // Ruby: a positional array, in the order of the TRAINER_CLASS enum
    const order = [...(/enum[^{]*\{([^}]*TRAINER_CLASS_[^}]*)\}/.exec(read(dir, 'include/constants/trainers.h'))?.[1] ?? '').matchAll(/TRAINER_CLASS_\w+/g)].map((x) => x[0]);
    [...classText.matchAll(/_\("([^"]*)"\)/g)].forEach((m, i) => order[i] && classNames.set(order[i], prettyClass(m[1])));
  }
  const partySrc = read(dir, 'src/data/trainer_parties.h');
  interface RawMon { iv: number; lvl: number; species: string; heldItem?: string; moves?: string[] }
  const parties = new Map<string, RawMon[]>();
  for (const m of partySrc.matchAll(/((?:sParty|gTrainerParty)_\w+)\[\]\s*=\s*\{/g)) {
    const body = block(partySrc, m.index! + m[0].length - 1);
    const mons: RawMon[] = [];
    for (const b of body.matchAll(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
      const f = fields(b[1]);
      if (!f.species) continue;
      mons.push({
        iv: Number(f.iv), lvl: Number(f.lvl ?? f.level), species: f.species,
        ...(f.heldItem && f.heldItem !== 'ITEM_NONE' ? { heldItem: f.heldItem } : {}),
        ...(f.moves ? { moves: [...f.moves.matchAll(/MOVE_\w+/g)].map((x) => x[0]).filter((x) => x !== 'MOVE_NONE') } : {}),
      });
    }
    parties.set(m[1], mons);
  }
  const trainersSrc = read(dir, pick('src/data/trainers.h', 'src/data/trainers_en.h'));
  const trainerOrder: string[] = [];
  const trainers: Record<string, AtlasTrainer> = {};
  const unverified: Record<string, string[]> = {};
  const unknownSpecies = new Set<string>();
  const rematchOf = new Map<string, { base: string; n: number }>();
  // Emerald: REMATCH(T1, T2, …, MAP) in battle_setup.c; FireRed: { {T1, T2, SKIP, T3}, MAP(..) } in vs_seeker.c
  const rematchSrc = existsSync(resolve(dir, 'src/vs_seeker.c')) ? read(dir, 'src/vs_seeker.c') : read(dir, 'src/battle_setup.c');
  const eyeGroups = [...rematchSrc.matchAll(/\{\s*\{(TRAINER_[^{}]*)\}\s*,\s*MAP_GROUP/g)].map((m) => m[1]);
  const groups = [...rematchSrc.matchAll(/REMATCH\(([^)]*)\)/g)].map((m) => m[1]).concat(eyeGroups).concat([...rematchSrc.matchAll(/\{\s*\{([^{}]*TRAINER_[^{}]*)\}\s*,\s*MAP\(/g)].map((m) => m[1]));
  for (const g of groups) {
    const ids = [...g.matchAll(/TRAINER_\w+/g)].map((x) => x[0]);
    let n = 0;
    for (const id of ids) if (id !== ids[0] && !rematchOf.has(id)) rematchOf.set(id, { base: ids[0], n: ++n });
  }
  const trainerIds = [...trainersSrc.matchAll(/\[(TRAINER_\w+)\]\s*=\s*\{/g)].map((m) => m[1]);
  const kindFor = (cls: string): TrainerKind =>
    cls === 'TRAINER_CLASS_LEADER' ? 'leader' : cls === 'TRAINER_CLASS_ELITE_FOUR' ? 'elite-four' : cls === 'TRAINER_CLASS_CHAMPION' ? 'champion' : cls === 'TRAINER_CLASS_RIVAL' ? 'rival' : /TEAM_AQUA|TEAM_MAGMA|AQUA_ADMIN|AQUA_LEADER|MAGMA_ADMIN|MAGMA_LEADER|ROCKET/.test(cls) ? 'boss' : 'trainer';
  for (const m of trainersSrc.matchAll(/\[(TRAINER_\w+)\]\s*=\s*\{/g)) {
    const tid = m[1];
    if (tid === 'TRAINER_NONE' || tid === 'TRAINER_SECRET_BASE') continue;
    const body = block(trainersSrc, m.index! + m[0].length - 1);
    const f = fields(body);
    const partyMacro = /(NO_ITEM_DEFAULT_MOVES|NO_ITEM_CUSTOM_MOVES|ITEM_DEFAULT_MOVES|ITEM_CUSTOM_MOVES)\(((?:sParty|gTrainerParty)_\w+)\)/.exec(body) ?? (/\.party\s*=\s*\{\s*\.\w+\s*=\s*(gTrainerParty_\w+)/.exec(body) ? [, '', /\.party\s*=\s*\{\s*\.\w+\s*=\s*(gTrainerParty_\w+)/.exec(body)![1]] : null);
    if (!partyMacro) continue;
    const raw = parties.get(partyMacro[2]) ?? [];
    if (!raw.length) continue;
    const name = /_\("([^"]*)"\)/.exec(f.trainerName ?? '')?.[1] ?? tid;
    const female = /F_TRAINER_FEMALE/.test(f.encounterMusic_gender ?? '');
    const double = f.doubleBattle === 'TRUE';
    let nameHash = 0; // accumulates across the whole party, exactly as CreateNPCTrainerParty does
    const party: AtlasMon[] = raw.map((p) => {
      const sp = info.get(p.species);
      const spName = speciesName.get(p.species) ?? '';
      nameHash = (nameHash + nameSum(name) + nameSum(spName)) >>> 0;
      const pid = ((double ? 0x80 : female ? 0x78 : 0x88) + ((nameHash << 8) >>> 0)) >>> 0;
      const mon: AtlasMon = { species: cid(p.species), level: p.lvl, iv: Math.floor((p.iv * 31) / 255), moves: [] };
      if (p.heldItem) mon.item = itemId(p.heldItem);
      if (p.moves) mon.moves = p.moves.map(cid);
      else {
        // The game gives the most recent four level-up moves at this level.
        const learned: string[] = [];
        for (const [lv, mv] of learnOf(p.species)) if (lv <= p.lvl && !learned.includes(mv)) learned.push(mv);
        mon.moves = learned.slice(-4).map(cid);
        mon.movesDerived = true;
      }
      if (sp) {
        mon.nature = NATURES[pid % 25];
        const [a1, a2] = sp.abilities;
        const ab = a2 !== 'ABILITY_NONE' ? (pid & 1 ? a2 : a1) : a1;
        if (ab !== 'ABILITY_NONE') mon.ability = cid(ab);
        mon.gender = sp.ratio === 255 ? 'N' : sp.ratio === 254 ? 'F' : sp.ratio === 0 ? 'M' : (pid & 0xff) >= sp.ratio ? 'M' : 'F';
      } else unknownSpecies.add(p.species);
      return mon;
    });
    const rm = rematchOf.get(tid);
    const cls = f.trainerClass ?? '';
    const bag = [...(f.items ?? '').matchAll(/ITEM_\w+/g)].map((x) => itemId(x[0])).filter((x) => x !== 'none');
    trainers[tid] = {
      id: tid, name: title(name.toLowerCase()), cls: classNames.get(cls) ?? title(cls.replace('TRAINER_CLASS_', '').toLowerCase()),
      kind: kindFor(cls), party, group: rm ? rm.base : tid, order: rm ? rm.n : 0,
      ...(double ? { double: true } : {}),
      ...(bag.length ? { bag } : {}),
      ...(rm ? { variant: `Rematch ${rm.n}` } : {}),
    };
    trainerOrder.push(tid);
  }
  for (const s of unknownSpecies) (unverified['species'] ??= []).push(`${s}: no species data`);

  // --- map pass --------------------------------------------------------------------------------
  const locations: Record<string, AtlasLocation> = {};
  const kindOf = (id: string): LocationKind =>
    /island$|-island-|-isle/.test(id) && !/cave|tunnel/.test(id) ? 'town' : /route/.test(id) ? (/underwater|sea/.test(id) ? 'sea-route' : 'route') : /-city$/.test(id) ? 'city' : /-town$/.test(id) ? 'town' : /cave|tunnel|tomb|hideout|cavern|pillar|ruins|chamber|tower|ship|mt-|meteor|passage|jagged|fiery|victory|safari|woods|tunnel/.test(id) ? 'cave' : 'landmark';
  for (const id of placeIds)
    locations[id] = { id, name: areaName.get(id) ?? title(id.replace(new RegExp(`^${cfg.prefix}-`), '')), kind: kindOf(id), maps: [], connections: [], pokecenter: false, shops: [], obstacles: [], items: [], npcs: [], trainers: [], events: [] };
  const sectionPlace = (sec: string): string | undefined => {
    if (SECTION_ALIASES[sec]) return placeIds.has(SECTION_ALIASES[sec]) ? SECTION_ALIASES[sec] : undefined;
    const k = sec.replace('MAPSEC_', '').toLowerCase().replace(/_/g, '-');
    return [k, `${cfg.prefix}-${k}`, `${cfg.prefix}-sea-${k}`].find((c) => placeIds.has(c));
  };
  const OBSTACLE_GFX: Record<string, string> = { OBJ_EVENT_GFX_CUTTABLE_TREE: 'Cut', OBJ_EVENT_GFX_CUT_TREE: 'Cut', OBJ_EVENT_GFX_BREAKABLE_ROCK: 'Rock Smash', OBJ_EVENT_GFX_ROCK_SMASH_ROCK: 'Rock Smash', OBJ_EVENT_GFX_PUSHABLE_BOULDER: 'Strength' };
  const SIGN_TYPES = new Set(['sign', 'secret_base']);
  const trainerPlace = new Map<string, { place: string; sub?: string }>();
  // Ruby and Sapphire's scripts name a trainer by where it stands (TRAINER_HIDEOUT_1F_GRUNT); constants/version.inc
  // says which entry of the trainer table that is (the Ruby side of each `.ifdef SAPPHIRE`).
  const trainerAlias = new Map<string, string[]>();
  if (cfg.repo === 'pokeruby' && existsSync(resolve(dir, 'constants/version.inc'))) {
    for (const raw of read(dir, 'constants/version.inc').split('\n')) {
      const m = /^\.set\s+(TRAINER_\w+),\s*(TRAINER_\w+)/.exec(raw.trim());
      // both versions' entries: the file serves Ruby and Sapphire, and a trainer of either stands where its script is
      if (m) trainerAlias.set(m[1], [...(trainerAlias.get(m[1]) ?? []), m[2]]);
    }
  }
  const trainerRefs = (name: string): string[] => trainerAlias.get(name) ?? [name];
  const place3 = (name: string, place: string, sub?: string) => {
    for (const ref of trainerRefs(name)) if (trainers[ref] && !trainerPlace.has(ref)) trainerPlace.set(ref, { place, sub });
  };
  const unmappedSections = new Map<string, string[]>();
  const connectionsRaw = new Map<string, Set<string>>();
  const mapPlace = new Map<string, string>();
  const badgeOf = new Map<string, string>();
  let npcTotal = 0;
  let npcWithText = 0;

  const mapDirs = mapDirsAll;
  const mapJson = new Map(mapDirs.map((d) => [d, readJSON<{ id: string; region_map_section?: string; object_events?: { graphics_id: string; x: number; y: number; script: string; trainer_type: string; flag: string }[]; bg_events?: { type: string; x: number; y: number; item?: string; script?: string }[]; warp_events?: { dest_map: string }[] }>(resolve(dir, 'data/maps', d, 'map.json'))]));
  for (const [d, mj] of mapJson) {
    if (!mj.region_map_section) continue;
    // Ruby and Sapphire share one section for both teams' hideouts; each team's maps belong to its own place.
    const p = cfg.repo === 'pokeruby' && mj.region_map_section === 'MAPSEC_EVIL_TEAM_HIDEOUT' ? (/^Aqua/.test(d) ? 'team-aqua-hideout' : 'team-magma-hideout') : sectionPlace(mj.region_map_section);
    if (p) mapPlace.set(mj.id, p);
  }

  for (const [d, mj] of mapJson) {
    const sec = mj.region_map_section;
    const place = mapPlace.get(mj.id);
    if (!sec || !place) {
      (unmappedSections.get(sec ?? '(none)') ?? unmappedSections.set(sec ?? '(none)', []).get(sec ?? '(none)')!).push(d);
      continue;
    }
    const loc = locations[place];
    loc.maps.push(d);
    if (/PokemonCenter_1F$/.test(d)) loc.pokecenter = true;
    const base = place.replace(new RegExp(`^${cfg.prefix}-`), '').replace(/-/g, '');
    const sub = d.toLowerCase().startsWith(base) && d.length > base.length ? title(spaced(d.slice(base.length).replace(/^_/, '')).toLowerCase()) : undefined;
    for (const w of mj.warp_events ?? []) (connectionsRaw.get(place) ?? connectionsRaw.set(place, new Set()).get(place)!).add(w.dest_map);

    for (const b of mj.bg_events ?? []) {
      if (b.type === 'hidden_item' && b.item && items[itemId(b.item)]) {
        const id = itemId(b.item);
        loc.items.push({ item: id, qty: 1, how: 'hidden', where: `${sub ? `${sub}: ` : ''}buried at tile (${b.x}, ${b.y}); the Itemfinder points to it`, at: [b.x, b.y], respawns: false, ...(sub ? { sub } : {}) });
      }
    }
    for (const o of mj.object_events ?? []) {
      if (!o.script || !o.graphics_id) continue; // FireRed's "clone" objects have neither
      if (OBSTACLE_GFX[o.graphics_id]) {
        if (!loc.obstacles.includes(OBSTACLE_GFX[o.graphics_id])) loc.obstacles.push(OBSTACLE_GFX[o.graphics_id]);
        continue;
      }
      const body = reach(o.script).flatMap((l) => labels.get(l) ?? []);
      for (const line of body) for (const t of line.matchAll(/\bTRAINER_\w+/g)) place3(t[0], place, sub);
      if (o.graphics_id === 'OBJ_EVENT_GFX_ITEM_BALL') {
        const fi = body.map((l) => /^finditem\s+(ITEM_\w+)(?:,\s*(\d+))?/.exec(l)).find(Boolean);
        if (fi && items[itemId(fi[1])]) {
          const id = itemId(fi[1]);
          const tm = items[id]?.move;
          loc.items.push({ item: id, qty: Number(fi[2] ?? 1), how: tm ? (/^hm/.test(id) ? 'hm' : 'tm') : 'visible', where: `${sub ? `${sub}: ` : ''}on the ground at tile (${o.x}, ${o.y})`, at: [o.x, o.y], respawns: false, ...(sub ? { sub } : {}) });
        }
        continue;
      }
      if (o.trainer_type !== 'TRAINER_TYPE_NONE' && /trainerbattle/.test(body.join('\n'))) continue; // a trainer, listed under Trainers
      if (o.graphics_id === 'OBJ_EVENT_GFX_BERRY_TREE') continue;
      const says: string[] = [];
      for (const line of body) {
        const t = /^msgbox\s+(\w+)/.exec(line);
        const txt = t && texts.get(t[1]);
        if (txt) {
          const c = dialog(txt);
          if (c && !says.includes(c)) says.push(c);
        }
      }
      const gives: { item: string; qty: number }[] = [];
      for (const line of body) {
        const g = /^(?:giveitem|giveitem_std|finditem)\s+(ITEM_\w+)(?:,\s*(\d+))?/.exec(line);
        if (g && g[1] !== 'ITEM_NONE' && items[itemId(g[1])] && !gives.some((x) => x.item === itemId(g[1]))) gives.push({ item: itemId(g[1]), qty: Number(g[2] ?? 1) });
      }
      const gm = body.map((l) => /^givemon\s+(SPECIES_\w+),\s*(\d+)(?:,\s*(ITEM_\w+))?/.exec(l)).find(Boolean);
      const isShop = body.some((l) => /^pokemart\b/.test(l));
      const npc: AtlasNpc = {
        name: spaced(o.script.replace(/^\w+?_EventScript_/, '')).replace(/\s+/g, ' ').trim() || 'NPC',
        sprite: title(o.graphics_id.replace('OBJ_EVENT_GFX_', '').toLowerCase()),
        says,
        role: isShop ? 'shop' : gm ? 'gift' : /Tutor/i.test(o.script) ? 'tutor' : 'npc',
        ...(sub ? { sub } : {}),
        ...(gives.length ? { gives } : {}),
        ...(gm ? { giftMon: { species: cid(gm[1]), level: Number(gm[2]), ...(gm[3] && gm[3] !== 'ITEM_NONE' ? { item: itemId(gm[3]) } : {}) } } : {}),
      };
      loc.npcs.push(npc);
      npcTotal++;
      if (says.length) npcWithText++;
      for (const g of gives) loc.items.push({ item: g.item, qty: g.qty, how: 'gift', where: `${sub ? `${sub}: ` : ''}given by ${npc.name}`, respawns: false, ...(sub ? { sub } : {}) });
    }
    for (const b of mj.bg_events ?? []) {
      if (SIGN_TYPES.has(b.type) && b.script) {
        const says = reach(b.script).flatMap((l) => labels.get(l) ?? []).map((l) => /^msgbox\s+(\w+)/.exec(l)).filter(Boolean).map((m) => texts.get(m![1])).filter(Boolean).map((t) => dialog(t!));
        if (says.length) loc.npcs.push({ name: 'Sign', sprite: 'Sign', says: [...new Set(says)], role: 'sign', ...(sub ? { sub } : {}) });
      }
    }

    // map-level scripts: trainers fought by script, badges, marts
    const src = existsSync(resolve(dir, 'data/maps', d, 'scripts.inc')) ? read(dir, `data/maps/${d}/scripts.inc`) : '';
    for (const t of src.matchAll(/\bTRAINER_\w+/g)) place3(t[0], place, sub);
    for (const bm of src.matchAll(/setflag FLAG_BADGE0(\d)_GET/g)) badgeOf.set(place, BADGES[Number(bm[1]) - 1]);
    for (const pm of src.matchAll(/^\s*pokemart\s+(\w+)/gm)) {
      const list = labels.get(pm[1]) ?? [];
      const stock = list.filter((l) => /^\.2byte\s+ITEM_/.test(l)).map((l) => itemId(/ITEM_\w+/.exec(l)![0])).filter((id) => items[id]);
      if (!stock.length) continue;
      const variant = /Expanded/.test(pm[1]) ? ' · after the game starts' : /Basic/.test(pm[1]) ? ' · at the start' : '';
      const shop: AtlasShop = { name: `${sub && sub !== 'Mart' ? `${sub} ` : ''}Poké Mart${variant}`, items: stock.map((id) => ({ item: id, price: items[id]?.price ?? 0 })) };
      if (!loc.shops.some((s) => s.name === shop.name && s.items.map((i) => i.item).join() === shop.items.map((i) => i.item).join())) loc.shops.push(shop);
    }
  }

  // connections
  for (const [place, dests] of connectionsRaw) {
    const out = new Set<string>();
    for (const dm of dests) {
      const target = mapPlace.get(dm);
      if (target && target !== place) out.add(target);
    }
    locations[place].connections = [...out].sort();
  }

  // --- place trainers, gyms --------------------------------------------------------------------
  const unplaced: string[] = [];
  for (const t of Object.values(trainers)) {
    const base = rematchOf.get(t.id)?.base ?? t.id;
    const p = trainerPlace.get(t.id)?.place ?? trainerPlace.get(base)?.place;
    if (p) {
      t.loc = p;
      locations[p].trainers.push(t.id);
    } else unplaced.push(t.id);
  }
  for (const l of Object.values(locations)) l.trainers.sort((a, b) => trainerOrder.indexOf(a) - trainerOrder.indexOf(b));
  const badges: string[] = [];
  for (const [place, badge] of badgeOf) {
    const loc = locations[place];
    const leader = loc.trainers.map((id) => trainers[id]).find((t) => t.kind === 'leader' && t.order === 0);
    if (!leader) continue;
    const counts = new Map<string, number>();
    for (const m of leader.party) for (const ty of gen3.species.get(m.species)?.types ?? []) counts.set(ty, (counts.get(ty) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(a[0] === 'Normal') - Number(b[0] === 'Normal'))[0]?.[0];
    const gym: AtlasGym = { leader: leader.name, badge, levelCap: Math.max(...leader.party.map((m) => m.level)), ...(top ? { type: top } : {}) };
    loc.gym = gym;
    if (!badges.includes(badge)) badges.push(badge);
  }

  // --- tidy + report ---------------------------------------------------------------------------
  const sorted: Record<string, AtlasLocation> = {};
  for (const id of Object.keys(locations).sort()) sorted[id] = locations[id];
  const used = new Set<string>();
  for (const l of Object.values(sorted)) {
    l.items.forEach((i) => used.add(i.item));
    l.shops.forEach((s) => s.items.forEach((i) => used.add(i.item)));
  }
  for (const t of Object.values(trainers)) {
    t.party.forEach((m) => m.item && used.add(m.item));
    t.bag?.forEach((b) => used.add(b));
  }
  // keep every item the game defines: the item database lists all of them
  const file: AtlasFile = {
    version: 1, game: cfg.game, name: cfg.name, generation: 3, source: { repo: cfg.url, commit: COMMIT },
    locations: sorted, trainers, items, unplaced, otherTrainers: otherTrainersOf(trainers, unplaced), badges, unverified,
  };
  const L = Object.values(sorted);
  const encounterLocs = new Set<string>();
  for (const rows of Object.values(pokedex.encounters)) for (const [g, a] of rows) if (pokedex.games[g].id === cfg.dexGame) encounterLocs.add(pokedex.areas[a].loc);
  const missing = [...encounterLocs].filter((l) => !sorted[l]);
  const hiddenN = L.flatMap((l) => l.items).filter((i) => i.how === 'hidden').length;
  const visibleN = L.flatMap((l) => l.items).filter((i) => i.how === 'visible' || i.how === 'tm' || i.how === 'hm').length;
  const gapsMd = [
    `# Atlas data gaps — ${cfg.name}`,
    '',
    `Generated by \`npm run atlas\` (scripts/atlas/gba.ts); do not edit. Source: ${cfg.url} @ \`${COMMIT.slice(0, 10)}\`. ${cfg.note}`,
    '',
    '| What | Found | Expected | Notes |',
    '|---|---|---|---|',
    `| Town-map places with data | ${L.filter((l) => l.maps.length).length} | ${L.length} | no map folded in: ${L.filter((l) => !l.maps.length).map((l) => l.id).join(', ') || '—'} |`,
    `| Wild-encounter locations present | ${encounterLocs.size - missing.length} | ${encounterLocs.size} | missing: ${missing.join(', ') || '—'} |`,
    `| Trainers with full teams | ${Object.keys(trainers).length} | ${trainerIds.filter((t) => t !== 'TRAINER_NONE' && t !== 'TRAINER_SECRET_BASE').length} | unplaced on a location: ${unplaced.length}; the rest of trainers.h are unused slots without a party |`,
    `| Hidden items | ${hiddenN} | — | bg events of type hidden_item |`,
    `| Visible items (balls, TMs) | ${visibleN} | — | item-ball objects whose script finds an item |`,
    `| NPCs with dialogue | ${npcWithText} | ${npcTotal} | NPCs whose reachable script shows text |`,
    `| Shops | ${L.reduce((n, l) => n + l.shops.length, 0)} | — | Poké Mart lists; decoration, vitamin and Battle Frontier counters are not included |`,
    `| Gyms with leader, badge, level cap | ${L.filter((l) => l.gym).length} | 8 | |`,
    '',
    '## Maps whose region-map section is not a Town Map place',
    '',
    [...unmappedSections.entries()].map(([s, m]) => `- \`${s}\`: ${m.slice(0, 6).join(', ')}${m.length > 6 ? `, … (${m.length})` : ''}`).join('\n') || '—',
    '',
    '## Trainers not placed on a location',
    '',
    unplaced.length ? unplaced.map((t) => `- \`${t}\` (${trainers[t].name}): ${file.otherTrainers![t]}`).join('\n') : '—',
    '',
    '## Unverified',
    '',
    Object.keys(unverified).length ? Object.entries(unverified).map(([k, v]) => `- \`${k}\`: ${v.join('; ')}`).join('\n') : 'Nothing is marked unverified in this build.',
    '',
    '## Known limits',
    '',
    '- Nature, ability and gender of trainer mons are computed from the same personality rule the game uses (src/battle_main.c); they have not been cross-checked against a second source.',
    '- Item "where" text gives the tile in the map; there is no per-item prose in the decomp.',
    '- Overworld connections come from warps only (the decomp lists map connections by direction; not used yet).',
    '- Wild Pokémon are read from the Pokédex encounter tables (PKHeX), not from this file.',
    '',
  ].join('\n');
  return { file, gaps: gapsMd };
}
