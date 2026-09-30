/**
 * Gen 1 atlases (Red / Blue, and Yellow from its sibling decompilation), from the pret/pokered assembly:
 *   data/trainers/{names,parties,special_moves}.asm   trainer classes and every party (level, species)
 *   data/pokemon/base_stats + evos_moves.asm          starting moves and level-up learnsets (trainer mons get the
 *                                                     last four moves the game would have taught at their level)
 *   data/maps/objects/<Map>.asm                       warps, signs, NPCs, trainers and item balls per map
 *   scripts/<Map>.asm + text/<Map>.asm                what each NPC and trainer says
 *   data/events/hidden_events.asm                     hidden items; data/items/{marts,prices}.asm shops
 *   engine/pokemon/add_mon.asm                        trainer mons use fixed DVs (Atk 9, the rest 8)
 * Gen 1 trainers have no personal names (only a class), no abilities, natures or held items.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Dex } from '@pkmn/dex';
import type { AtlasFile, AtlasGym, AtlasItemInfo, AtlasLocation, AtlasMon, AtlasNpc, AtlasTrainer, LocationKind, TrainerKind } from '../../src/domain/atlasTypes.ts';
import { ensure } from '../sources.ts';
import { OUT, cid, cleanText, readJSON, spaced, title } from './common.ts';

const read = (dir: string, f: string) => readFileSync(resolve(dir, f), 'utf8');
/** One asm line without its `;` comment. */
const code = (l: string) => l.replace(/;.*$/, '').trim();

/** Decomp asm move / species constants spelled differently from Showdown's ids. */
const ALIASES: Record<string, string> = { psychicm: 'psychic', vicegrip: 'visegrip', nidoranm: 'nidoranm', nidoranf: 'nidoranf', farfetchd: 'farfetchd', mrmime: 'mrmime' };
const gid = (c: string) => {
  const id = cid(c.replace(/^(TM|HM)_/, ''));
  return ALIASES[id] ?? id;
};

interface Gen1Config {
  game: string;
  name: string;
  repo: 'pokered' | 'pokeyellow';
  url: string;
  commit: string;
  dexGame: string;
  mapId: string;
  note: string;
}

export const RED: Gen1Config = {
  game: 'red', name: 'Pokémon Red', repo: 'pokered', url: 'pret/pokered', commit: 'd2704a63c26f9ba046ade877445216b3de0519a4', dexGame: 'red', mapId: 'kanto-rby',
  note: 'Blue uses this file too: Red and Blue share all the data in the decompilation (only wild Pokémon and a few trades differ).',
};

export const YELLOW: Gen1Config = {
  game: 'yellow', name: 'Pokémon Yellow', repo: 'pokeyellow', url: 'pret/pokeyellow', commit: 'e89ead154b9968aa50eed9328ff2b38b6c194382', dexGame: 'yellow', mapId: 'kanto-rby',
  note: "Yellow's own trainer parties, Pikachu and gift changes come from its decompilation.",
};
export const buildYellow = () => buildGen1(YELLOW);

const BADGES = ['Boulder', 'Cascade', 'Thunder', 'Rainbow', 'Soul', 'Marsh', 'Volcano', 'Earth'];
const LEADERS = ['BROCK', 'MISTY', 'LT_SURGE', 'ERIKA', 'KOGA', 'SABRINA', 'BLAINE', 'GIOVANNI'];

/** Outdoor place ids of the Red/Blue Town Map keyed by the map constant's words. */
const PLACE_ALIASES: Record<string, string> = {
  SS_ANNE: 'kanto-ssanne',
  ROCKET_HIDEOUT: 'kanto-rocket-hq',
  SILPH_CO: 'kanto-silph-co',
  POWER_PLANT: 'kanto-power-plant',
  SAFARI_ZONE: 'kanto-safari-zone',
  VICTORY_ROAD: 'kanto-victory-road-2',
  POKEMON_LEAGUE: 'kanto-pokemon-league',
  INDIGO_PLATEAU: 'kanto-indigo-plateau',
  LORELEIS_ROOM: 'kanto-pokemon-league',
  BRUNOS_ROOM: 'kanto-pokemon-league',
  AGATHAS_ROOM: 'kanto-pokemon-league',
  LANCES_ROOM: 'kanto-pokemon-league',
  CHAMPIONS_ROOM: 'kanto-pokemon-league',
  HALL_OF_FAME: 'kanto-pokemon-league',
  UNDERGROUND_PATH: 'kanto-underground-path',
  SEAFOAM_ISLANDS: 'seafoam-islands',
  DIGLETTS_CAVE: 'digletts-cave',
  MT_MOON: 'mt-moon',
  ROCK_TUNNEL: 'rock-tunnel',
  POKEMON_TOWER: 'pokemon-tower',
  POKEMON_MANSION: 'pokemon-mansion',
  VIRIDIAN_FOREST: 'viridian-forest',
  CERULEAN_CAVE: 'cerulean-cave',
  SEA_COTTAGE: 'kanto-sea-cottage',
};

interface ObjectEvent {
  x: number;
  y: number;
  sprite: string;
  text: string;
  /** Item ball contents or trainer class. */
  item?: string;
  opp?: string;
  party?: number;
}

export function buildRed(): { file: AtlasFile; gaps: string } {
  return buildGen1(RED);
}

function buildGen1(cfg: Gen1Config): { file: AtlasFile; gaps: string } {
  const dir = ensure(cfg.repo, ['data', 'maps', 'scripts', 'text', 'constants', 'engine']);
  const gen1 = Dex.forGen(1);
  const mapsJson = readJSON<{ maps: Record<string, { places: Record<string, unknown> }> }>(resolve(OUT, 'maps.json')).maps[cfg.mapId];
  const placeIds = new Set(Object.keys(mapsJson.places));
  const pokedex = readJSON<{ games: { id: string }[]; areas: { loc: string; name: string }[]; encounters: Record<string, number[][]> }>(resolve(OUT, 'pokedex-gen1.json'));
  const areaName = new Map(pokedex.areas.map((a) => [a.loc, a.name]));

  // --- constants -------------------------------------------------------------------------------
  const consts = (file: string, from?: string) => {
    const out: string[] = [];
    let on = !from;
    for (const l of read(dir, file).split('\n')) {
      if (from && l.includes(from)) on = true;
      const m = /^\s*const\s+(\w+)/.exec(l);
      if (on && m) out.push(m[1]);
    }
    return out;
  };
  const speciesOrder = consts('constants/pokemon_constants.asm').filter((c) => c !== 'NO_MON');
  const trainerClasses = [...read(dir, 'constants/trainer_constants.asm').matchAll(/^\s*trainer_const\s+(\w+)/gm)].map((m) => m[1]);
  const itemConsts = consts('constants/item_constants.asm').slice(0, 0);
  void itemConsts;
  const itemNames = [...read(dir, 'data/items/names.asm').matchAll(/li "([^"]*)"/g)].map((m) => m[1]);
  const itemOrder: string[] = [];
  {
    let on = false;
    for (const l of read(dir, 'constants/item_constants.asm').split('\n')) {
      const m = /^\s*const\s+(\w+)/.exec(l);
      if (l.includes('const_def')) on = true;
      if (on && m && itemOrder.length < 0xc4) itemOrder.push(m[1]);
      if (l.includes('const_next $C4')) break;
    }
  }
  const tmOrder = [...read(dir, 'constants/item_constants.asm').matchAll(/^\s*add_tm\s+(\w+)/gm)].map((m) => m[1]);
  const hmOrder = [...read(dir, 'constants/item_constants.asm').matchAll(/^\s*add_hm\s+(\w+)/gm)].map((m) => m[1]);
  const prices = new Map<string, number>();
  for (const m of read(dir, 'data/items/prices.asm').matchAll(/bcd3\s+(\d+)\s*;\s*(\w+)/g)) prices.set(m[2], Number(m[1]));
  const tmPrices = [...read(dir, 'data/items/tm_prices.asm').matchAll(/nybble\s+(\d+)/g)].map((m) => Number(m[1]) * 1000);

  // --- items ------------------------------------------------------------------------------------
  const items: Record<string, AtlasItemInfo> = {};
  const itemIdOf = (c: string): string | undefined => {
    if (/^TM_/.test(c)) {
      const i = tmOrder.indexOf(c.slice(3));
      return i >= 0 ? `tm${String(i + 1).padStart(2, '0')}` : undefined;
    }
    if (/^HM_/.test(c)) {
      const i = hmOrder.indexOf(c.slice(3));
      return i >= 0 ? `hm${String(i + 1).padStart(2, '0')}` : undefined;
    }
    return itemOrder.includes(c) ? gid(c) : undefined;
  };
  itemOrder.forEach((c, i) => {
    if (i === 0 || i - 1 >= itemNames.length || /^FLOOR_|^HM_|^TM_/.test(c)) return;
    const nm = itemNames[i - 1];
    if (!nm || /^\?+$/.test(nm) || nm === ' ') return;
    items[gid(c)] = { name: title(nm.toLowerCase().replace('poké', 'Poké')).replace('Poké', 'Poké'), price: prices.get(c) ?? 0, description: '', pocket: 'items' };
  });
  tmOrder.forEach((mv, i) => {
    const id = `tm${String(i + 1).padStart(2, '0')}`;
    items[id] = { name: `TM${String(i + 1).padStart(2, '0')}`, price: tmPrices[i] ?? 0, description: `Teaches ${title(mv.toLowerCase())}.`, pocket: 'tm_hm', move: gid(mv), moveType: gen1.moves.get(gid(mv)).type };
  });
  hmOrder.forEach((mv, i) => {
    const id = `hm${String(i + 1).padStart(2, '0')}`;
    items[id] = { name: `HM${String(i + 1).padStart(2, '0')}`, price: 0, description: `Teaches ${title(mv.toLowerCase())}.`, pocket: 'tm_hm', move: gid(mv), moveType: gen1.moves.get(gid(mv)).type };
  });
  const itemId = (c: string) => itemIdOf(c);

  // --- species: types, starting moves, learnsets -------------------------------------------------
  const learnLabels = [...read(dir, 'data/pokemon/evos_moves.asm').matchAll(/^\tdw (\w+EvosMoves)/gm)].map((m) => m[1]);
  const evosText = read(dir, 'data/pokemon/evos_moves.asm');
  const learnByLabel = new Map<string, [number, string][]>();
  for (const m of evosText.matchAll(/^(\w+EvosMoves):\n((?:(?!^\w+EvosMoves:)[^\n]*\n?)*)/gm)) {
    const rows = m[2].split('\n').map(code).filter((l) => l.startsWith('db '));
    let i = 0;
    // evolutions first (a run of db lines ending with `db 0`), then level / move pairs ending with `db 0`
    while (i < rows.length && rows[i] !== 'db 0') i++;
    i++;
    const moves: [number, string][] = [];
    for (; i < rows.length && rows[i] !== 'db 0'; i++) {
      const p = /^db\s+(\d+),\s*(\w+)/.exec(rows[i]);
      if (p) moves.push([Number(p[1]), p[2]]);
    }
    learnByLabel.set(m[1], moves);
  }
  const speciesData = new Map<string, { types: string[]; start: string[]; learn: [number, string][] }>();
  speciesOrder.forEach((sp, i) => {
    const f = [sp.toLowerCase(), sp.toLowerCase().replace(/_/g, '')].map((n) => `data/pokemon/base_stats/${n}.asm`).find((p) => existsSync(resolve(dir, p)));
    if (!f) return;
    const src = read(dir, f).split('\n').map(code);
    const ty = src.map((l) => /^db\s+(\w+),\s*(\w+)$/.exec(l)).find((m) => m && /^[A-Z_]+$/.test(m[1]) && ['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BIRD', 'BUG', 'GHOST', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC_TYPE', 'ICE', 'DRAGON'].includes(m[1]));
    const mv = read(dir, f).split('\n').find((l) => /level 1 learnset/.test(l));
    const start = mv ? [...code(mv).matchAll(/\b([A-Z_]+)\b/g)].map((x) => x[1]).filter((x) => x !== 'db' && x !== 'NO_MOVE') : [];
    const norm = sp.toLowerCase().replace(/_/g, '');
    const label = learnLabels.find((l) => l.replace(/EvosMoves$/, '').toLowerCase() === norm) ?? learnLabels[i];
    speciesData.set(sp, {
      types: ty ? [...new Set([ty[1], ty[2]])].map((t) => (t === 'PSYCHIC_TYPE' ? 'Psychic' : title(t.toLowerCase()))) : [],
      start,
      learn: label ? (learnByLabel.get(label) ?? []) : [],
    });
  });
  /** Gen 1: starting moves, then each level-up move up to the level; a full set drops the oldest. */
  const movesAt = (sp: string, level: number): string[] => {
    const d = speciesData.get(sp);
    if (!d) return [];
    const moves = [...d.start];
    for (const [lv, m] of d.learn) {
      if (lv > level || moves.includes(m)) continue;
      if (moves.length < 4) moves.push(m);
      else {
        moves.shift();
        moves.push(m);
      }
    }
    return moves;
  };

  // --- trainers ---------------------------------------------------------------------------------
  const classDisplay = [...read(dir, 'data/trainers/names.asm').matchAll(/li "([^"]*)"/g)].map((m) => m[1].replace(/♂/g, ' (M)').replace(/♀/g, ' (F)'));
  const pointerClasses = [...read(dir, 'data/trainers/parties.asm').matchAll(/^\tdw (\w+Data)/gm)].map((m) => m[1]);
  const partyText = read(dir, 'data/trainers/parties.asm');
  const partiesByLabel = new Map<string, { level: number; species: string }[][]>();
  for (const m of partyText.matchAll(/^(\w+Data):\n((?:(?!^\w+Data:)[^\n]*\n?)*)/gm)) {
    const parties: { level: number; species: string }[][] = [];
    for (const raw of m[2].split('\n')) {
      const l = code(raw);
      if (!l.startsWith('db ')) continue;
      const toks = l.slice(3).split(',').map((t) => t.trim());
      const party: { level: number; species: string }[] = [];
      if (toks[0] === '$FF') {
        for (let i = 1; i + 1 < toks.length; i += 2) if (toks[i] !== '0') party.push({ level: Number(toks[i]), species: toks[i + 1] });
      } else {
        const lvl = Number(toks[0]);
        for (const t of toks.slice(1)) if (t !== '0') party.push({ level: lvl, species: t });
      }
      parties.push(party);
    }
    partiesByLabel.set(m[1], parties);
  }
  // Yellow: explicit `db class, party` blocks of `db mon, slot, move` rows
  const specialSrc = read(dir, 'data/trainers/special_moves.asm');
  const yellowSpecial = new Map<string, { mon: number; slot: number; move: string }[]>();
  if (specialSrc.includes('SpecialTrainerMoves:')) {
    let cur: { mon: number; slot: number; move: string }[] | undefined;
    for (const raw of specialSrc.split('SpecialTrainerMoves:')[1].split('\n')) {
      const l = code(raw);
      const head = /^db\s+([A-Z_0-9]+),\s*(\d+)$/.exec(l);
      const row = /^db\s+(\d+),\s*(\d+),\s*([A-Z_0-9]+)$/.exec(l);
      if (head) yellowSpecial.set(`${head[1]}_${head[2]}`, (cur = []));
      else if (row && cur) cur.push({ mon: Number(row[1]), slot: Number(row[2]), move: row[3] });
    }
  }
  const loneMoves = [...specialSrc.split('TeamMoves:')[0].matchAll(/^\tdb (\d+), (\w+)/gm)].map((m) => ({ idx: Number(m[1]), move: m[2] }));
  const teamMoves = [...(specialSrc.split('TeamMoves:')[1] ?? '').matchAll(/^\tdb (\w+),\s*(\w+)/gm)].map((m) => ({ cls: m[1], move: m[2] })).filter((m) => m.cls !== '-1');

  const classKind = (c: string): TrainerKind =>
    LEADERS.includes(c) && c !== 'GIOVANNI' ? 'leader' : ['LORELEI', 'BRUNO', 'AGATHA', 'LANCE'].includes(c) ? 'elite-four' : c === 'RIVAL3' ? 'champion' : /RIVAL/.test(c) ? 'rival' : c === 'GIOVANNI' || c === 'ROCKET' || c === 'CHIEF' ? 'boss' : /PROF_OAK/.test(c) ? 'other' : 'trainer';
  const makeTrainer = (clsConst: string, n: number, loc?: string): AtlasTrainer | undefined => {
    const ci = trainerClasses.indexOf(clsConst);
    if (ci < 1) return undefined;
    const label = pointerClasses[ci - 1];
    const raw = label ? partiesByLabel.get(label)?.[n - 1] : undefined;
    if (!raw?.length) return undefined;
    const party: AtlasMon[] = raw.map((p) => ({
      species: gid(p.species), level: p.level, moves: movesAt(p.species, p.level).map(gid), movesDerived: true,
      // fixed trainer DVs: Atk 9, Def / Spd / Spc 8 (HP 8 follows from the low bits)
      iv: 8, dvs: [8, 9, 8, 8, 8, 8],
    }));
    // special moves the game hand-writes into the third slot
    const setSlot3 = (idx: number, mv: string) => {
      const mon = party[idx - 1];
      if (!mon) return;
      const moves = [...mon.moves];
      while (moves.length < 3) moves.push(gid('NO_MOVE'));
      moves[2] = gid(mv);
      mon.moves = moves.filter((m) => m !== 'nomove');
      mon.movesDerived = false;
    };
    for (const r of yellowSpecial.get(`${clsConst}_${n}`) ?? []) {
      const mon = party[r.mon - 1];
      if (!mon) continue;
      const moves = [...mon.moves];
      while (moves.length < r.slot) moves.push('nomove');
      moves[r.slot - 1] = gid(r.move);
      mon.moves = moves.filter((m) => m !== 'nomove');
      mon.movesDerived = false;
    }
    const leaderNo = yellowSpecial.size ? -1 : LEADERS.indexOf(clsConst);
    // LoneMoves counts Pokémon from zero (`wEnemyMon1Moves + 2` plus index × struct size)
    if (leaderNo >= 0 && loneMoves[leaderNo] && (clsConst !== 'GIOVANNI' || /GYM/.test(loc ?? ''))) setSlot3(loneMoves[leaderNo].idx + 1, loneMoves[leaderNo].move);
    const tm = yellowSpecial.size ? undefined : teamMoves.find((t) => t.cls === clsConst);
    if (tm) setSlot3(5, tm.move);
    const dispName = title((classDisplay[ci - 1] ?? clsConst).toLowerCase());
    return {
      id: `${clsConst}_${n}`, name: dispName, cls: dispName, kind: classKind(clsConst), party, group: `${clsConst}_${n}`, order: 0,
    };
  };

  // --- maps ---------------------------------------------------------------------------------------
  const objectFiles = readdirSync(resolve(dir, 'data/maps/objects')).filter((f) => f.endsWith('.asm'));
  interface MapInfo { stem: string; id: string; warps: string[]; objects: ObjectEvent[]; signs: string[] }
  const maps = new Map<string, MapInfo>();
  for (const f of objectFiles) {
    const src = read(dir, `data/maps/objects/${f}`);
    const id = /def_warps_to (\w+)/.exec(src)?.[1];
    if (!id) continue;
    const warps = [...src.matchAll(/^\twarp_event\s+\d+,\s*\d+,\s*(\w+)/gm)].map((m) => m[1]).filter((w) => w !== 'LAST_MAP');
    const objects: ObjectEvent[] = [];
    for (const m of src.matchAll(/^\tobject_event\s+(\d+),\s*(\d+),\s*(\w+),\s*(\w+),\s*(\w+),\s*(\w+)(?:,\s*(\w+))?(?:,\s*(\d+))?/gm)) {
      const o: ObjectEvent = { x: Number(m[1]), y: Number(m[2]), sprite: m[3], text: m[6] };
      if (m[7]) {
        if (m[7].startsWith('OPP_')) {
          o.opp = m[7].slice(4);
          o.party = Number(m[8]);
        } else o.item = m[7];
      }
      objects.push(o);
    }
    maps.set(id, { stem: f.replace('.asm', ''), id, warps, objects, signs: [...src.matchAll(/^\tbg_event\s+\d+,\s*\d+,\s*(\w+)/gm)].map((m) => m[1]) });
  }
  // map constant → place
  const place = new Map<string, string>();
  const tryPlace = (mc: string): string | undefined => {
    const direct = PLACE_ALIASES[mc] ?? Object.entries(PLACE_ALIASES).find(([k]) => mc.startsWith(`${k}_`))?.[1];
    if (direct && placeIds.has(direct)) return direct;
    const k = mc.toLowerCase().replace(/_/g, '-');
    return [k, `kanto-${k}`, `kanto-sea-${k}`].find((c) => placeIds.has(c));
  };
  for (const mc of maps.keys()) {
    const p = tryPlace(mc);
    if (p) place.set(mc, p);
  }
  // interiors: the place of the map whose door they are (repeat until nothing changes)
  for (let changed = true; changed; ) {
    changed = false;
    for (const [mc, mi] of maps) {
      if (place.has(mc)) continue;
      const via = mi.warps.map((w) => place.get(w)).find(Boolean);
      if (via) {
        place.set(mc, via);
        changed = true;
      }
    }
  }
  // the parent → children direction: a map listing an unresolved child as its warp target
  for (let changed = true; changed; ) {
    changed = false;
    for (const [mc, mi] of maps) {
      if (!place.has(mc)) continue;
      for (const w of mi.warps) if (maps.has(w) && !place.has(w)) { place.set(w, place.get(mc)!); changed = true; }
    }
  }

  const locations: Record<string, AtlasLocation> = {};
  const kindOf = (id: string): LocationKind => (/sea-route/.test(id) ? 'sea-route' : /route/.test(id) ? 'route' : /-city$/.test(id) || id === 'saffron-city' || id === 'celadon-city' ? 'city' : /town$|island$/.test(id) ? 'town' : /cave|tunnel|mt-|forest|path|tower|mansion|hq|silph|plant|safari|victory|seafoam|cottage|league|ssanne/.test(id) ? 'cave' : 'landmark');
  for (const id of placeIds) locations[id] = { id, name: areaName.get(id) ?? title(id.replace(/^kanto-/, '')), kind: kindOf(id), maps: [], connections: [], pokecenter: false, shops: [], obstacles: [], items: [], npcs: [], trainers: [], events: [] };
  const trainers: Record<string, AtlasTrainer> = {};
  const unverified: Record<string, string[]> = {};
  const connectionsRaw = new Map<string, Set<string>>();
  const badgeOf = new Map<string, string>();
  let npcTotal = 0;
  let npcWithText = 0;

  // text: labels in text/*.asm → cleaned text; scripts: text pointers and label bodies
  const texts = new Map<string, string>();
  for (const f of readdirSync(resolve(dir, 'text')).filter((x) => x.endsWith('.asm'))) {
    let label = '';
    let buf: string[] = [];
    const flush = () => {
      if (label && buf.length) texts.set(label, buf.join(''));
    };
    for (const raw of read(dir, `text/${f}`).split('\n')) {
      const l = raw.trim();
      const lab = /^(_\w+)::?$/.exec(l);
      if (lab) {
        flush();
        label = lab[1];
        buf = [];
        continue;
      }
      const t = /^(text|line|cont|para|page|next|done|prompt)\s*(?:"(.*)")?$/.exec(l);
      if (t) {
        const s = (t[2] ?? '').replace(/@$/, '').replace(/#/g, 'Poké').replace(/<PLAYER>/g, '[name]').replace(/<RIVAL>/g, '[rival]').replace(/<USER>|<TARGET>/g, '…');
        buf.push(t[1] === 'para' || t[1] === 'page' ? `\n${s}` : t[1] === 'line' || t[1] === 'cont' || t[1] === 'next' ? ` ${s}` : s);
      }
    }
    flush();
  }
  const scriptLabels = new Map<string, string[]>();
  const textPointers = new Map<string, Map<string, string>>();
  for (const [, mi] of maps) {
    const f = `scripts/${mi.stem}.asm`;
    if (!existsSync(resolve(dir, f))) continue;
    const src = read(dir, f);
    const tp = new Map<string, string>();
    for (const m of src.matchAll(/dw_const\s+(\w+),\s*(TEXT_\w+)/g)) tp.set(m[2], m[1]);
    textPointers.set(mi.id, tp);
    let cur: string[] | undefined;
    for (const raw of src.split('\n')) {
      const lab = /^(\w+)::?$/.exec(raw.trim());
      if (lab) scriptLabels.set(lab[1], (cur = []));
      else cur?.push(code(raw));
    }
  }
  const reachText = (label: string, seen = new Set<string>()): string[] => {
    if (seen.has(label) || !scriptLabels.has(label)) return [];
    seen.add(label);
    const out: string[] = [];
    for (const l of scriptLabels.get(label)!) {
      const tf = /^text_far\s+(_\w+)/.exec(l);
      if (tf && texts.has(tf[1])) out.push(cleanText(texts.get(tf[1])!));
      const j = /^(?:jp|call|jr)\s+(?:\w+,\s*)?(\w+)$/.exec(l);
      if (j) out.push(...reachText(j[1], seen));
    }
    return out;
  };
  const trainerHeaders = new Map<string, string[]>();
  for (const [label, body] of scriptLabels) {
    const h = /^trainer\s+\w+,\s*\d+,\s*(\w+),\s*(\w+),\s*(\w+)/.exec(body.find((l) => l.startsWith('trainer ')) ?? '');
    if (h && /TrainerHeader/.test(label)) trainerHeaders.set(label, [h[1], h[2], h[3]]);
  }

  // marts
  const martSrc = read(dir, 'data/items/marts.asm');
  const marts = new Map<string, string[]>();
  for (const m of martSrc.matchAll(/^(\w+)::\n\tscript_mart ([^\n]*)/gm)) marts.set(m[1], m[2].split(',').map((x) => x.trim()));

  // hidden items (per map, in the order of HiddenEventMaps)
  const hiddenSrc = read(dir, 'data/events/hidden_events.asm');
  const hiddenItems = new Map<string, { x: number; y: number; item: string }[]>();
  {
    let cur = '';
    for (const raw of hiddenSrc.split('\n')) {
      const hf = /^\s*hidden_events_for\s+(\w+)/.exec(raw);
      if (hf) cur = hf[1];
      const he = /^\s*hidden_event\s+(\d+),\s*(\d+),\s*HiddenItems,\s*(\w+)/.exec(raw);
      if (he && cur) (hiddenItems.get(cur) ?? hiddenItems.set(cur, []).get(cur)!).push({ x: Number(he[1]), y: Number(he[2]), item: he[3] });
    }
  }
  // the standalone list `hidden_item MAP, x, y` (coords) has no item; hidden_events carries it.

  const trainerPlaceFirst = new Map<string, string>();
  for (const [mc, mi] of maps) {
    const pl = place.get(mc);
    if (!pl) continue;
    const loc = locations[pl];
    loc.maps.push(mi.stem);
    if (/POKECENTER/.test(mc)) loc.pokecenter = true;
    for (const w of mi.warps) {
      const t = place.get(w);
      if (t && t !== pl) (connectionsRaw.get(pl) ?? connectionsRaw.set(pl, new Set()).get(pl)!).add(t);
    }
    const sub = mc.toLowerCase().startsWith(pl.replace(/^kanto-/, '').replace(/-/g, '_')) && mc.length > pl.length ? title(spaced(mc.slice(pl.replace(/^kanto-/, '').length).replace(/^_/, '').toLowerCase())) : undefined;
    const tp = textPointers.get(mc) ?? new Map<string, string>();

    for (const o of mi.objects) {
      const label = tp.get(o.text);
      if (o.opp) {
        const t = makeTrainer(o.opp, o.party ?? 1, mc);
        if (!t) continue;
        if (!trainers[t.id]) {
          const body = label ? (scriptLabels.get(label) ?? []) : [];
          const hdr = body.map((l) => /^ld hl,\s*(\w+TrainerHeader\d+)/.exec(l)).find(Boolean)?.[1];
          const battle = hdr ? trainerHeaders.get(hdr)?.[0] : undefined;
          const pre = battle ? reachText(battle).join(' ') : '';
          const defeat = hdr ? reachText(trainerHeaders.get(hdr)![1]).join(' ') : '';
          if (pre || defeat) t.quote = { ...(pre ? { pre } : {}), ...(defeat ? { defeat } : {}) };
          t.loc = pl;
          trainers[t.id] = t;
          trainerPlaceFirst.set(t.id, pl);
        }
        continue;
      }
      if (o.sprite === 'SPRITE_POKE_BALL' && o.item) {
        const id = itemId(o.item);
        if (id && items[id]) {
          const tm = items[id].move;
          loc.items.push({ item: id, qty: 1, how: tm ? (id.startsWith('hm') ? 'hm' : 'tm') : 'visible', where: `${sub ? `${sub}: ` : ''}on the ground at tile (${o.x}, ${o.y})`, at: [o.x, o.y], respawns: false, ...(sub ? { sub } : {}) });
        }
        continue;
      }
      if (o.sprite === 'SPRITE_CLERK' && label && marts.has(label)) {
        const stock = marts.get(label)!.map(itemId).filter((x): x is string => !!x && !!items[x]);
        const shop = { name: `${sub && !/^Mart$/.test(sub) ? `${sub} ` : ''}Poké Mart`.trim(), items: stock.map((it) => ({ item: it, price: items[it]?.price ?? 0 })) };
        if (shop.items.length && !loc.shops.some((s) => s.name === shop.name && s.items.map((i) => i.item).join() === shop.items.map((i) => i.item).join())) loc.shops.push(shop);
        continue;
      }
      if (!label) continue;
      const says = [...new Set(reachText(label))];
      const body = [...reachLabels(label, scriptLabels)].flatMap((l) => scriptLabels.get(l) ?? []);
      const gives: { item: string; qty: number }[] = [];
      for (let i = 0; i < body.length; i++) {
        const g = /^lb bc,\s*(\w+),\s*(\d+)$/.exec(body[i]);
        if (g && body.slice(i + 1, i + 3).some((l) => /^call GiveItem/.test(l))) {
          const id = itemId(g[1]);
          if (id && items[id] && !gives.some((x) => x.item === id)) gives.push({ item: id, qty: Number(g[2]) });
        }
      }
      const npc: AtlasNpc = {
        name: title(o.sprite.replace('SPRITE_', '').toLowerCase()), sprite: title(o.sprite.replace('SPRITE_', '').toLowerCase()), says, role: gives.length ? 'gift' : 'npc',
        ...(sub ? { sub } : {}), ...(gives.length ? { gives } : {}),
      };
      loc.npcs.push(npc);
      npcTotal++;
      if (says.length) npcWithText++;
      for (const g of gives) loc.items.push({ item: g.item, qty: g.qty, how: 'gift', where: `${sub ? `${sub}: ` : ''}given by ${npc.name}`, respawns: false, ...(sub ? { sub } : {}) });
    }
    for (const sg of mi.signs) {
      const label = tp.get(sg);
      const says = label ? [...new Set(reachText(label))] : [];
      if (says.length) loc.npcs.push({ name: 'Sign', sprite: 'Sign', says, role: 'sign', ...(sub ? { sub } : {}) });
    }
    for (const h of hiddenItems.get(mc) ?? []) {
      const id = itemId(h.item);
      if (id && items[id]) loc.items.push({ item: id, qty: 1, how: 'hidden', where: `${sub ? `${sub}: ` : ''}hidden at tile (${h.x}, ${h.y}); the Itemfinder points to it`, at: [h.x, h.y], respawns: false, ...(sub ? { sub } : {}) });
    }
  }
  // scripted trainers: rival and others fought from scripts, placed at the script's map
  for (const [mc, mi] of maps) {
    const pl = place.get(mc);
    if (!pl) continue;
    const src = existsSync(resolve(dir, `scripts/${mi.stem}.asm`)) ? read(dir, `scripts/${mi.stem}.asm`) : '';
    for (const m of src.matchAll(/OPP_(\w+)/g)) {
      const cls = m[1];
      const classIdx = trainerClasses.indexOf(cls);
      if (classIdx < 1) continue;
      const count = partiesByLabel.get(pointerClasses[classIdx - 1])?.length ?? 0;
      for (let n = 1; n <= count; n++) {
        const t = makeTrainer(cls, n, mc);
        if (t && !trainers[t.id] && /RIVAL|PROF_OAK|GIOVANNI|LANCE|CHIEF/.test(cls)) {
          t.loc = pl;
          trainers[t.id] = t;
        }
      }
    }
  }
  for (const t of Object.values(trainers)) if (t.loc) locations[t.loc].trainers.push(t.id);
  // rival battles come in one party per starter: name them
  for (const t of Object.values(trainers)) {
    const m = /^(RIVAL\d)_(\d+)$/.exec(t.id);
    if (!m) continue;
    const starter = t.party[t.party.length - 1]?.species;
    t.group = m[1];
    t.order = Number(m[2]);
    t.variant = starter ? `Rival's ${title(starter)} team` : `Party ${m[2]}`;
    t.name = 'Rival';
  }

  // gyms
  const badges: string[] = [];
  for (const [place0, loc] of Object.entries(locations)) {
    void place0;
    const leaderTrainer = loc.trainers.map((id) => trainers[id]).find((t) => t.kind === 'leader');
    if (!leaderTrainer) continue;
    const no = LEADERS.indexOf(leaderTrainer.id.replace(/_\d+$/, ''));
    const counts = new Map<string, number>();
    for (const m of leaderTrainer.party) for (const ty of gen1.species.get(m.species)?.types ?? []) counts.set(ty, (counts.get(ty) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const gym: AtlasGym = { leader: leaderTrainer.name, badge: BADGES[no] ?? '?', levelCap: Math.max(...leaderTrainer.party.map((m) => m.level)), ...(top ? { type: top } : {}) };
    loc.gym = gym;
    badgeOf.set(loc.id, gym.badge);
    badges.push(gym.badge);
  }
  // Giovanni's gym is where the eighth badge is won
  for (const loc of Object.values(locations)) {
    if (loc.gym) continue;
    const g = loc.trainers.map((id) => trainers[id]).find((t) => t.id.startsWith('GIOVANNI') && /viridian/.test(loc.id));
    if (g) loc.gym = { leader: 'Giovanni', badge: BADGES[7], levelCap: Math.max(...g.party.map((m) => m.level)), type: 'Ground' };
  }

  for (const [pl, dests] of connectionsRaw) locations[pl].connections = [...dests].sort();
  for (const l of Object.values(locations)) l.trainers.sort();
  const sorted: Record<string, AtlasLocation> = {};
  for (const id of Object.keys(locations).sort()) sorted[id] = locations[id];
  const unplaced = Object.values(trainers).filter((t) => !t.loc).map((t) => t.id);
  const file: AtlasFile = {
    version: 1, game: cfg.game, name: cfg.name, generation: 1, source: { repo: cfg.url, commit: cfg.commit },
    locations: sorted, trainers, items, unplaced, badges: BADGES, unverified,
  };
  const L = Object.values(sorted);
  const encounterLocs = new Set<string>();
  for (const rows of Object.values(pokedex.encounters)) for (const [g, a] of rows) if (pokedex.games[g].id === cfg.dexGame) encounterLocs.add(pokedex.areas[a].loc);
  const missing = [...encounterLocs].filter((l) => !sorted[l]);
  const totalParties = pointerClasses.reduce((n, c) => n + (partiesByLabel.get(c)?.length ?? 0), 0);
  const hiddenN = L.flatMap((l) => l.items).filter((i) => i.how === 'hidden').length;
  const visibleN = L.flatMap((l) => l.items).filter((i) => i.how === 'visible' || i.how === 'tm' || i.how === 'hm').length;
  const hiddenExpected = [...hiddenItems.values()].reduce((n, r) => n + r.length, 0);
  const unmappedMaps = [...maps.keys()].filter((m) => !place.has(m));
  const gaps = [
    `# Atlas data gaps — ${cfg.name}`,
    '',
    `Generated by \`npm run atlas\` (scripts/atlas/gen1.ts); do not edit. Source: ${cfg.url} @ \`${cfg.commit.slice(0, 10)}\`. ${cfg.note}`,
    '',
    '| What | Found | Expected | Notes |',
    '|---|---|---|---|',
    `| Town-map places with data | ${L.filter((l) => l.maps.length).length} | ${L.length} | no map folded in: ${L.filter((l) => !l.maps.length).map((l) => l.id).join(', ') || '—'} |`,
    `| Wild-encounter locations present | ${encounterLocs.size - missing.length} | ${encounterLocs.size} | missing: ${missing.join(', ') || '—'} |`,
    `| Trainer parties found on a map | ${Object.values(trainers).filter((t) => t.loc).length} | ${totalParties} | Gen 1 has class parties, not named trainers; unplaced (scripted or unused): ${unplaced.length} |`,
    `| Hidden items | ${hiddenN} | ${hiddenExpected} | HiddenItems events |`,
    `| Visible items (balls, TMs) | ${visibleN} | — | poké-ball objects with an item |`,
    `| NPCs with dialogue | ${npcWithText} | ${npcTotal} | NPCs whose reachable script shows text |`,
    `| Shops | ${L.reduce((n, l) => n + l.shops.length, 0)} | ${marts.size} | clerk texts in marts.asm (vending, prize and Celadon floor lists included where a clerk object exists) |`,
    `| Gyms with leader, badge, level cap | ${L.filter((l) => l.gym).length} | 8 | |`,
    '',
    '## Maps not attached to a Town Map place',
    '',
    unmappedMaps.length ? unmappedMaps.map((m) => `- \`${m}\``).join('\n') : '—',
    '',
    '## Known limits',
    '',
    '- Gen 1 trainers have no names, only a class and a party number; rival parties depend on the starter and are listed per party.',
    "- Moves are what the game's move-learning routine gives at the trainer mon's level, plus the hand-written special moves (Gym Leaders' one move, the Elite Four's team move). They have not been cross-checked against a second source.",
    '- Gifts are detected from `GiveItem` calls with literal items; Pokémon gifts, trades and prize counters are not itemized yet.',
    '- Wild Pokémon are read from the Pokédex encounter tables (PKHeX), not from this file.',
    '',
  ].join('\n');
  void readJSON;
  return { file, gaps };
}

/** Labels reachable from `start` through jumps and calls. */
function reachLabels(start: string, labels: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length && seen.size < 30) {
    const l = queue.shift()!;
    if (seen.has(l) || !labels.has(l)) continue;
    seen.add(l);
    for (const line of labels.get(l)!) {
      const j = /^(?:jp|call|jr)\s+(?:\w+,\s*)?(\w+)$/.exec(line);
      if (j) queue.push(j[1]);
    }
  }
  return seen;
}
