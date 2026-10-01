/**
 * Diamond / Pearl atlas (trainers only), from the pret/pokediamond decompilation:
 *   files/poketool/trainer/trdata.json   every trainer: class, name, party (level, species, item, moves, IV "difficulty")
 *   files/poketool/personal/{personal,wotbl}.json   types, abilities, gender ratios; level-up learnsets
 *   files/msgdata/msg/narc_0344 (item names), narc_0560 (trainer classes)
 *   arm9/src/trainer_data.c              how the game derives a trainer mon's personality → nature, ability, gender
 *   arm9/src/map_header.c                every map's Town Map section (mapsec) and its zone-event file
 *   files/fielddata/eventdata/zone_event_release/narc_NNNN.bin   per-zone objects and warps (binary; same layout as Platinum's)
 * Zone scripts are compiled bytecode, so what they give (items, mart stock, NPC text) isn't read: locations, the trainers
 * standing in them, warps between places, Pokémon Centers and gyms are.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AtlasFile, AtlasGym, AtlasItemInfo, AtlasLocation, AtlasMon, AtlasTrainer, LocationKind, TrainerKind } from '../../src/domain/atlasTypes.ts';
import { ensure } from '../sources.ts';
import { Dex } from '@pkmn/dex';
import { NATURES, OUT, cid, cleanText, readJSON, title } from './common.ts';

const COMMIT = '5bc4b1a3d8f100f77a4c64e59a0d544a0e29b3ec';
const read = (dir: string, f: string) => readFileSync(resolve(dir, f), 'utf8');

function defines(src: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of src.matchAll(/^#define\s+(\w+)\s+(-?\d+|0x[0-9a-fA-F]+)\b/gm)) out.set(m[1], Number(m[2]));
  return out;
}

/** `narc_0344_00001` → text, for one English GMM bank. */
function bank(dir: string, n: string): Map<number, string> {
  const out = new Map<number, string>();
  const src = read(dir, `files/msgdata/msg/${n}.gmm`);
  const dec = (s: string) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const m of src.matchAll(/<row id="[^"]+" index="(\d+)"[^>]*>[\s\S]*?<language name="English">([\s\S]*?)<\/language>/g)) out.set(Number(m[1]), dec(m[2]));
  return out;
}

/** Scripted battles aren't trainer objects, so these are placed by hand: class → the map they're fought in (and the badge a gym leader gives). */
const SCRIPTED: Record<string, { map: string; badge?: string }> = {
  LEADER_ROARK: { map: 'MAP_OREBURGH_GYM', badge: 'Coal Badge' },
  LEADER_GARDENIA: { map: 'MAP_ETERNA_GYM', badge: 'Forest Badge' },
  LEADER_MAYLENE: { map: 'MAP_VEILSTONE_GYM', badge: 'Cobble Badge' },
  LEADER_WAKE: { map: 'MAP_PASTORIA_GYM', badge: 'Fen Badge' },
  LEADER_FANTINA: { map: 'MAP_HEARTHOME_GYM_LEADER_ROOM', badge: 'Relic Badge' },
  LEADER_BYRON: { map: 'MAP_CANALAVE_GYM', badge: 'Mine Badge' },
  LEADER_CANDICE: { map: 'MAP_SNOWPOINT_GYM', badge: 'Icicle Badge' },
  LEADER_VOLKNER: { map: 'MAP_SUNYSHORE_GYM_ROOM_3', badge: 'Beacon Badge' },
  ELITE_FOUR_AARON: { map: 'MAP_POKEMON_LEAGUE_AARON_ROOM' },
  ELITE_FOUR_BERTHA: { map: 'MAP_POKEMON_LEAGUE_BERTHA_ROOM' },
  ELITE_FOUR_FLINT: { map: 'MAP_POKEMON_LEAGUE_FLINT_ROOM' },
  ELITE_FOUR_LUCIEN: { map: 'MAP_POKEMON_LEAGUE_LUCIAN_ROOM' },
  CHAMPION: { map: 'MAP_POKEMON_LEAGUE_CYNTHIA_ROOM' },
};

const kindOf = (id: string): LocationKind => {
  if (/sea-route/.test(id)) return 'sea-route';
  if (/route/.test(id) && !/cabin|house|move-tutor|coffee/.test(id)) return 'route';
  if (/-city$/.test(id)) return 'city';
  if (/-town$/.test(id)) return 'town';
  if (/cave|mine|tunnel|ruins|forest|chamber|mt-|mountain|island|path|marsh|victory-road|pillar|hall-of-origin|distortion|lake(?!front)|hq|spring|lost-tower|windworks|ironworks|chateau/.test(id)) return /hq|lost-tower|chateau|windworks|ironworks/.test(id) ? 'dungeon' : 'cave';
  if (/lakefront|meadow|garden|area|square|paradise|lighthouse|league|frontier|pal-park|great-marsh|fight|museum|statue|pier|gateway/.test(id)) return 'landmark';
  return 'building';
};

const kindFor = (cls: string): TrainerKind =>
  /LEADER_/.test(cls) ? 'leader' : /ELITE_FOUR/.test(cls) ? 'elite-four' : /CHAMPION/.test(cls) ? 'champion' : /BARRY|RIVAL/.test(cls) ? 'rival' : /COMMANDER|GALACTIC/.test(cls) ? 'boss' : /PKMN_TRAINER_/.test(cls) ? 'other' : 'trainer';

export function buildDp(): { file: AtlasFile; gaps: string } {
  const dir = ensure('pokediamond', ['files/poketool', 'files/msgdata/msg', 'include/constants', 'arm9/src/trainer_data.c']);
  const itemNames = bank(dir, 'narc_0344');
  const classNames = bank(dir, 'narc_0560');
  const itemDefs = defines(read(dir, 'include/constants/items.h'));
  const trainerDefs = defines(read(dir, 'include/constants/trainers.h'));
  const classDefs = defines(read(dir, 'include/constants/trainer_classes.h'));
  const pid = (s: string) => s.replace(/^(SPECIES|MOVE|ITEM|ABILITY)_/, '');

  const personal = readJSON<{ baseStats: { species: string; types: string[]; abilities: string[]; genderRatio: number }[] }>(resolve(dir, 'files/poketool/personal/personal.json')).baseStats;
  const speciesNum = new Map(personal.map((p, i) => [p.species, i]));
  const learn = new Map(readJSON<{ wotbl: { species: string; moves: { move: string; level: number }[] }[] }>(resolve(dir, 'files/poketool/personal/wotbl.json')).wotbl.map((w) => [w.species, w.moves]));

  // class → gender selector (1 = female, 0x78; anything else 0x88)
  const genderTbl = [...(/sTrainerClassGenderCountTbl\[\]\s*=\s*\{([\s\S]*?)\};/.exec(read(dir, 'arm9/src/trainer_data.c'))?.[1] ?? '').matchAll(/\/\*(TRAINER_CLASS_\w+)\*\/\s*(\d+)/g)];
  const classGender = new Map(genderTbl.map((m) => [m[1], Number(m[2])]));

  const items: Record<string, AtlasItemInfo> = {};
  const itemId = (c: string): string => {
    const id = cid(c);
    const n = itemDefs.get(c);
    const name = n === undefined ? undefined : cleanText(itemNames.get(n) ?? '');
    items[id] ??= { name: name || title(pid(c).toLowerCase()), price: 0, description: '', pocket: '' };
    return id;
  };

  const tj = readJSON<{ trdata: { index: number; type: string; class: string; name: string; items: string[]; doubleBattle: number; party: { difficulty: number; level: number; species: string; item?: string; moves?: string[] }[] }[] }>(resolve(dir, 'files/poketool/trainer/trdata.json')).trdata;
  const constById = new Map<number, string>();
  for (const [k, v] of trainerDefs) if (k.startsWith('TRAINER_') && !constById.has(v)) constById.set(v, k);

  const trainers: Record<string, AtlasTrainer> = {};
  for (const t of tj) {
    const tid = constById.get(t.index);
    if (!t.party.length || !tid) continue;
    const classIdx = classDefs.get(t.class) ?? 0;
    const gender = classGender.get(t.class) === 1 ? 0x78 : 0x88;
    const party: AtlasMon[] = t.party.map((p) => {
      const name = pid(p.species);
      const sn = speciesNum.get(name) ?? 0;
      const sp = personal[sn];
      const mon: AtlasMon = { species: cid(p.species), level: p.level, iv: Math.floor((p.difficulty * 31) / 255), moves: [] };
      if (p.item && p.item !== 'ITEM_NONE') mon.item = itemId(p.item);
      if (p.moves?.length) mon.moves = p.moves.filter((m) => m !== 'MOVE_NONE').map(cid);
      else {
        const learned: string[] = [];
        for (const m of learn.get(name) ?? []) if (m.level <= p.level && !learned.includes(m.move)) learned.push(m.move);
        mon.moves = learned.slice(-4).map(cid);
        mon.movesDerived = true;
      }
      let state = (p.difficulty + p.level + sn + t.index) >>> 0;
      let rnd = state;
      for (let j = 0; j < classIdx; j++) {
        state = (Math.imul(state, 1103515245) + 24691) >>> 0;
        rnd = state >>> 16;
      }
      const pers = (((rnd << 8) >>> 0) + gender) >>> 0;
      mon.nature = NATURES[pers % 25];
      const [a1, a2] = sp.abilities;
      const ab = a2 && a2 !== 'ABILITY_NONE' ? (pers & 1 ? a2 : a1) : a1;
      if (ab && ab !== 'ABILITY_NONE') mon.ability = cid(ab);
      const g = sp.genderRatio;
      const ratio = g < 0 || g > 1 ? 255 : g === 0 ? 0 : g >= 1 ? 254 : Math.min(254, Math.floor(255 * g));
      mon.gender = ratio === 255 ? 'N' : ratio === 254 ? 'F' : ratio === 0 ? 'M' : (pers & 0xff) >= ratio ? 'M' : 'F';
      return mon;
    });
    const clsName = cleanText((classNames.get(classDefs.get(t.class) ?? -1) ?? '').replace(/₧₦/g, 'Pokémon')) || title(pid(t.class.replace('TRAINER_CLASS_', '')).toLowerCase());
    const rm = /^(TRAINER_\w+?)_(\d+)$/.exec(tid);
    const base = rm && trainerDefs.has(rm[1]) ? rm[1] : undefined;
    trainers[tid] = {
      id: tid, name: (t.class === 'TRAINER_CLASS_PKMN_TRAINER_BARRY' ? 'Barry' : t.name.replace(/\{TRNAME\}/g, '').trim()) || clsName, cls: clsName, kind: kindFor(t.class), party, group: base ?? tid, order: base ? Number(rm![2]) - 1 : 0,
      ...(base ? { variant: `Battle ${Number(rm![2])}` } : {}),
      ...(t.doubleBattle ? { double: true } : {}),
      ...(t.items?.length ? { bag: t.items.map(itemId) } : {}),
    };
  }

  // --- maps: header table → place, zone events → trainers and warps ---------------------------
  const maps = readJSON<{ maps: Record<string, { places: Record<string, unknown>; labels?: Record<string, string> }> }>(resolve(OUT, 'maps.json')).maps['sinnoh-pt'];
  const pokedex = readJSON<{ areas: { loc: string; name: string }[] }>(resolve(OUT, 'pokedex-gen4.json'));
  const areaName = new Map(pokedex.areas.map((a) => [a.loc, a.name]));
  const placeIds = new Set(Object.keys(maps.places));
  const locations: Record<string, AtlasLocation> = {};
  for (const id of placeIds) {
    locations[id] = { id, name: areaName.get(id) ?? maps.labels?.[id] ?? title(id.replace(/^sinnoh-/, '')), kind: kindOf(id), maps: [], connections: [], pokecenter: false, shops: [], obstacles: [], items: [], npcs: [], trainers: [], events: [] };
  }
  const sectionPlace = (sec: string): string | undefined => {
    const k = sec.replace('MAPSEC_', '').toLowerCase().replace(/_/g, '-');
    return [k, `sinnoh-${k}`].find((c) => placeIds.has(c));
  };
  const headerSrc = read(dir, 'arm9/src/map_header.c');
  const headers = [...headerSrc.matchAll(/NARC_zone_event_release_narc_(\d+)_bin,\s*(MAPSEC_\w+),[^}]*\},\s*\/\/\s*(MAP_\w+)/g)].map((m) => ({ ev: m[1], sec: m[2], map: m[3] }));
  const placeOfMap = headers.map((h) => sectionPlace(h.sec));
  const unmappedSections = new Set<string>();
  const trainerPlace = new Map<string, string>();
  const connections = new Map<string, Set<string>>();
  const trainerOfIndex = new Map(tj.map((t) => [t.index, constById.get(t.index)]));
  headers.forEach((h, mapIdx) => {
    const place = placeOfMap[mapIdx];
    if (!place) {
      if (h.sec !== 'MAPSEC_MYSTERY_ZONE') unmappedSections.add(h.sec);
      return;
    }
    const loc = locations[place];
    loc.maps.push(h.map.replace('MAP_', '').toLowerCase());
    if (/POKECENTER(_1F)?$/.test(h.map)) loc.pokecenter = true;
    const d = readFileSync(resolve(dir, `files/fielddata/eventdata/zone_event_release/narc_${h.ev}.bin`));
    if (d.length < 4) return;
    let o = 4 + d.readUInt32LE(0) * 20; // bg events
    const objN = d.readUInt32LE(o);
    for (let k = 0; k < objN; k++) {
      const at = o + 4 + k * 32;
      const trainerType = d.readUInt16LE(at + 6);
      const script = d.readUInt16LE(at + 10);
      if (trainerType && script >= 3000 && script < 3000 + 1000) {
        const tid = trainerOfIndex.get(script - 3000 + 1);
        if (tid && !trainerPlace.has(tid)) trainerPlace.set(tid, place);
      }
    }
    o += 4 + objN * 32;
    const warpN = d.readUInt32LE(o);
    for (let k = 0; k < warpN; k++) {
      const dest = placeOfMap[d.readUInt16LE(o + 4 + k * 12 + 4)];
      if (dest && dest !== place) (connections.get(place) ?? connections.set(place, new Set()).get(place)!).add(dest);
    }
  });
  const classOf = new Map(tj.map((t) => [constById.get(t.index), t.class.replace('TRAINER_CLASS_', '')]));
  for (const t of Object.values(trainers)) {
    const sc = SCRIPTED[classOf.get(t.group) ?? ''];
    const at = sc && headers.findIndex((h) => h.map === sc.map);
    if (sc && at !== undefined && at >= 0 && placeOfMap[at] && !trainerPlace.has(t.group)) trainerPlace.set(t.group, placeOfMap[at]!);
  }
  const unplaced: string[] = [];
  for (const t of Object.values(trainers)) {
    const p = trainerPlace.get(t.id) ?? trainerPlace.get(t.group);
    if (p) {
      t.loc = p;
      locations[p].trainers.push(t.id);
    } else unplaced.push(t.id);
  }
  const order = [...constById.values()];
  for (const l of Object.values(locations)) l.trainers.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const gen4 = Dex.forGen(4);
  const badges: string[] = [];
  for (const l of Object.values(locations)) {
    const leader = l.trainers.map((id) => trainers[id]).find((t) => t.kind === 'leader' && t.order === 0);
    const badge = SCRIPTED[classOf.get(leader?.id) ?? '']?.badge;
    if (!leader || !badge) continue;
    const counts = new Map<string, number>();
    for (const m of leader.party) for (const ty of gen4.species.get(m.species)?.types ?? []) counts.set(ty, (counts.get(ty) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(a[0] === 'Normal') - Number(b[0] === 'Normal'))[0]?.[0];
    const gym: AtlasGym = { leader: leader.name, badge, levelCap: Math.max(...leader.party.map((m) => m.level)), ...(top ? { type: top } : {}) };
    l.gym = gym;
    if (!badges.includes(badge)) badges.push(badge);
  }
  for (const [pl, dests] of connections) locations[pl].connections = [...dests].sort();
  const sorted: Record<string, AtlasLocation> = {};
  for (const id of Object.keys(locations).sort()) sorted[id] = locations[id];

  const file: AtlasFile = {
    version: 1, game: 'diamond', name: 'Pokémon Diamond', generation: 4, source: { repo: 'pret/pokediamond', commit: COMMIT },
    locations: sorted, trainers, items, unplaced, badges, unverified: {},
  };
  const L = Object.values(sorted);
  const gaps = [
    '# Atlas data gaps — Pokémon Diamond / Pearl',
    '',
    `Generated by \`npm run atlas\` (scripts/atlas/dp.ts); do not edit. Source: pret/pokediamond @ \`${COMMIT.slice(0, 10)}\`. Pearl uses this file too.`,
    '',
    '| What | Found | Expected | Notes |',
    '|---|---|---|---|',
    `| Town-map places with data | ${L.filter((l) => l.maps.length).length} | ${L.length} | no zone folded in: ${L.filter((l) => !l.maps.length).map((l) => l.id).join(', ') || '—'} |`,
    `| Trainers with full teams | ${Object.keys(trainers).length} | ${tj.filter((t) => t.party.length).length} | unplaced on a location: ${unplaced.length} |`,
    `| Gyms with leader, badge, level cap | ${L.filter((l) => l.gym).length} | 8 | badge names are hand-written (the scripts that give them are binary) |`,
    '| Items, NPCs, shops | 0 | — | zone scripts are compiled bytecode, so what they give, say or sell is not read |',
    `| Map sections without a Town Map place | ${unmappedSections.size} | — | ${[...unmappedSections].slice(0, 40).join(', ') || '—'} |`,
    '',
    '## Known limits',
    '',
    '- Trainers are placed by the trainer objects in each zone (script id 3000 + trainer number − 1); use Platinum for items, NPCs and shops.',
    '- Nature, ability and gender of trainer mons use the same personality rule as arm9/src/trainer_data.c; not cross-checked against a second source.',
    '- The rival is named after the player-chosen / story name; the data holds a placeholder ("Cedric"), so the Barry class is shown as Barry.',
    '- Trainer quotes are not read (the trainer message archive is binary).',
    '- Diamond and Pearl share trainer data; Pearl-only differences (personal_pearl) are not applied.',
    '',
  ].join('\n');
  return { file, gaps };
}
