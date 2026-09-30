/**
 * Gen 2 atlases (Crystal, and Gold / Silver from pokegold), from the pret assembly:
 *   data/trainers/{parties,class_names,dvs}.asm        named trainers, their parties (levels, species, held items,
 *                                                       moves) and each class's fixed DVs
 *   data/pokemon/base_stats + evos_attacks.asm          starting moves and learnsets (for parties without moves)
 *   data/maps/maps.asm                                  the landmark (Town Map place) of every map
 *   maps/<Map>.asm                                      scripts, text, NPCs, trainers, item balls, hidden items, marts
 *   data/items/{marts,attributes,names}.asm             shop stock, prices, names
 * Gen 2 trainers have no abilities or natures; their DVs are fixed per class.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Dex } from '@pkmn/dex';
import type { AtlasFile, AtlasGym, AtlasItemInfo, AtlasLocation, AtlasMon, AtlasNpc, AtlasShop, AtlasTrainer, LocationKind, TrainerKind } from '../../src/domain/atlasTypes.ts';
import { ensure } from '../sources.ts';
import { OUT, cid, cleanText, readJSON, title } from './common.ts';

const read = (dir: string, f: string) => readFileSync(resolve(dir, f), 'utf8');
const code = (l: string) => l.replace(/;.*$/, '').trim();
const ALIASES: Record<string, string> = { psychicm: 'psychic', vicegrip: 'visegrip' };
const gid = (c: string) => {
  const id = cid(c.replace(/^(TM|HM)_/, ''));
  return ALIASES[id] ?? id;
};

interface Gen2Config {
  game: string;
  name: string;
  repo: 'pokecrystal';
  url: string;
  commit: string;
  dexGame: string;
  mapIds: string[];
  note: string;
}

export const CRYSTAL: Gen2Config = {
  game: 'crystal', name: 'Pokémon Crystal', repo: 'pokecrystal', url: 'pret/pokecrystal', commit: 'e058e4f50b3bbf7377e036b81c25a72c54656c5c', dexGame: 'crystal', mapIds: ['johto-gsc', 'kanto-gsc'],
  note: 'Gold and Silver differ from Crystal (Kanto trainers, some gifts, the Battle Tower); those differences are not in this file.',
};
export const buildCrystal = () => buildGen2(CRYSTAL);

/** Landmarks whose PokeAPI place isn't the obvious kebab-case (Silver Cave is Mt. Silver's interior). */
const LANDMARK_ALIASES: Record<string, string> = { LANDMARK_SILVER_CAVE: 'mt-silver', LANDMARK_UNDERGROUND_PATH: 'underground', LANDMARK_VICTORY_ROAD: 'kanto-victory-road-1' };

function buildGen2(cfg: Gen2Config): { file: AtlasFile; gaps: string } {
  const dir = ensure(cfg.repo, ['data', 'maps', 'constants', 'engine', 'macros', 'home']);
  const gen2 = Dex.forGen(2);
  const allMaps = readJSON<{ maps: Record<string, { places: Record<string, unknown> }> }>(resolve(OUT, 'maps.json')).maps;
  const placeIds = new Set(cfg.mapIds.flatMap((m) => Object.keys(allMaps[m].places)));
  const pokedex = readJSON<{ games: { id: string }[]; areas: { loc: string; name: string }[]; encounters: Record<string, number[][]> }>(resolve(OUT, 'pokedex-gen2.json'));
  const areaName = new Map(pokedex.areas.map((a) => [a.loc, a.name]));

  // --- constants -------------------------------------------------------------------------------
  const constList = (file: string, stop?: string) => {
    const out: string[] = [];
    for (const l of read(dir, file).split('\n')) {
      if (stop && l.includes(stop)) break;
      const m = /^\s*const\s+(\w+)/.exec(l);
      if (m) out.push(m[1]);
    }
    return out;
  };
  const speciesOrder = constList('constants/pokemon_constants.asm').filter((c) => c !== 'NO_MON' && !/^(EGG|UNOWN_|CELEBI_|NUM_)/.test(c));
  const itemOrder = constList('constants/item_constants.asm', 'add_tm').filter((c) => !/^(NUM_|FLOOR_)/.test(c));
  const itemConstSrc = read(dir, 'constants/item_constants.asm');
  const tmOrder = [...itemConstSrc.matchAll(/^\s*add_tm\s+(\w+)/gm)].map((m) => m[1]);
  const hmOrder = [...itemConstSrc.matchAll(/^\s*add_hm\s+(\w+)/gm)].map((m) => m[1]);
  const itemNames = [...read(dir, 'data/items/names.asm').matchAll(/li "([^"]*)"/g)].map((m) => m[1]);
  const priceByItem = new Map<string, number>();
  for (const m of read(dir, 'data/items/attributes.asm').matchAll(/^;\s*(\w+)\n\s*item_attribute\s+(\d+)/gm)) priceByItem.set(m[1], Number(m[2]));

  const items: Record<string, AtlasItemInfo> = {};
  const itemIdOf = (c: string): string | undefined => {
    const tm = tmOrder.indexOf(c.replace(/^TM_/, ''));
    if (/^TM_/.test(c) && tm >= 0) return `tm${String(tm + 1).padStart(2, '0')}`;
    const hm = hmOrder.indexOf(c.replace(/^HM_/, ''));
    if (/^HM_/.test(c) && hm >= 0) return `hm${String(hm + 1).padStart(2, '0')}`;
    return itemOrder.includes(c) ? gid(c) : undefined;
  };
  itemOrder.forEach((c, i) => {
    if (c === 'NO_ITEM') return;
    const nm = itemNames[i - 1];
    if (!nm || /^\?+$/.test(nm)) return;
    items[gid(c)] = { name: title(nm.toLowerCase()).replace('Poké Ball', 'Poké Ball').replace('Pokégear', 'Pokégear'), price: priceByItem.get(c) ?? 0, description: '', pocket: 'items' };
  });
  tmOrder.forEach((mv, i) => {
    const id = `tm${String(i + 1).padStart(2, '0')}`;
    items[id] = { name: `TM${String(i + 1).padStart(2, '0')}`, price: 0, description: `Teaches ${title(mv.toLowerCase())}.`, pocket: 'tm_hm', move: gid(mv), moveType: gen2.moves.get(gid(mv)).type };
  });
  hmOrder.forEach((mv, i) => {
    const id = `hm${String(i + 1).padStart(2, '0')}`;
    items[id] = { name: `HM${String(i + 1).padStart(2, '0')}`, price: 0, description: `Teaches ${title(mv.toLowerCase())}.`, pocket: 'tm_hm', move: gid(mv), moveType: gen2.moves.get(gid(mv)).type };
  });
  const itemId = (c: string) => itemIdOf(c);

  // --- species ---------------------------------------------------------------------------------
  const attacksText = read(dir, 'data/pokemon/evos_attacks.asm');
  const learnByLabel = new Map<string, [number, string][]>();
  for (const m of attacksText.matchAll(/^(\w+EvosAttacks):\n((?:(?!^\w+EvosAttacks:)[^\n]*\n?)*)/gm)) {
    const rows = m[2].split('\n').map(code).filter((l) => l.startsWith('db '));
    let i = 0;
    while (i < rows.length && rows[i] !== 'db 0') i++;
    i++;
    const moves: [number, string][] = [];
    for (; i < rows.length && rows[i] !== 'db 0'; i++) {
      const p = /^db\s+(\d+),\s*(\w+)/.exec(rows[i]);
      if (p) moves.push([Number(p[1]), p[2]]);
    }
    learnByLabel.set(m[1], moves);
  }
  const speciesData = new Map<string, { start: string[]; learn: [number, string][] }>();
  for (const sp of speciesOrder) {
    const norm = sp.toLowerCase().replace(/_/g, '');
    const f = [sp.toLowerCase(), norm].map((n) => `data/pokemon/base_stats/${n}.asm`).find((p) => existsSync(resolve(dir, p)));
    if (!f) continue;
    const mv = read(dir, f).split('\n').find((l) => /level 1 learnset/.test(l));
    const start = mv ? [...code(mv).matchAll(/\b([A-Z_]+)\b/g)].map((x) => x[1]).filter((x) => x !== 'db' && x !== 'NO_MOVE') : [];
    const label = [...learnByLabel.keys()].find((l) => l.replace(/EvosAttacks$/, '').toLowerCase() === norm);
    speciesData.set(sp, { start, learn: label ? (learnByLabel.get(label) ?? []) : [] });
  }
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

  // --- trainers --------------------------------------------------------------------------------
  const classConsts: string[] = [];
  const classIds = new Map<string, string[]>();
  {
    let cur = '';
    for (const l of read(dir, 'constants/trainer_constants.asm').split('\n')) {
      const tc = /^\s*trainerclass\s+(\w+)/.exec(l);
      if (tc) {
        cur = tc[1];
        classConsts.push(cur);
        classIds.set(cur, []);
        continue;
      }
      const c = /^\s*const\s+(\w+)/.exec(l);
      if (c && cur && classIds.has(cur)) classIds.get(cur)!.push(c[1]);
    }
  }
  const classNames = [...read(dir, 'data/trainers/class_names.asm').matchAll(/li "([^"]*)"/g)].map((m) => m[1]);
  const classDvs = [...read(dir, 'data/trainers/dvs.asm').matchAll(/^\s*dn\s+(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/gm)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]);
  const groupLabels = [...read(dir, 'data/trainers/party_pointers.asm').matchAll(/^\tdw (\w+Group)/gm)].map((m) => m[1]);
  const partiesText = read(dir, 'data/trainers/parties.asm');
  interface RawParty { name: string; mons: { level: number; species: string; item?: string; moves?: string[] }[] }
  const groups = new Map<string, Map<number, RawParty>>();
  for (const gm of partiesText.matchAll(/^(\w+Group):\n((?:(?!^\w+Group:)[^\n]*\n?)*)/gm)) {
    const byIdx = new Map<number, RawParty>();
    let cur: RawParty | undefined;
    let type = '';
    let idx = 0;
    let n = 0;
    for (const raw of gm[2].split('\n')) {
      const comment = /;\s*[^()]*\((\d+)\)/.exec(raw);
      if (comment && !raw.trim().startsWith('db')) idx = Number(comment[1]);
      const l = code(raw);
      const head = /^db\s+"([^@"]*)@",\s*(TRAINERTYPE_\w+)/.exec(l);
      if (head) {
        cur = { name: head[1], mons: [] };
        type = head[2];
        n = idx || n + 1;
        byIdx.set(n, cur);
        idx = 0;
        continue;
      }
      if (l === 'db -1' || l.startsWith('db -1')) {
        cur = undefined;
        continue;
      }
      if (!cur || !l.startsWith('db ')) continue;
      const toks = l.slice(3).split(',').map((t) => t.trim());
      const mon: RawParty['mons'][number] = { level: Number(toks[0]), species: toks[1] };
      let k = 2;
      if (type.includes('ITEM')) mon.item = toks[k++];
      if (type.includes('MOVES')) mon.moves = toks.slice(k, k + 4).filter((t) => t && t !== 'NO_MOVE');
      cur.mons.push(mon);
    }
    groups.set(gm[1], byIdx);
  }
  const classKind = (c: string): TrainerKind =>
    ['FALKNER', 'WHITNEY', 'BUGSY', 'MORTY', 'PRYCE', 'JASMINE', 'CHUCK', 'CLAIR', 'BROCK', 'MISTY', 'LT_SURGE', 'ERIKA', 'JANINE', 'SABRINA', 'BLAINE'].includes(c) ? 'leader' : ['WILL', 'BRUNO', 'KAREN', 'KOGA'].includes(c) ? 'elite-four' : c === 'CHAMPION' ? 'champion' : c === 'RIVAL1' || c === 'RIVAL2' ? 'rival' : /GRUNT|EXECUTIVE|ROCKET/.test(c) ? 'boss' : c === 'POKEMON_PROF' || c === 'RED' || c === 'BLUE' ? 'other' : 'trainer';
  const trainers: Record<string, AtlasTrainer> = {};
  const trainerKey = (cls: string, id: string) => `${cls}_${id}`;
  const makeTrainer = (cls: string, id: string): AtlasTrainer | undefined => {
    const ci = classConsts.indexOf(cls);
    const n = (classIds.get(cls) ?? []).indexOf(id) + 1;
    if (ci < 1 || n < 1) return undefined;
    const raw = groups.get(groupLabels[ci - 1] ?? '')?.get(n);
    if (!raw?.mons.length) return undefined;
    const dv = classDvs[ci - 1] ?? [8, 8, 8, 8];
    const hp = ((dv[0] & 1) << 3) | ((dv[1] & 1) << 2) | ((dv[2] & 1) << 1) | (dv[3] & 1);
    const party: AtlasMon[] = raw.mons.map((p) => {
      const mon: AtlasMon = {
        species: gid(p.species), level: p.level, iv: 8, dvs: [hp, dv[0], dv[1], dv[3], dv[3], dv[2]],
        moves: (p.moves ?? movesAt(p.species, p.level)).map(gid),
        ...(p.moves ? {} : { movesDerived: true }),
      };
      if (p.item && p.item !== 'NO_ITEM') mon.item = gid(p.item);
      return mon;
    });
    const cname = title((classNames[ci - 1] ?? cls).toLowerCase());
    const pretty = title(raw.name.toLowerCase());
    return { id: trainerKey(cls, id), name: pretty, cls: cname, kind: classKind(cls), party, group: trainerKey(cls, id.replace(/\d+$/, '1')), order: 0 };
  };

  // --- maps: landmark per map ------------------------------------------------------------------
  const mapsAsm = read(dir, 'data/maps/maps.asm');
  const landmarkOfMap = new Map<string, string>();
  for (const m of mapsAsm.matchAll(/^\tmap (\w+),\s*\w+,\s*\w+,\s*(LANDMARK_\w+)/gm)) landmarkOfMap.set(m[1], m[2]);
  const landmarkPlace = (lm: string): string | undefined => {
    if (LANDMARK_ALIASES[lm]) return LANDMARK_ALIASES[lm];
    const k = lm.replace('LANDMARK_', '').toLowerCase().replace(/_/g, '-');
    return [k, `johto-${k}`, `kanto-${k}`, `johto-sea-${k}`, `kanto-sea-${k}`].find((c) => placeIds.has(c));
  };

  const locations: Record<string, AtlasLocation> = {};
  const kindOf = (id: string): LocationKind => (/sea-route/.test(id) ? 'sea-route' : /route/.test(id) ? 'route' : /-city$/.test(id) ? 'city' : /-town$|island$/.test(id) ? 'town' : /cave|tunnel|mt-|forest|path|tower|hq|ruins|lake|den|power|safari|victory|falls|islands|plateau|league/.test(id) ? 'cave' : 'landmark');
  for (const id of placeIds) locations[id] = { id, name: areaName.get(id) ?? title(id.replace(/^(johto|kanto)-/, '')), kind: kindOf(id), maps: [], connections: [], pokecenter: false, shops: [], obstacles: [], items: [], npcs: [], trainers: [], events: [] };

  // marts
  const martConsts = constList('constants/mart_constants.asm').filter((c) => /^MART_/.test(c) && !/^MARTTYPE_/.test(c));
  const martLabels = [...read(dir, 'data/items/marts.asm').matchAll(/^\tdw (\w+)/gm)].map((m) => m[1]);
  const martText = read(dir, 'data/items/marts.asm');
  const martStock = (mc: string): string[] => {
    const label = martLabels[martConsts.indexOf(mc)];
    const body = label ? new RegExp(`^${label}:\\n((?:(?!^\\w+:)[^\\n]*\\n?)*)`, 'm').exec(martText)?.[1] ?? '' : '';
    return body.split('\n').map(code).filter((l) => /^db\s+[A-Z_]+$/.test(l)).map((l) => l.slice(3).trim()).filter((c) => c !== '-1').map((c) => itemId(c)).filter((x): x is string => !!x && !!items[x]);
  };

  const connectionsRaw = new Map<string, Set<string>>();
  const mapFiles = readdirSync(resolve(dir, 'maps')).filter((f) => f.endsWith('.asm'));
  const unverified: Record<string, string[]> = {};
  const unmappedMaps: string[] = [];
  const badgeOf = new Map<string, string>();
  let npcTotal = 0;
  let npcWithText = 0;
  const trainerPlace = new Map<string, string>();
  const mapPlaceByStem = new Map<string, string>();
  for (const f of mapFiles) {
    const stem = f.replace('.asm', '');
    const lm = landmarkOfMap.get(stem);
    const p = lm ? landmarkPlace(lm) : undefined;
    if (p) mapPlaceByStem.set(stem, p);
  }

  for (const f of mapFiles) {
    const stem = f.replace('.asm', '');
    const place = mapPlaceByStem.get(stem);
    if (!place) {
      unmappedMaps.push(`${stem} (${landmarkOfMap.get(stem) ?? 'no landmark'})`);
      continue;
    }
    const loc = locations[place];
    const src = read(dir, `maps/${f}`);
    loc.maps.push(stem);
    if (/Pokecenter1F$/.test(stem)) loc.pokecenter = true;
    // the building / floor within the place: the map name without the place's first word ("VioletMart" → "Mart")
    const firstWord = title(place.replace(/^(johto|kanto)-/, '').split('-')[0]);
    const rest = stem.startsWith(firstWord) ? stem.slice(firstWord.length) : stem;
    const sub = rest && rest !== stem.replace(/\d+$/, '') || stem !== firstWord ? title(rest.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').toLowerCase()).replace(/ (\d)f\b/gi, ' $1F') || undefined : undefined;
    for (const w of src.matchAll(/^\twarp_event\s+-?\d+,\s*-?\d+,\s*(\w+),/gm)) {
      const t = mapPlaceByStem.get(w[1].split('_').map((x) => x[0] + x.slice(1).toLowerCase()).join(''));
      void t;
    }

    // script labels and text in this file
    const labels = new Map<string, string[]>();
    const textsHere = new Map<string, string>();
    {
      let cur: string[] | undefined;
      let curText: string[] | undefined;
      let curLabel = '';
      for (const raw of src.split('\n')) {
        const lab = /^([.\w]+):{0,2}$/.exec(raw.trim());
        if (lab && !raw.startsWith('\t') && !raw.startsWith(' ')) {
          curLabel = lab[1];
          labels.set(curLabel, (cur = []));
          curText = undefined;
          continue;
        }
        const t = /^\s*(text|line|cont|para|page|next|done|prompt|sdone)\s*(?:"(.*)")?$/.exec(raw);
        if (t) {
          const s = (t[2] ?? '').replace(/@$/, '').replace(/#/g, 'Poké').replace(/<PLAYER>/g, '[name]').replace(/<RIVAL>/g, '[rival]').replace(/<PK><MN>/g, 'Pokémon').replace(/<USER>|<TARGET>/g, '…');
          curText = curText ?? [];
          curText.push(t[1] === 'para' || t[1] === 'page' ? `\n${s}` : t[1] === 'line' || t[1] === 'cont' || t[1] === 'next' ? ` ${s}` : s);
          textsHere.set(curLabel, curText.join(''));
          continue;
        }
        cur?.push(code(raw));
      }
    }
    const reach = (start: string, limit = 25): string[] => {
      const seen: string[] = [];
      const queue = [start];
      while (queue.length && seen.length < limit) {
        const l = queue.shift()!;
        if (seen.includes(l) || !labels.has(l)) continue;
        seen.push(l);
        for (const line of labels.get(l)!) {
          const j = /^(?:jumptextfaceplayer|jumptext|writetext|iftrue|iffalse|ifequal|ifnotequal|sjump|scall|farsjump|jump|callasm)\s+(?:\w+,\s*)?(\.?\w+)$/.exec(line);
          if (j) queue.push(j[1]);
          const tr = /^(?:jumptextfaceplayer|jumptext|writetext)\s+(\w+)/.exec(line);
          if (tr) queue.push(tr[1]);
        }
      }
      return seen;
    };
    const saysOf = (label: string) => {
      const out: string[] = [];
      for (const l of reach(label)) {
        const t = textsHere.get(l);
        if (t) {
          const c = cleanText(t);
          if (c && !out.includes(c)) out.push(c);
        }
      }
      return out;
    };

    // events
    for (const o of src.matchAll(/^\tobject_event\s+(-?\d+),\s*(-?\d+),\s*(\w+),\s*\w+,\s*[-\d]+,\s*[-\d]+,\s*[-\d]+,\s*[-\d]+,\s*\w+,\s*(OBJECTTYPE_\w+),\s*[-\w]+,\s*([.\w]+),\s*([-\w]+)/gm)) {
      const [, xs, ys, sprite, type, script] = o;
      const x = Number(xs), y = Number(ys);
      const body = reach(script).flatMap((l) => labels.get(l) ?? []);
      if (type === 'OBJECTTYPE_ITEMBALL') {
        const ib = body.map((l) => /^itemball\s+(\w+)(?:,\s*(\d+))?/.exec(l)).find(Boolean);
        const id = ib && itemId(ib[1]);
        if (id && items[id]) loc.items.push({ item: id, qty: Number(ib![2] ?? 1), how: items[id].move ? (id.startsWith('hm') ? 'hm' : 'tm') : 'visible', where: `${sub ? `${sub}: ` : ''}on the ground at tile (${x}, ${y})`, at: [x, y], respawns: false, ...(sub ? { sub } : {}) });
        continue;
      }
      const tr = body.map((l) => /^trainer\s+(\w+),\s*(\w+),\s*\w+,\s*(\.?\w+),\s*(\.?\w+)/.exec(l)).find(Boolean);
      if (type === 'OBJECTTYPE_TRAINER' || tr) {
        if (tr) {
          const t = makeTrainer(tr[1], tr[2]);
          if (t) {
            const pre = saysOf(tr[3]).join(' ');
            const defeat = saysOf(tr[4]).join(' ');
            if (pre || defeat) t.quote = { ...(pre ? { pre } : {}), ...(defeat ? { defeat } : {}) };
            if (!trainers[t.id]) {
              trainers[t.id] = t;
              trainerPlace.set(t.id, place);
            }
          }
        }
        continue;
      }
      if (/FRUIT_TREE|SPRITE_POKE_BALL/.test(sprite)) continue;
      if (body.some((l) => /^pokemart\b/.test(l))) {
        const mc = body.map((l) => /^pokemart\s+\w+,\s*(MART_\w+)/.exec(l)).find(Boolean)?.[1];
        const stock = mc ? martStock(mc) : [];
        const shop: AtlasShop = { name: `${sub && !/^(Mart|Pokecenter)/.test(sub) ? `${sub} ` : ''}Poké Mart`, items: stock.map((it) => ({ item: it, price: items[it]?.price ?? 0 })) };
        if (shop.items.length && !loc.shops.some((s) => s.items.map((i) => i.item).join() === shop.items.map((i) => i.item).join())) {
          const same = loc.shops.filter((s) => s.name.replace(/ \(\d+\)$/, '') === shop.name).length;
          loc.shops.push(same ? { ...shop, name: `${shop.name} (${same + 1})` } : shop);
        }
        continue;
      }
      const says = saysOf(script);
      const gives: { item: string; qty: number }[] = [];
      for (const l of body) {
        const g = /^(?:verbosegiveitem|giveitem)\s+(\w+)(?:,\s*(\d+))?/.exec(l);
        const id = g && itemId(g[1]);
        if (id && items[id] && !gives.some((x2) => x2.item === id)) gives.push({ item: id, qty: Number(g![2] ?? 1) });
      }
      const gp = body.map((l) => /^givepoke\s+(\w+),\s*(\d+)(?:,\s*(\w+))?/.exec(l)).find(Boolean);
      const npc: AtlasNpc = {
        name: title(script.replace(/Script$/, '').replace(/^\w+?(?=[A-Z])/, (s) => (stem.startsWith(s) ? '' : s)).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()) || title(sprite.replace('SPRITE_', '').toLowerCase()),
        sprite: title(sprite.replace('SPRITE_', '').toLowerCase()), says, role: gp ? 'gift' : gives.length ? 'gift' : 'npc',
        ...(sub ? { sub } : {}), ...(gives.length ? { gives } : {}),
        ...(gp ? { giftMon: { species: gid(gp[1]), level: Number(gp[2]), ...(gp[3] && gp[3] !== 'NO_ITEM' ? { item: gid(gp[3]) } : {}) } } : {}),
      };
      loc.npcs.push(npc);
      npcTotal++;
      if (says.length) npcWithText++;
      for (const g of gives) loc.items.push({ item: g.item, qty: g.qty, how: 'gift', where: `${sub ? `${sub}: ` : ''}given by ${npc.name}`, respawns: false, ...(sub ? { sub } : {}) });
    }
    for (const b of src.matchAll(/^\tbg_event\s+(-?\d+),\s*(-?\d+),\s*(BGEVENT_\w+),\s*(\w+)/gm)) {
      const [, xs, ys, kind, script] = b;
      if (kind === 'BGEVENT_ITEM') {
        const hi = (labels.get(script) ?? []).map((l) => /^hiddenitem\s+(\w+)/.exec(l)).find(Boolean);
        const id = hi && itemId(hi[1]);
        if (id && items[id]) loc.items.push({ item: id, qty: 1, how: 'hidden', where: `${sub ? `${sub}: ` : ''}hidden at tile (${xs}, ${ys}); the Itemfinder points to it`, at: [Number(xs), Number(ys)], respawns: false, ...(sub ? { sub } : {}) });
      } else if (kind === 'BGEVENT_READ') {
        const says = saysOf(script);
        if (says.length) loc.npcs.push({ name: 'Sign', sprite: 'Sign', says, role: 'sign', ...(sub ? { sub } : {}) });
      }
    }
    // the scripted fights and badges of this map
    for (const t of src.matchAll(/(?:loadtrainer|trainer)\s+(\w+),\s*(\w+)/g)) {
      const tt = makeTrainer(t[1], t[2]);
      if (tt && !trainers[tt.id]) {
        trainers[tt.id] = tt;
        trainerPlace.set(tt.id, place);
      }
    }
    for (const bm of src.matchAll(/setflag ENGINE_(\w+)BADGE/g)) badgeOf.set(place, title(bm[1].toLowerCase()));
  }

  // rematches: LEO1, LEO2 … share the first battle's group
  for (const t of Object.values(trainers)) {
    const n = Number(/(\d+)$/.exec(t.id)?.[1] ?? 1);
    t.order = n > 1 && t.group !== t.id ? n - 1 : 0;
    if (t.order) t.variant = `Rematch ${t.order}`;
    t.loc = trainerPlace.get(t.id);
    if (t.loc) locations[t.loc].trainers.push(t.id);
  }
  // gyms
  const badges: string[] = [];
  for (const [pl, badge] of badgeOf) {
    const loc = locations[pl];
    const leader = loc.trainers.map((id) => trainers[id]).find((t) => t.kind === 'leader');
    if (!leader) continue;
    const counts = new Map<string, number>();
    for (const m of leader.party) for (const ty of gen2.species.get(m.species)?.types ?? []) counts.set(ty, (counts.get(ty) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || Number(a[0] === 'Normal') - Number(b[0] === 'Normal'))[0]?.[0];
    const gym: AtlasGym = { leader: leader.name, badge, levelCap: Math.max(...leader.party.map((m) => m.level)), ...(top ? { type: top } : {}) };
    loc.gym = gym;
    if (!badges.includes(badge)) badges.push(badge);
  }
  for (const [pl, dests] of connectionsRaw) locations[pl].connections = [...dests].sort();
  for (const l of Object.values(locations)) l.trainers.sort();
  const sorted: Record<string, AtlasLocation> = {};
  for (const id of Object.keys(locations).sort()) sorted[id] = locations[id];
  const unplaced = Object.values(trainers).filter((t) => !t.loc).map((t) => t.id);
  const file: AtlasFile = {
    version: 1, game: cfg.game, name: cfg.name, generation: 2, source: { repo: cfg.url, commit: cfg.commit },
    locations: sorted, trainers, items, unplaced, badges, unverified,
  };
  const L = Object.values(sorted);
  const encounterLocs = new Set<string>();
  for (const rows of Object.values(pokedex.encounters)) for (const [g, a] of rows) if (pokedex.games[g].id === cfg.dexGame) encounterLocs.add(pokedex.areas[a].loc);
  const missing = [...encounterLocs].filter((l) => !sorted[l]);
  const totalParties = [...groups.values()].reduce((n, g) => n + g.size, 0);
  const hiddenN = L.flatMap((l) => l.items).filter((i) => i.how === 'hidden').length;
  const visibleN = L.flatMap((l) => l.items).filter((i) => i.how === 'visible' || i.how === 'tm' || i.how === 'hm').length;
  const gaps = [
    `# Atlas data gaps — ${cfg.name}`,
    '',
    `Generated by \`npm run atlas\` (scripts/atlas/gen2.ts); do not edit. Source: ${cfg.url} @ \`${cfg.commit.slice(0, 10)}\`. ${cfg.note}`,
    '',
    '| What | Found | Expected | Notes |',
    '|---|---|---|---|',
    `| Town-map places with data | ${L.filter((l) => l.maps.length).length} | ${L.length} | no map folded in: ${L.filter((l) => !l.maps.length).map((l) => l.id).join(', ') || '—'} |`,
    `| Wild-encounter locations present | ${encounterLocs.size - missing.length} | ${encounterLocs.size} | missing: ${missing.join(', ') || '—'} |`,
    `| Trainers with full teams | ${Object.keys(trainers).length} | ${totalParties} | parties in parties.asm; unplaced: ${unplaced.length} |`,
    `| Hidden items | ${hiddenN} | — | BGEVENT_ITEM events |`,
    `| Visible items (balls, TMs) | ${visibleN} | — | item-ball objects |`,
    `| NPCs with dialogue | ${npcWithText} | ${npcTotal} | NPCs whose reachable script shows text |`,
    `| Shops | ${L.reduce((n, l) => n + l.shops.length, 0)} | ${martConsts.length} | MART_* lists placed through a clerk script |`,
    `| Gyms with leader, badge, level cap | ${L.filter((l) => l.gym).length} | 16 | |`,
    '',
    '## Maps not attached to a Town Map place',
    '',
    unmappedMaps.length ? unmappedMaps.map((m) => `- \`${m}\``).join('\n') : '—',
    '',
    '## Known limits',
    '',
    "- DVs are the class's fixed values from data/trainers/dvs.asm; Stat Exp is 0. Not cross-checked against a second source.",
    '- Overworld connections come from map warps only and are not filled in yet.',
    '- Wild Pokémon are read from the Pokédex encounter tables (PKHeX), not from this file.',
    '',
  ].join('\n');
  void readJSON;
  return { file, gaps };
}
