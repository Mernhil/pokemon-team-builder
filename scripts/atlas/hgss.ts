/**
 * HeartGold / SoulSilver atlas, from the pret/pokeheartgold decompilation:
 *   files/poketool/trainer/trainers.json          every trainer: class, name, party (level, species, item, moves, IV "difficulty")
 *   files/poketool/personal/{personal.json,wotbl.narc}   types, abilities, gender ratios; level-up learnsets (binary NARC)
 *   files/fielddata/eventdata/zone_event/*.json   per-zone objects (NPCs, trainers, item balls), hidden items, warps
 *   files/fielddata/script/scr_seq/scr_seq_NNNN_<Zone>.s + msgdata/msg/*.gmm   what NPCs say and give
 *   src/data/map_headers.h                        the region-map section (Town Map place) of every zone
 *   src/data/fieldmap/hidden_items.h, scr_seq_0141 (item balls), src/item.c (TM/HM moves), item_data.csv (prices)
 *   src/trainer_data.c                            how the game derives a trainer mon's personality → nature, ability, gender
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Dex } from '@pkmn/dex';
import type { AtlasFile, AtlasGym, AtlasItemInfo, AtlasLocation, AtlasMon, AtlasNpc, AtlasShopItem, AtlasTrainer, LocationKind, TrainerKind } from '../../src/domain/atlasTypes.ts';
import { ensure } from '../sources.ts';
import { NATURES, OUT, cid, cleanText, readJSON, title } from './common.ts';

const COMMIT = '9d8b7591f09b65804da2fb2dfd56f320633e0d36';
const read = (dir: string, f: string) => readFileSync(resolve(dir, f), 'utf8');

/** Section constants whose place id isn't the kebab-case of the name. */
const SECTION_ALIASES: Record<string, string> = {
  MAPSEC_MT_SILVER: 'mt-silver',
  MAPSEC_SILVER_CAVE: 'mt-silver',
  MAPSEC_UNDERGROUND_PATH: 'underground',
  MAPSEC_VICTORY_ROAD: 'kanto-victory-road-1',
  MAPSEC_INDIGO_PLATEAU: 'indigo-plateau',
};

/** All `#define NAME value` of a header with a plain integer value. */
function defines(src: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of src.matchAll(/^#define\s+(\w+)\s+(-?\d+|0x[0-9a-fA-F]+)\b/gm)) out.set(m[1], Number(m[2]));
  return out;
}

/** The members of a NARC archive. */
function readNarc(buf: Buffer): Buffer[] {
  if (buf.toString('ascii', 0, 4) !== 'NARC') throw new Error('not a NARC');
  let pos = buf.readUInt16LE(12); // header size
  const btaf = pos;
  const count = buf.readUInt16LE(btaf + 8);
  const entries: [number, number][] = [];
  for (let i = 0; i < count; i++) entries.push([buf.readUInt32LE(btaf + 12 + i * 8), buf.readUInt32LE(btaf + 16 + i * 8)]);
  pos = btaf + buf.readUInt32LE(btaf + 4); // BTNF
  pos += buf.readUInt32LE(pos + 4); // GMIF
  const data = pos + 8;
  return entries.map(([s, e]) => buf.subarray(data + s, data + e));
}

/** `msg_0373_R29_00005` → text, from every English GMM bank. */
function loadMessages(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const base = resolve(dir, 'files/msgdata/msg');
  const dec = (s: string) => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  for (const f of readdirSync(base).filter((x) => x.endsWith('.gmm'))) {
    const src = readFileSync(resolve(base, f), 'utf8');
    for (const m of src.matchAll(/<row id="([^"]+)"[^>]*>[\s\S]*?<language name="English">([\s\S]*?)<\/language>/g)) out.set(m[1], dec(m[2]));
  }
  return out;
}

const tidyText = (raw: string) =>
  cleanText(
    raw
      .replace(/\\f/g, '\n')
      .replace(/\\r/g, '\n')
      .replace(/\\n/g, ' ')
      .replace(/\{STRVAR_\d[^}]*\}|\{PLAYER[^}]*\}/g, '[name]')
      .replace(/\{[^}]*\}/g, '')
      .replace(/[-]/g, ''),
  );

export function buildHgss(): { file: AtlasFile; gaps: string } {
  const dir = ensure('pokeheartgold', ['files/poketool', 'files/fielddata', 'files/msgdata', 'files/itemtool', 'include', 'src/data', 'src/item.c', 'src/trainer_data.c', 'src/scrcmd_mart.c']);
  const gen4 = Dex.forGen(4);
  const allMaps = readJSON<{ maps: Record<string, { places: Record<string, unknown> }> }>(resolve(OUT, 'maps.json')).maps;
  const mapIds = ['johto-gsc', 'kanto-gsc'];
  const placeIds = new Set(mapIds.flatMap((m) => Object.keys(allMaps[m].places)));
  const pokedex = readJSON<{ games: { id: string }[]; areas: { loc: string; name: string }[]; encounters: Record<string, number[][]> }>(resolve(OUT, 'pokedex-gen4.json'));
  const areaName = new Map(pokedex.areas.map((a) => [a.loc, a.name]));
  const msgs = loadMessages(dir);
  const msg = (id: string) => msgs.get(id);

  // --- constants -------------------------------------------------------------------------------
  const speciesConst = new Map([...defines(read(dir, 'include/constants/species.h'))].filter(([k]) => k.startsWith('SPECIES_')).map(([k, v]) => [v, k]));
  const moveConst = new Map([...defines(read(dir, 'include/constants/moves.h'))].filter(([k]) => k.startsWith('MOVE_') && !k.startsWith('MOVE_ATTRIBUTE_')).map(([k, v]) => [v, k]));
  const itemDefs = defines(read(dir, 'include/constants/items.h'));
  const itemConst = new Map<number, string>();
  for (const [k, v] of itemDefs) if (k.startsWith('ITEM_') && !itemConst.has(v) && !/_(START|END|COUNT)$/.test(k) && !/^ITEM_(TM|HM)\d+_/.test(k)) itemConst.set(v, k);
  const trainerDefs = defines(read(dir, 'include/constants/trainers.h'));
  const classDefs = defines(read(dir, 'include/constants/trainer_class.h'));
  const stdDefs = defines(read(dir, 'include/constants/std_script.h'));

  // --- items -----------------------------------------------------------------------------------
  const tmSrc = read(dir, 'src/item.c');
  const tmMoves = [...(/sTMHMMoves\[\]\s*=\s*\{([^}]*)\}/.exec(tmSrc)?.[1] ?? '').matchAll(/MOVE_\w+/g)].map((m) => m[0]);
  const csv = read(dir, 'files/itemtool/itemdata/item_data.csv').split('\n').slice(1).map((l) => l.split(','));
  const price = new Map(csv.map((r) => [r[0], Number(r[1])]));
  const items: Record<string, AtlasItemInfo> = {};
  const itemId = (c: string): string => {
    const t = /^ITEM_(TM|HM)(\d+)$/.exec(c);
    return t ? `${t[1].toLowerCase()}${t[2]}` : cid(c);
  };
  for (const [v, c] of itemConst) {
    const name = msg(`msg_0222_${String(v).padStart(5, '0')}`);
    if (!name || c === 'ITEM_NONE' || /^\?+$/.test(name) || name === 'None') continue;
    const desc = msg(`msg_0221_${String(v).padStart(5, '0')}`);
    const tm = /^ITEM_(TM|HM)(\d+)$/.exec(c);
    const moveC = tm ? tmMoves[tm[1] === 'TM' ? Number(tm[2]) - 1 : 92 + Number(tm[2]) - 1] : undefined;
    const mv = moveC ? cid(moveC) : undefined;
    items[itemId(c)] = {
      name: tm ? `${tm[1]}${tm[2]}` : name,
      price: price.get(c) ?? 0,
      description: desc ? tidyText(desc) : '',
      pocket: (csv.find((r) => r[0] === c)?.[11] ?? '').replace('POCKET_', '').toLowerCase(),
      ...(mv && gen4.moves.get(mv).exists ? { move: mv, moveType: gen4.moves.get(mv).type } : {}),
    };
  }

  // --- species ---------------------------------------------------------------------------------
  const personal = readJSON<{ baseStats: { species: string; types: string[]; abilities: string[]; genderRatio: number }[] }>(resolve(dir, 'files/poketool/personal/personal.json')).baseStats;
  const learn = readNarc(readFileSync(resolve(dir, 'files/poketool/personal/wotbl.narc'))).map((b) => {
    const out: [number, string][] = [];
    for (let i = 0; i + 1 < b.length; i += 2) {
      const v = b.readUInt16LE(i);
      if (v === 0xffff) break;
      out.push([v >> 9, moveConst.get(v & 0x1ff) ?? `MOVE_${v & 0x1ff}`]);
    }
    return out;
  });
  const speciesData = (id: number) => {
    const p = personal[id];
    if (!p) return undefined;
    const g = p.genderRatio;
    const ratio = g < 0 || g > 1 ? 255 : g === 0 ? 0 : g >= 1 ? 254 : Math.min(254, Math.floor(255 * g));
    return { types: [...new Set(p.types)].map((t) => title(t.replace('TYPE_', '').toLowerCase())), abilities: p.abilities, ratio, learn: learn[id] ?? [] };
  };

  // --- trainers --------------------------------------------------------------------------------
  const tj = readJSON<{ trainers: { type: string; class: string; name: string; items: string[]; double: number; party: { difficulty: number; genderOverride: string; abilityOverride: string; level: number; species: string; item?: string; moves?: string[] }[]; messages: { type: string; message: string }[] }[] }>(resolve(dir, 'files/poketool/trainer/trainers.json')).trainers;
  const genderSrc = read(dir, 'src/trainer_data.c');
  const classFemale = new Map<string, boolean>();
  for (const m of genderSrc.matchAll(/TRAINER_(MALE|FEMALE|DOUBLE),\s*\/\/\s*(TRAINERCLASS_\w+)/g)) classFemale.set(m[2], m[1] === 'FEMALE');
  const classNameMsg = (cls: string) => {
    const idx = classDefs.get(cls);
    const t = idx === undefined ? undefined : msg(`msg_0730_${String(idx).padStart(5, '0')}`);
    return t ? tidyText(t) : title(cls.replace('TRAINERCLASS_', '').toLowerCase());
  };
  const trainerConstById = new Map<number, string>();
  for (const [k, v] of trainerDefs) if (k.startsWith('TRAINER_') && !trainerConstById.has(v)) trainerConstById.set(v, k);
  const constOfTrainer = (n: number) => trainerConstById.get(n);
  const kindFor = (cls: string): TrainerKind =>
    /LEADER/.test(cls) ? 'leader' : /ELITE_FOUR|CHAMPION_LANCE|PKMN_TRAINER_LANCE/.test(cls) && !/LEADER/.test(cls) ? (/LANCE/.test(cls) ? 'champion' : 'elite-four') : /RIVAL/.test(cls) ? 'rival' : /EXECUTIVE|ROCKET|GRUNT|ADMIN/.test(cls) ? 'boss' : /PKMN_TRAINER_(RED|ETHAN|LYRA)|PROF|SCIENTIST_GS/.test(cls) ? 'other' : 'trainer';
  const trainers: Record<string, AtlasTrainer> = {};
  const unverified: Record<string, string[]> = {};
  const learnedMoves = (speciesNum: number, level: number): string[] => {
    const learned: string[] = [];
    for (const [lv, mv] of speciesData(speciesNum)?.learn ?? []) if (lv <= level && !learned.includes(mv)) learned.push(mv);
    return learned.slice(-4);
  };
  const speciesNumber = new Map([...speciesConst].map(([v, k]) => [k, v]));
  tj.forEach((t, id) => {
    if (!t.party.length) return;
    const tid = constOfTrainer(id);
    if (!tid) return;
    const cls = t.class;
    const classIdx = classDefs.get(cls) ?? 0;
    const female = classFemale.get(cls) ?? false;
    const party: AtlasMon[] = t.party.map((p) => {
      const sn = speciesNumber.get(p.species) ?? 0;
      const sd = speciesData(sn);
      const mon: AtlasMon = { species: cid(p.species), level: p.level, iv: Math.floor(((p.difficulty & 0xff) * 31) / 255), moves: [] };
      if (p.item && p.item !== 'ITEM_NONE') mon.item = itemId(p.item);
      if (p.moves?.length) mon.moves = p.moves.filter((m) => m !== 'MOVE_NONE').map(cid);
      else {
        mon.moves = learnedMoves(sn, p.level).map(cid);
        mon.movesDerived = true;
      }
      const overridden = p.genderOverride !== 'TRPOKE_GENDER_OVERRIDE_OFF' || p.abilityOverride !== 'TRPOKE_ABILITY_OVERRIDE_OFF';
      if (sd && !overridden) {
        let seed = ((p.difficulty & 0xff) + p.level + sn + id) >>> 0;
        let rnd = seed;
        for (let j = 0; j < classIdx; j++) {
          seed = (Math.imul(seed, 1103515245) + 24691) >>> 0;
          rnd = seed >>> 16;
        }
        const pid = (((rnd << 8) >>> 0) + (female ? 0x78 : 0x88)) >>> 0;
        mon.nature = NATURES[pid % 25];
        const [a1, a2] = sd.abilities;
        const ab = a2 && a2 !== 'ABILITY_NONE' ? (pid & 1 ? a2 : a1) : a1;
        if (ab && ab !== 'ABILITY_NONE') mon.ability = cid(ab);
        mon.gender = sd.ratio === 255 ? 'N' : sd.ratio === 254 ? 'F' : sd.ratio === 0 ? 'M' : (pid & 0xff) >= sd.ratio ? 'M' : 'F';
      } else if (overridden) (unverified[tid] ??= []).push(`${cid(p.species)}: the game overrides its gender / ability, so nature, ability and gender aren't derived`);
      return mon;
    });
    const rm = /^(TRAINER_\w+?)_(\d+)$/.exec(tid);
    const quoteLose = t.messages.find((m) => m.type === 'TRMSG_LOSE')?.message;
    const quotePre = t.messages.find((m) => m.type === 'TRMSG_FIGHT' || m.type === 'TRMSG_FIGHT_1' || m.type === 'TRMSG_FIGHT_PRE')?.message;
    const base = rm && trainerDefs.has(rm[1]) ? rm[1] : undefined;
    trainers[tid] = {
      id: tid, name: (t.name.replace(/\{TRNAME\}/g, '').trim() || classNameMsg(cls)), cls: classNameMsg(cls), kind: kindFor(cls), party,
      group: base ?? tid, order: base ? Number(rm![2]) - 1 : 0,
      ...(t.double ? { double: true } : {}),
      ...(t.items?.length ? { bag: t.items.map(itemId) } : {}),
      ...(quoteLose || quotePre ? { quote: { ...(quotePre ? { pre: tidyText(quotePre) } : {}), ...(quoteLose ? { defeat: tidyText(quoteLose) } : {}) } } : {}),
      ...(base ? { variant: `Rematch ${Number(rm![2]) - 1}` } : {}),
    };
  });

  // --- zones: map headers, events, scripts ------------------------------------------------------
  const headers = read(dir, 'src/data/map_headers.h');
  const zoneSection = new Map<string, string>(); // zone name (R29) → MAPSEC
  const mapIdSection = new Map<string, string>(); // MAP_X → MAPSEC
  for (const m of headers.matchAll(/\[(MAP_\w+)\]\s*=\s*\{([\s\S]*?)\n\s*\},/g)) {
    const ev = /NARC_zone_event_\d+_(\w+)_bin/.exec(m[2])?.[1];
    const sec = /\.mapsec\s*=\s*(MAPSEC_\w+)/.exec(m[2])?.[1];
    if (sec) mapIdSection.set(m[1], sec);
    if (ev && sec) zoneSection.set(ev, sec);
  }
  const sectionPlace = (sec: string | undefined): string | undefined => {
    if (!sec) return undefined;
    if (SECTION_ALIASES[sec]) return placeIds.has(SECTION_ALIASES[sec]) ? SECTION_ALIASES[sec] : undefined;
    const k = sec.replace('MAPSEC_', '').toLowerCase().replace(/_/g, '-');
    return [k, `johto-${k}`, `kanto-${k}`, `johto-sea-${k}`, `kanto-sea-${k}`].find((c) => placeIds.has(c));
  };

  const scriptDir = resolve(dir, 'files/fielddata/script/scr_seq');
  const zoneScripts = new Map<string, { labels: Map<string, string[]>; text: string }>();
  for (const f of readdirSync(scriptDir).filter((x) => /^scr_seq_\d{4}_\w+\.s$/.test(x))) {
    const zone = /^scr_seq_\d{4}_(\w+)\.s$/.exec(f)![1].replace(/_hdr$/, '');
    if (/_hdr$/.test(f.replace('.s', ''))) continue;
    const src = readFileSync(resolve(scriptDir, f), 'utf8');
    const labels = new Map<string, string[]>();
    let cur: string[] | undefined;
    for (const raw of src.split('\n')) {
      const l = raw.replace(/@.*$/, '').trim();
      const lab = /^(\w+):$/.exec(l);
      if (lab) labels.set(lab[1], (cur = []));
      else if (l && cur) cur.push(l);
    }
    zoneScripts.set(zone, { labels, text: src });
  }
  const reach = (labels: Map<string, string[]>, start: string, limit = 40): string[] => {
    const seen: string[] = [];
    const queue = [start];
    while (queue.length && seen.length < limit) {
      const l = queue.shift()!;
      if (seen.includes(l) || !labels.has(l)) continue;
      seen.push(l);
      for (const line of labels.get(l)!) {
        const m = /^(?:GoTo|GoToIf\w+|CallIf\w+|Call)\s+(?:[^,]+,\s*)?(_\w+|scr_seq_\w+)$/.exec(line) ?? /^(?:GoTo|Call)\s+(_\w+|scr_seq_\w+)$/.exec(line);
        if (m) queue.push(m[1]);
      }
    }
    return seen;
  };
  const itemBallScripts = readFileSync(resolve(scriptDir, 'scr_seq_0141.s'), 'utf8');
  const itemBallLabels = new Map<string, string[]>();
  {
    let cur: string[] | undefined;
    for (const raw of itemBallScripts.split('\n')) {
      const l = raw.trim();
      const lab = /^(scr_seq_0141_\d+):$/.exec(l);
      if (lab) itemBallLabels.set(lab[1], (cur = []));
      else if (l && cur) cur.push(l);
    }
  }
  const hiddenItemTable = [...(/sHiddenItemParam\[\]\s*=\s*\{([\s\S]*?)\n\};/.exec(read(dir, 'src/data/fieldmap/hidden_items.h'))?.[1] ?? '').matchAll(/\{\s*(ITEM_\w+),\s*(\d+)/g)].map((m) => ({ item: m[1], qty: Number(m[2]) }));

  // Poké Mart stock: src/scrcmd_mart.c (common badge-tiered list; special lists indexed by VAR_SPECIAL_x8004)
  const martSrc = readFileSync(resolve(dir, 'src/scrcmd_mart.c'), 'utf8');
  const martLists = new Map<string, string[]>();
  for (const m of martSrc.matchAll(/const u16 (\w+)\[\]\s*=\s*\{([^}]*)\}/g)) martLists.set(m[1], [...m[2].matchAll(/ITEM_\w+/g)].map((x) => x[0]));
  const specialMarts = [...(/_0210FA3C\[\]\s*=\s*\{([^}]*)\}/.exec(martSrc)?.[1] ?? '').matchAll(/_\w+/g)].map((m) => martLists.get(m[0]) ?? []);
  const commonMart = [...(/_020FBF22\[\]\s*=\s*\{([\s\S]*?)\};/.exec(martSrc)?.[1] ?? '').matchAll(/\{\s*(ITEM_\w+),\s*(\d+)/g)].map((m) => ({ c: m[1], tier: Number(m[2]) }));
  const TIER_BADGES = [0, 0, 1, 3, 5, 7, 8];
  const shopItems = (cs: string[], badges?: (c: string) => number): AtlasShopItem[] =>
    cs.map((c) => ({ id: itemId(c), c })).filter((x) => items[x.id]).map((x) => ({ item: x.id, price: items[x.id].price, ...(badges ? { badges: badges(x.c) } : {}) }));

  const locations: Record<string, AtlasLocation> = {};
  const kindOf = (id: string): LocationKind => (/sea-route/.test(id) ? 'sea-route' : /route/.test(id) ? 'route' : /-city$/.test(id) ? 'city' : /-town$|island$/.test(id) ? 'town' : /cave|tunnel|mt-|forest|path|tower|hq|ruins|lake|den|power|safari|victory|falls|islands|plateau|league|woods/.test(id) ? 'cave' : 'landmark');
  for (const id of placeIds) locations[id] = { id, name: areaName.get(id) ?? title(id.replace(/^(johto|kanto)-/, '')), kind: kindOf(id), maps: [], connections: [], pokecenter: false, shops: [], obstacles: [], items: [], npcs: [], trainers: [], events: [] };

  const zoneDir = resolve(dir, 'files/fielddata/eventdata/zone_event');
  const zoneFiles = readdirSync(zoneDir).filter((f) => /^\d+_\w+\.json$/.test(f));
  const connectionsRaw = new Map<string, Set<string>>();
  const trainerPlace = new Map<string, string>();
  const unmappedZones: string[] = [];
  const badgeOf = new Map<string, string>();
  let npcTotal = 0;
  let npcWithText = 0;
  const OBSTACLE: Record<string, string> = { std_field_cut: 'Cut', std_field_strength: 'Strength', std_field_rocksmash: 'Rock Smash' };
  const stdNameOf = (s: string) => s.replace(/\(.*$/, '').trim();

  for (const f of zoneFiles) {
    const zone = /^\d+_(\w+)\.json$/.exec(f)![1];
    const sec = zoneSection.get(zone);
    const place = sectionPlace(sec);
    if (!place) {
      unmappedZones.push(`${zone} (${sec ?? 'no section'})`);
      continue;
    }
    const loc = locations[place];
    loc.maps.push(zone);
    if (/PC\d|PC_/.test(zone) || /^T\d+PC/.test(zone) || /PC0101$/.test(zone)) loc.pokecenter = true;
    const z = readJSON<{ objects?: { id: string; spriteId: string; type: number; scriptId: string | number; x: number; z: number }[]; bgs?: { scriptId: string | number; type: number; x: number; z: number }[]; warps?: { header: string }[] }>(resolve(zoneDir, f));
    const scripts = zoneScripts.get(zone);
    const sub = zone.length > 3 && /^[A-Z]\d+/.test(zone) && zone.length > /^[A-Z]\d+/.exec(zone)![0].length ? zone.slice(/^[A-Z]\d+/.exec(zone)![0].length) : undefined;
    for (const w of z.warps ?? []) {
      const t = sectionPlace(mapIdSection.get(w.header));
      if (t && t !== place) (connectionsRaw.get(place) ?? connectionsRaw.set(place, new Set()).get(place)!).add(t);
    }
    const labelOf = (sid: string | number): string | undefined => {
      const m = /^_EV_scr_seq_(\w+)_(\d+)\s*\+\s*1$/.exec(String(sid));
      return m ? `scr_seq_${m[1]}_${m[2]}` : undefined;
    };
    const saysOf = (labels: Map<string, string[]>, label: string) => {
      const out: string[] = [];
      for (const l of reach(labels, label)) for (const line of labels.get(l) ?? []) for (const t of line.matchAll(/\bmsg_\d{4}_\w+?_\d{5}\b/g)) {
        const raw = msg(t[0]);
        if (raw) {
          const c = tidyText(raw);
          if (c && !out.includes(c)) out.push(c);
        }
      }
      return out;
    };
    for (const o of z.objects ?? []) {
      const sidStr = String(o.scriptId);
      const std = stdNameOf(sidStr);
      const tr = /^std_trainer(?:_2)?\((TRAINER_\w+)\)/.exec(sidStr);
      if (tr) {
        if (trainers[tr[1]] && !trainerPlace.has(tr[1])) trainerPlace.set(tr[1], place);
        continue;
      }
      if (OBSTACLE[std]) {
        if (!loc.obstacles.includes(OBSTACLE[std])) loc.obstacles.push(OBSTACLE[std]);
        continue;
      }
      if (/^std_itemball_/.test(std)) {
        const n = stdDefs.get(std);
        const body = n === undefined ? undefined : itemBallLabels.get(`scr_seq_0141_${String(n - 7000).padStart(3, '0')}`);
        const iv = body?.map((l) => /^SetVar VAR_SPECIAL_x8008,\s*(\d+)/.exec(l)).find(Boolean);
        const qv = body?.map((l) => /^SetVar VAR_SPECIAL_x8009,\s*(\d+)/.exec(l)).find(Boolean);
        const c = iv ? itemConst.get(Number(iv[1])) : undefined;
        if (c && items[itemId(c)]) {
          const id = itemId(c);
          loc.items.push({ item: id, qty: Number(qv?.[1] ?? 1), how: items[id].move ? (id.startsWith('hm') ? 'hm' : 'tm') : 'visible', where: `${sub ? `${title(sub.toLowerCase())}: ` : ''}on the ground at tile (${o.x}, ${o.z})`, at: [o.x, o.z], respawns: false });
        }
        continue;
      }
      if (std === 'std_apricorn_tree' || /^std_/.test(std)) continue;
      const label = labelOf(o.scriptId);
      if (!label || !scripts) continue;
      const body = reach(scripts.labels, label).flatMap((l) => scripts.labels.get(l) ?? []);
      for (const line of body) for (const t of line.matchAll(/\bTRAINER_\w+/g)) if (trainers[t[0]] && !trainerPlace.has(t[0])) trainerPlace.set(t[0], place);
      const says = saysOf(scripts.labels, label);
      const gives: { item: string; qty: number }[] = [];
      for (const line of body) {
        const g = /^(?:GiveItem|AddItem|GiveItemFanfare)\s+(ITEM_\w+),\s*(\d+)/.exec(line);
        if (g && items[itemId(g[1])] && !gives.some((x) => x.item === itemId(g[1]))) gives.push({ item: itemId(g[1]), qty: Number(g[2]) });
      }
      const gm = body.map((l) => /^GiveMon\s+(SPECIES_\w+),\s*(\d+)(?:,\s*(ITEM_\w+))?/.exec(l)).find(Boolean);
      const npc: AtlasNpc = {
        name: title(o.spriteId.replace('SPRITE_', '').toLowerCase()), sprite: title(o.spriteId.replace('SPRITE_', '').toLowerCase()), says,
        role: gm ? 'gift' : gives.length ? 'gift' : 'npc', ...(sub ? { sub: title(sub.toLowerCase()) } : {}),
        ...(gives.length ? { gives } : {}),
        ...(gm ? { giftMon: { species: cid(gm[1]), level: Number(gm[2]), ...(gm[3] && gm[3] !== 'ITEM_NONE' ? { item: itemId(gm[3]) } : {}) } } : {}),
      };
      loc.npcs.push(npc);
      npcTotal++;
      if (says.length) npcWithText++;
      for (const g of gives) loc.items.push({ item: g.item, qty: g.qty, how: 'gift', where: `given by ${npc.name}`, respawns: false });
    }
    for (const b of z.bgs ?? []) {
      const sidStr = String(b.scriptId);
      if (/^std_hiddenitem_/.test(sidStr)) {
        const n = stdDefs.get(sidStr);
        const h = n === undefined ? undefined : hiddenItemTable[n - 8000];
        if (h && items[itemId(h.item)]) loc.items.push({ item: itemId(h.item), qty: h.qty, how: 'hidden', where: `${sub ? `${title(sub.toLowerCase())}: ` : ''}buried at tile (${b.x}, ${b.z}); the Itemfinder points to it`, at: [b.x, b.z], respawns: false });
      } else if (scripts && labelOf(b.scriptId)) {
        const says = saysOf(scripts.labels, labelOf(b.scriptId)!);
        if (says.length && b.type === 0) loc.npcs.push({ name: 'Sign', sprite: 'Sign', says, role: 'sign' });
      }
    }
    if (scripts) {
      const cs = scripts.text.split('\n').map((l) => l.replace(/@.*$/, '').trim());
      cs.forEach((l, i) => {
        const special = /^SetVar VAR_SPECIAL_x8004,\s*(\d+)/.exec(l);
        if (special && cs.slice(i + 1, i + 4).some((x) => x === 'CallStd std_special_mart') && specialMarts[Number(special[1])]?.length)
          {
          const its = shopItems(specialMarts[Number(special[1])]);
          if (!loc.shops.some((x) => x.name !== 'Poké Mart' && x.items.map((y) => y.item).join() === its.map((y) => y.item).join())) loc.shops.push({ name: 'Special stock', items: its });
        }
        if (l === 'CallStd std_pokemart' && !loc.shops.some((x) => x.badgeStock))
          loc.shops.push({ name: 'Poké Mart', items: shopItems(commonMart.map((x) => x.c), (c) => TIER_BADGES[commonMart.find((x) => x.c === c)!.tier]), badgeStock: true });
      });
      for (const t of scripts.text.matchAll(/\bTRAINER_\w+/g)) if (trainers[t[0]] && !trainerPlace.has(t[0])) trainerPlace.set(t[0], place);
      for (const bm of scripts.text.matchAll(/GiveBadge\s+BADGE_(\w+)/g)) badgeOf.set(place, title(bm[1].toLowerCase()));
    }
  }

  // place trainers; rematches share their first battle's place
  const unplaced: string[] = [];
  for (const t of Object.values(trainers)) {
    const p = trainerPlace.get(t.id) ?? trainerPlace.get(t.group);
    if (p) {
      t.loc = p;
      locations[p].trainers.push(t.id);
    } else unplaced.push(t.id);
  }
  const trainerOrder = [...trainerConstById.values()];
  for (const l of Object.values(locations)) l.trainers.sort((a, b) => trainerOrder.indexOf(a) - trainerOrder.indexOf(b));
  const badges: string[] = [];
  for (const [pl, badge] of badgeOf) {
    const loc = locations[pl];
    const leader = loc.trainers.map((id) => trainers[id]).find((t) => t.kind === 'leader' && t.order === 0);
    if (!leader) continue;
    const counts = new Map<string, number>();
    for (const m of leader.party) for (const ty of gen4.species.get(m.species)?.types ?? []) counts.set(ty, (counts.get(ty) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(a[0] === 'Normal') - Number(b[0] === 'Normal'))[0]?.[0];
    const gym: AtlasGym = { leader: leader.name, badge, levelCap: Math.max(...leader.party.map((m) => m.level)), ...(top ? { type: top } : {}) };
    loc.gym = gym;
    if (!badges.includes(badge)) badges.push(badge);
  }
  for (const [pl, dests] of connectionsRaw) locations[pl].connections = [...dests].sort();
  const sorted: Record<string, AtlasLocation> = {};
  for (const id of Object.keys(locations).sort()) sorted[id] = locations[id];
  const file: AtlasFile = {
    version: 1, game: 'heartgold', name: 'Pokémon HeartGold', generation: 4, source: { repo: 'pret/pokeheartgold', commit: COMMIT },
    locations: sorted, trainers, items, unplaced, badges, unverified,
  };
  const L = Object.values(sorted);
  const encounterLocs = new Set<string>();
  for (const rows of Object.values(pokedex.encounters)) for (const [g, a] of rows) if (pokedex.games[g].id === 'heartgold') encounterLocs.add(pokedex.areas[a].loc);
  const missing = [...encounterLocs].filter((l) => !sorted[l]);
  const hiddenN = L.flatMap((l) => l.items).filter((i) => i.how === 'hidden').length;
  const visibleN = L.flatMap((l) => l.items).filter((i) => i.how === 'visible' || i.how === 'tm' || i.how === 'hm').length;
  const gaps = [
    '# Atlas data gaps — Pokémon HeartGold',
    '',
    `Generated by \`npm run atlas\` (scripts/atlas/hgss.ts); do not edit. Source: pret/pokeheartgold @ \`${COMMIT.slice(0, 10)}\`. SoulSilver uses this file too: the decompilation builds both from shared data (version exclusives differ).`,
    '',
    '| What | Found | Expected | Notes |',
    '|---|---|---|---|',
    `| Town-map places with data | ${L.filter((l) => l.maps.length).length} | ${L.length} | no zone folded in: ${L.filter((l) => !l.maps.length).map((l) => l.id).join(', ') || '—'} |`,
    `| Wild-encounter locations present | ${encounterLocs.size - missing.length} | ${encounterLocs.size} | missing: ${missing.join(', ') || '—'} |`,
    `| Trainers with full teams | ${Object.keys(trainers).length} | ${tj.filter((t) => t.party.length).length} | unplaced on a location: ${unplaced.length} |`,
    `| Hidden items | ${hiddenN} | ${hiddenItemTable.length} | sHiddenItemParam entries |`,
    `| Visible items (balls, TMs) | ${visibleN} | — | std item-ball objects |`,
    `| NPCs with dialogue | ${npcWithText} | ${npcTotal} | NPCs whose reachable script shows text |`,
    `| Shops | ${L.reduce((n, l) => n + l.shops.length, 0)} | — | Common and special mart stock from src/scrcmd_mart.c; the apricorn, Game Corner and other scripted counters are not read |`,
    `| Gyms with leader, badge, level cap | ${L.filter((l) => l.gym).length} | 16 | |`,
    '',
    '## Zones not attached to a Town Map place',
    '',
    unmappedZones.length ? unmappedZones.slice(0, 80).map((m) => `- \`${m}\``).join('\n') + (unmappedZones.length > 80 ? `\n- … (${unmappedZones.length} in all)` : '') : '—',
    '',
    '## Unverified',
    '',
    Object.keys(unverified).length ? `${Object.keys(unverified).length} trainers have a Pokémon whose gender or ability the game overrides (TrMon_OverridePidGender is assembly in the decompilation); their natures are left out.` : 'Nothing is marked unverified in this build.',
    '',
    '## Known limits',
    '',
    '- Nature, ability and gender of trainer mons use the same personality rule as src/trainer_data.c; not cross-checked against a second source.',
    '- Item "where" text gives the tile in the zone matrix; there is no per-item prose in the decomp.',
    '- Wild Pokémon are read from the Pokédex encounter tables (PKHeX), not from this file.',
    '',
  ].join('\n');
  return { file, gaps };
}
