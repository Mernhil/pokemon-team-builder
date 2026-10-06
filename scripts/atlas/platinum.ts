/**
 * Pokémon Platinum atlas, from the pret/pokeplatinum decompilation:
 *   res/trainers/data/*.json        trainer classes, parties (levels, items, explicit moves), messages
 *   res/pokemon/<species>/data.json exact learnsets (for trainers whose moves the game builds), abilities, gender ratios
 *   res/field/events/*.json         per-map NPC / trainer / item-ball / hidden-item / warp placements
 *   res/field/scripts/*.s + res/text  what NPCs say and give, shop counters, gym badges
 *   include/data/*.h                hidden items, Poké Mart stock
 *   res/items/data/*.json           item names, prices, descriptions, TM/HM moves
 *   src/trainer_data.c              how the game derives a trainer mon's personality → nature, ability, gender
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Dex } from '@pkmn/dex';
import type { AtlasFile, AtlasGym, AtlasItemInfo, AtlasItemSpot, AtlasLocation, AtlasMon, AtlasNpc, AtlasShop, AtlasTrainer, LocationKind, TrainerKind } from '../../src/domain/atlasTypes.ts';
import { ensure } from '../sources.ts';
import { GENDER_RATIO, NATURES, OUT, cid, cleanText, lines, linkSeaRoutes, otherTrainersOf, readJSON, spaced, title } from './common.ts';

const here = resolve(import.meta.dirname);

// ---------------------------------------------------------------------------
// Platinum
// ---------------------------------------------------------------------------

const DECOMP_PATHS = ['res', 'include', 'generated', 'src/trainer_data.c'];

const OBSTACLE_GFX: Record<string, string> = {
  OBJ_EVENT_GFX_ROCK_SMASH: 'Rock Smash',
  OBJ_EVENT_GFX_CUT_TREE: 'Cut',
  OBJ_EVENT_GFX_STRENGTH_BOULDER: 'Strength',
};
const SIGN_GFX = new Set(['OBJ_EVENT_GFX_SIGNBOARD', 'OBJ_EVENT_GFX_ARROW_SIGNPOST', 'OBJ_EVENT_GFX_MAP_SIGNPOST', 'OBJ_EVENT_GFX_GYM_SIGNPOST']);
/** Object graphics that are scenery / machinery, not people. */
const SKIP_GFX = new Set(['OBJ_EVENT_GFX_BERRY_SOIL', 'OBJ_EVENT_GFX_VENT', 'OBJ_EVENT_GFX_TEALA', 'OBJ_EVENT_GFX_POKEBALL', ...Object.keys(OBSTACLE_GFX)]);

/** Decomp map key prefixes → map place ids where the name doesn't follow from the key. */
const PLACE_ALIASES: Record<string, string> = {
  canalave_library: 'canalave-library-and-gym',
  canalave_city_gym: 'canalave-library-and-gym',
  oreburgh_city_gym: 'oreburgh-gym',
  oreburgh_gate: 'oreburgh-gate',
  oreburgh_mine: 'oreburgh-mine',
  mining_museum: 'oreburgh-museum',
  eterna_city_gym: 'eterna-gym',
  eterna_city_herb_shop: 'eterna-city',
  eterna_city_dp_gym: 'eterna-gym',
  eterna_forest_outside: 'eterna-forest',
  team_galactic_eterna_building: 'eterna-city',
  cycle_shop: 'cycle-shop',
  hearthome_city_gym: 'hearthome-contest-hall-and-gym',
  hearthome_city_dp_gym: 'hearthome-contest-hall-and-gym',
  contest_hall: 'hearthome-contest-hall-and-gym',
  hearthome_city_pokemon_fan_club: 'pokemon-fan-club',
  hearthome_city_east_gate_to_amity_square: 'amity-square',
  hearthome_city_west_gate_to_amity_square: 'amity-square',
  pastoria_city_gym: 'pastoria-gym',
  pastoria_city_dp_great_marsh: 'great-marsh',
  pastoria_city_observatory: 'pastoria-city',
  great_marsh: 'great-marsh',
  veilstone_city_gym: 'veilstone-gym',
  veilstone_city_galactic_warehouse: 'team-galactic-hq',
  veilstone_store: 'department-store',
  veilstone_city_prize_exchange: 'game-corner',
  game_corner: 'game-corner',
  galactic_hq: 'team-galactic-hq',
  sunyshore_city_gym: 'sunyshore-gym-and-bazaar',
  sunyshore_market: 'sunyshore-gym-and-bazaar',
  snowpoint_city_gym: 'snowpoint-city',
  snowpoint_temple: 'snowpoint-temple',
  pokemon_league: 'sinnoh-pokemon-league',
  victory_road: 'sinnoh-victory-road',
  flower_shop: 'flower-shop',
  pokemon_day_care: 'pokemon-day-care',
  solaceon_ruins: 'solaceon-ruins',
  solaceon_town_pokemon_news_press: 'solaceon-town',
  twinleaf_town_player_house: 'protagonists-homes',
  twinleaf_town_rival_house: 'protagonists-homes',
  sandgem_town_pokemon_research_lab: 'prof-rowans-lab',
  poketch_co: 'poketch-company',
  jubilife_tv: 'jubilife-tv',
  global_terminal: 'global-terminal',
  trainers_school: 'trainers-school',
  pal_park: 'pal-park-front-gate',
  lake_verity: 'lake-verity',
  lake_valor: 'lake-valor',
  lake_acuity: 'lake-acuity',
  verity_cavern: 'lake-verity',
  valor_cavern: 'lake-valor',
  acuity_cavern: 'lake-acuity',
  verity_lakefront: 'verity-lakefront',
  valor_lakefront: 'valor-lakefront',
  acuity_lakefront: 'acuity-lakefront',
  grand_lake_valor_lakefront: 'valor-lakefront',
  grand_lake_route_213: 'sinnoh-route-213',
  route_205_house: 'route-205-cabin',
  route_208_house: 'berry-masters-house',
  route_210_grandma_wilma_house: 'dragon-masters-house',
  route_209_lost_tower: 'lost-tower',
  route_212_house: 'route-212-move-tutor',
  route_213_gate: 'sinnoh-route-213',
  route_225_gate_to_fight_area: 'sinnoh-route-225',
  route_228_rock_peak_ruins: 'sinnoh-route-228',
  route_228_gate_to_route_226: 'sinnoh-route-228',
  route_226_house: 'the-meisters-house',
  route_222_house: 'sinnoh-route-222',
  route_222_gate_to_sunyshore_city: 'sinnoh-route-222',
  ruin_maniac_cave: 'ruin-maniac-cave',
  maniac_tunnel: 'maniac-tunnel',
  wayward_cave: 'wayward-cave',
  valley_windworks: 'valley-windworks',
  fuego_ironworks: 'fuego-ironworks',
  old_chateau: 'old-chateau',
  iron_island: 'iron-island',
  mt_coronet: 'mt-coronet',
  stark_mountain: 'stark-mountain',
  spear_pillar: 'spear-pillar',
  turnback_cave: 'turnback-cave',
  hall_of_origin: 'sinnoh-hall-of-origin-1',
  distortion_world: 'distortion-world',
  battle_frontier: 'battle-frontier',
  battle_frontier_gate_to_fight_area: 'battle-frontier-gateway',
  battle_tower: 'battle-frontier',
  battle_arcade: 'battle-frontier',
  battle_castle: 'battle-frontier',
  battle_factory: 'battle-frontier',
  battle_hall: 'battle-frontier',
  cafe: 'route-210-coffee-shop',
  restaurant: 'valor-lakefront-restaurant',
  footstep_house: 'doctor-footsteps-house',
  fight_area: 'fight-area',
  survival_area: 'survival-area',
  resort_area: 'resort-area',
  fullmoon_island: 'fullmoon-island',
  newmoon_island: 'newmoon-island',
  seabreak_path: 'seabreak-path',
  spring_path: 'sendoff-spring',
  sendoff_spring: 'sendoff-spring',
  trophy_garden: 'trophy-garden',
  pokemon_mansion: 'trophy-garden',
  iceberg_ruins: 'iceberg-ruins',
  villa: 'trophy-garden',
  route_206_cycling_road: 'sinnoh-route-206',
  route_218_gate: 'sinnoh-route-218',
  route_214_gate: 'sinnoh-route-214',
  route_215_gate: 'sinnoh-route-215',
  route_208_gate: 'sinnoh-route-208',
  route_209_gate: 'sinnoh-route-209',
  route_212_gate: 'sinnoh-route-212',
  celestic_town_cave: 'celestic-town-shrine',
};

interface EventFile {
  bg_events: { script: number; type: number; x: number; z: number }[];
  object_events: { id: string; graphics_id: string; script: number | string; trainer_type: string; x: number; z: number }[];
  warp_events: { dest_header_id: string }[];
}

interface ParsedScript {
  entries: string[];
  labels: Map<string, string[]>;
  banks: string[];
}

function parseScript(file: string): ParsedScript {
  const entries: string[] = [];
  const labels = new Map<string, string[]>();
  const banks: string[] = [];
  let cur: string[] | undefined;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const l = raw.replace(/\/\/.*$/, '').trim();
    if (!l) continue;
    const inc = /^#include "res\/text\/bank\/(\w+)\.h"/.exec(l);
    if (inc) banks.push(inc[1]);
    const se = /^ScriptEntry (\w+)$/.exec(l);
    if (se) entries.push(se[1]);
    const lab = /^(\w+):$/.exec(l);
    if (lab) labels.set(lab[1], (cur = []));
    else if (cur) cur.push(l);
  }
  return { entries, labels, banks };
}

/** Labels reachable from `start` through GoTo / Call / branch commands in the same file. */
function reachable(ps: ParsedScript, start: string, limit = 40): string[] {
  const seen: string[] = [];
  const queue = [start];
  while (queue.length && seen.length < limit) {
    const l = queue.shift()!;
    if (seen.includes(l) || !ps.labels.has(l)) continue;
    seen.push(l);
    for (const line of ps.labels.get(l)!) {
      const m = /^(?:GoTo|Call)(?:If\w+)?\s+(?:[^,]+,\s*){0,2}(\w+)$/.exec(line);
      if (m) queue.push(m[1]);
    }
  }
  return seen;
}

/** Items a script body hands over: `AddItem ITEM, n`, or the common give script after SetVar 0x8004 / 0x8005. */
function gainedItems(body: string[]): { c: string; qty: number }[] {
  const out: { c: string; qty: number }[] = [];
  let cur: string | undefined;
  let qty = 1;
  for (const line of body) {
    const a = /^AddItem\s+(ITEM_\w+),\s*(\d+)/.exec(line);
    if (a) out.push({ c: a[1], qty: Number(a[2]) });
    const v = /^SetVar VAR_0x8004, (ITEM_\w+)/.exec(line);
    if (v) {
      cur = v[1];
      qty = 1;
    }
    const q = /^SetVar VAR_0x8005, (\d+)/.exec(line);
    if (q) qty = Number(q[1]);
    if (/^Common_GiveItemQuantity/.test(line) && cur) out.push({ c: cur, qty });
  }
  return out;
}

export function buildPlatinum(): { file: AtlasFile; gaps: string } {
  const dir = ensure('pokeplatinum', DECOMP_PATHS);
  const commit = readFileSync(resolve(here, '../sources.ts'), 'utf8').match(/pokeplatinum:[^}]*commit: '(\w+)'/)![1];
  const maps = readJSON<{ maps: Record<string, { places: Record<string, unknown>; labels?: Record<string, string> }> }>(resolve(OUT, 'maps.json')).maps['sinnoh-pt'];
  const placeIds = new Set(Object.keys(maps.places));
  const pokedex = readJSON<{ games: { id: string }[]; areas: { loc: string; name: string }[]; encounters: Record<string, number[][]> }>(resolve(OUT, 'pokedex-gen4.json'));
  const areaName = new Map(pokedex.areas.map((a) => [a.loc, a.name]));

  // --- constants -----------------------------------------------------------------------------
  const trainerIds = lines(resolve(dir, 'generated/trainers.txt'));
  const trainerIdSet = new Set(trainerIds);
  const classes = lines(resolve(dir, 'generated/trainer_classes.txt'));
  const classNames = readJSON<{ messages: { en_US: string }[] }>(resolve(dir, 'res/text/trainer_class_names.json')).messages.map((m) => cleanText(m.en_US).replace(/[₧₦]+/g, 'Player'));
  const classGender = [...readFileSync(resolve(dir, 'include/data/trainer_class_genders.h'), 'utf8').matchAll(/GENDER_(MALE|FEMALE|NONE)/g)].map((m) => m[1]);
  const speciesDir = (c: string) => resolve(dir, 'res/pokemon', c.replace(/^SPECIES_/, '').toLowerCase());
  const specCache = new Map<string, { learn: [number, string][]; abilities: string[]; ratio: number; types: string[] } | null>();
  const speciesData = (c: string) => {
    if (!specCache.has(c)) {
      const f = resolve(speciesDir(c), 'data.json');
      if (!existsSync(f)) specCache.set(c, null);
      else {
        const d = readJSON<{ learnset: { by_level: [number, string][] }; abilities: string[]; gender_ratio: string; types: string[] }>(f);
        specCache.set(c, { learn: d.learnset.by_level, abilities: d.abilities, ratio: GENDER_RATIO[d.gender_ratio.replace('GENDER_RATIO_', '')] ?? 127, types: [...new Set(d.types)] });
      }
    }
    return specCache.get(c)!;
  };

  // --- text banks ----------------------------------------------------------------------------
  const text = new Map<string, string>();
  for (const f of readdirSync(resolve(dir, 'res/text')).filter((f) => f.endsWith('.json'))) {
    const d = readJSON<{ messages?: { id: string; en_US: string | string[] }[] }>(resolve(dir, 'res/text', f));
    for (const m of d.messages ?? []) if (m.id && m.en_US) text.set(m.id, cleanText(m.en_US));
  }

  // --- items ---------------------------------------------------------------------------------
  const items: Record<string, AtlasItemInfo> = {};
  const itemDir = resolve(dir, 'res/items/data');
  const constOfFile = (f: string) => `ITEM_${f.replace(/\.json$/, '').toUpperCase()}`;
  const itemByConst = new Map<string, AtlasItemInfo & { id: string }>();
  for (const f of readdirSync(itemDir).filter((f) => f.endsWith('.json'))) {
    const d = readJSON<{ name: string; price: number; description?: string[]; fieldPocket: string; teachesMove?: string }>(resolve(itemDir, f));
    const info: AtlasItemInfo = {
      name: d.name,
      price: d.price,
      description: cleanText(d.description ?? []),
      pocket: d.fieldPocket.replace('POCKET_', '').toLowerCase(),
      ...(d.teachesMove ? { move: cid(d.teachesMove), moveType: Dex.forGen(4).moves.get(cid(d.teachesMove)).type } : {}),
    };
    const c = constOfFile(f);
    const id = cid(c);
    items[id] = info;
    itemByConst.set(c, { ...info, id });
  }
  const item = (c: string): string => {
    const i = itemByConst.get(c);
    return i ? i.id : cid(c);
  };

  // --- map keys → places ---------------------------------------------------------------------
  /** Aliases whose target isn't a Town Map place (the Town Map doesn't show it). */
  const unmapped = new Set<string>();
  const resolvePlace = (key: string): string | undefined => {
    const tokens = key.split('_');
    for (let k = tokens.length; k >= 1; k--) {
      const prefix = tokens.slice(0, k).join('_');
      if (PLACE_ALIASES[prefix]) {
        if (placeIds.has(PLACE_ALIASES[prefix])) return PLACE_ALIASES[prefix];
        unmapped.add(prefix);
      }
      const id = tokens.slice(0, k).join('-');
      for (const c of [id, `sinnoh-${id}`]) if (placeIds.has(c)) return c;
    }
    return undefined;
  };

  const eventDir = resolve(dir, 'res/field/events');
  const scriptDir = resolve(dir, 'res/field/scripts');
  const mapKeys = readdirSync(eventDir).filter((f) => f.startsWith('events_') && f.endsWith('.json')).map((f) => f.slice(7, -5));
  const unresolvedMaps: string[] = [];

  const locations: Record<string, AtlasLocation> = {};
  const kindOf = (id: string): LocationKind => {
    if (/sea-route/.test(id)) return 'sea-route';
    if (/route/.test(id) && !/cabin|house|move-tutor|coffee/.test(id)) return 'route';
    if (/-city$/.test(id)) return 'city';
    if (/-town$/.test(id)) return 'town';
    if (/cave|mine|tunnel|ruins|forest|chamber|mt-|mountain|island|path|marsh|victory-road|pillar|hall-of-origin|distortion|lake(?!front)|hq|spring|lost-tower|windworks|ironworks|chateau/.test(id)) return /hq|lost-tower|chateau|windworks|ironworks/.test(id) ? 'dungeon' : 'cave';
    if (/lakefront|meadow|garden|area|square|paradise|lighthouse|league|frontier|pal-park|great-marsh|fight|museum|statue|pier|gateway/.test(id)) return 'landmark';
    return 'building';
  };
  for (const id of placeIds) {
    locations[id] = {
      id, name: areaName.get(id) ?? maps.labels?.[id] ?? title(id.replace(/^sinnoh-/, '')), kind: kindOf(id), maps: [], connections: [], pokecenter: false, shops: [],
      obstacles: [], items: [], npcs: [], trainers: [], events: [],
    };
  }
  const subLabel = (key: string, place: string) => {
    const base = place.replace(/^sinnoh-/, '').replace(/-/g, '_');
    const rest = key.startsWith(base) ? key.slice(base.length).replace(/^_/, '') : key;
    return rest ? title(rest) : undefined;
  };

  // --- pass over every map -------------------------------------------------------------------
  const trainerPlace = new Map<string, { place: string; scripted: boolean }>();
  const markTrainer = (id: string, place: string, scripted: boolean) => {
    const cur = trainerPlace.get(id);
    if (!cur || (cur.scripted && !scripted)) trainerPlace.set(id, { place, scripted });
  };
  const visible = parseScript(resolve(scriptDir, 'scripts_visible_items.s'));
  const hiddenItems = [...readFileSync(resolve(dir, 'include/data/field/hidden_items.h'), 'utf8').matchAll(/HIDDEN_ITEM_ENTRY\((ITEM_\w+),\s*(\d+),\s*(\d+)/g)].map((m) => ({ item: m[1], qty: Number(m[2]), range: Number(m[3]) }));
  const tmIs = (id: string) => items[id]?.move !== undefined;
  const howOf = (id: string): AtlasItemSpot['how'] => (tmIs(id) ? (/^hm/.test(id) ? 'hm' : 'tm') : 'visible');
  const hiddenPlaced = new Set<number>();
  const obstacleCount: Record<string, Record<string, number>> = {};
  const berrySoil: Record<string, number> = {};
  const badgeOf = new Map<string, string>(); // place → badge constant
  const leaderOf = new Map<string, string>();
  const connectionsRaw = new Map<string, Set<string>>();
  const mapOf = new Map<string, string>();
  let npcTotal = 0;
  let npcWithText = 0;

  for (const key of mapKeys) {
    const place = resolvePlace(key);
    if (!place) {
      unresolvedMaps.push(key);
      continue;
    }
    mapOf.set(key, place);
    const loc = locations[place];
    loc.maps.push(key);
    if (/pokecenter_1f$/.test(key)) loc.pokecenter = true;
    const ev = readJSON<EventFile>(resolve(eventDir, `events_${key}.json`));
    const sub = subLabel(key, place);
    const scriptFile = resolve(scriptDir, `scripts_${key}.s`);
    const ps = existsSync(scriptFile) ? parseScript(scriptFile) : undefined;

    // connections: warps to other maps, gates named "gate_to_<place>"
    for (const w of ev.warp_events) {
      const dest = w.dest_header_id.replace('MAP_HEADER_', '').toLowerCase();
      (connectionsRaw.get(place) ?? connectionsRaw.set(place, new Set()).get(place)!).add(dest);
    }
    const gate = /gate_to_(\w+)$/.exec(key);
    if (gate) (connectionsRaw.get(place) ?? connectionsRaw.set(place, new Set()).get(place)!).add(gate[1]);

    // hidden items
    for (const b of ev.bg_events) {
      if (b.script >= 8000 && b.script < 8800) {
        const h = hiddenItems[b.script - 8000];
        if (!h) continue;
        hiddenPlaced.add(b.script - 8000);
        const id = item(h.item);
        loc.items.push({
          item: id, qty: h.qty, how: 'hidden', where: `${sub ? `${sub}: ` : ''}buried at tile (${b.x}, ${b.z}); the Dowsing Machine finds it within ${h.range === 0 ? 'the same tile' : `${h.range} tiles`}`,
          at: [b.x, b.z], respawns: false, ...(sub ? { sub } : {}),
        });
      }
    }

    // objects: items, trainers, obstacles, NPCs
    for (const o of ev.object_events) {
      const s = o.script;
      if (typeof s === 'string' && s.startsWith('TRAINER_')) {
        markTrainer(s, place, false);
        continue;
      }
      const n = Number(s);
      if (OBSTACLE_GFX[o.graphics_id]) {
        const ob = OBSTACLE_GFX[o.graphics_id];
        (obstacleCount[place] ??= {})[ob] = (obstacleCount[place][ob] ?? 0) + 1;
        continue;
      }
      if (o.graphics_id === 'OBJ_EVENT_GFX_BERRY_SOIL') {
        berrySoil[place] = (berrySoil[place] ?? 0) + 1;
        continue;
      }
      if (n >= 7000 && n < 8000) {
        const label = visible.entries[n - 7000];
        const body = label ? visible.labels.get(label) : undefined;
        const it = body?.map((l) => /^SetVar VAR_0x8008, (ITEM_\w+)/.exec(l)?.[1]).find(Boolean);
        const qty = Number(body?.map((l) => /^SetVar VAR_0x8009, (\d+)/.exec(l)?.[1]).find(Boolean) ?? 1);
        if (it) {
          const id = item(it);
          loc.items.push({ item: id, qty, how: howOf(id), where: `${sub ? `${sub}: ` : ''}on the ground at tile (${o.x}, ${o.z})`, at: [o.x, o.z], respawns: false, ...(sub ? { sub } : {}) });
        }
        continue;
      }
      if (!ps || !Number.isFinite(n) || n < 1 || SKIP_GFX.has(o.graphics_id)) continue;
      const label = ps.entries[n - 1];
      if (!label) continue;
      const sign = SIGN_GFX.has(o.graphics_id);
      const reach = reachable(ps, label);
      const body = reach.flatMap((l) => ps.labels.get(l) ?? []);
      const says: string[] = [];
      for (const line of body) {
        const m = /^(?:Message\w*|NPCMessage|EventMessage|PokemonCryAndMessage|OpenMessage)\b.*?\b(\w+_Text_\w+)/.exec(line);
        const t = m && text.get(m[1]);
        if (t && !says.includes(t)) says.push(t);
      }
      const gives: { item: string; qty: number }[] = [];
      for (const g of gainedItems(body)) if (!gives.some((x) => x.item === item(g.c))) gives.push({ item: item(g.c), qty: g.qty });
      const gm = body.map((l) => /^GivePokemon\s+(SPECIES_\w+),\s*(\d+),\s*(ITEM_\w+)/.exec(l)).find(Boolean);
      const trade = body.map((l) => /^InitNPCTrade\s+(NPC_TRADE_\w+)/.exec(l)).find(Boolean);
      const npc: AtlasNpc = {
        name: spaced(label.replace(/^[A-Z][A-Za-z0-9]*?_/, '')).replace(/\s+/g, ' ').trim() || spaced(label),
        sprite: title(o.graphics_id.replace('OBJ_EVENT_GFX_', '').toLowerCase()),
        says,
        role: sign ? 'sign' : body.some((l) => /^PokeMart/.test(l)) ? 'shop' : trade ? 'trade' : gm ? 'gift' : /Tutor/i.test(label) ? 'tutor' : 'npc',
        ...(sub ? { sub } : {}),
        ...(gives.length ? { gives } : {}),
        ...(gm ? { giftMon: { species: cid(gm[1]), level: Number(gm[2]), ...(gm[3] !== 'ITEM_NONE' ? { item: item(gm[3]) } : {}) } } : {}),
      };
      if (trade) (npc as AtlasNpc & { _trade: string })._trade = trade[1];
      loc.npcs.push(npc);
      if (!sign) {
        npcTotal++;
        if (says.length) npcWithText++;
      }
      for (const g of gives) {
        const spot: AtlasItemSpot = { item: g.item, qty: g.qty, how: 'gift', where: `${sub ? `${sub}: ` : ''}given by ${npc.name}`, respawns: false, ...(sub ? { sub } : {}) };
        if (!loc.items.some((i) => i.item === spot.item && i.where === spot.where)) loc.items.push(spot);
      }
    }

    // scripts: trainers fought by script, badges, shop counters, story gifts
    if (ps) {
      for (const [label, body] of ps.labels) {
        for (const line of body) {
          for (const t of line.matchAll(/\bTRAINER_[A-Z0-9_]+\b/g)) if (trainerIdSet.has(t[0])) markTrainer(t[0], place, true);
          const b = /^GiveBadge\s+(BADGE_ID_\w+)/.exec(line);
          if (b) badgeOf.set(place, b[1]);
          const common = /^PokeMartCommon/.test(line);
          const spec = /^PokeMartSpecialties\w*\s+(MART_SPECIALTIES_ID_\w+)/.exec(line);
          if (common || spec) {
            // each shop is added once per map (counter label differs, the stock doesn't)
            const tag = common ? 'common' : spec![1];
            const building = /mart$/.test(key) ? 'Poké Mart' : /herb_shop/.test(key) ? 'Herb Shop' : (sub ?? 'Poké Mart');
            const counter = spec && /VEILSTONE/.test(spec[1]) ? ` (${title(spec[1].replace('MART_SPECIALTIES_ID_VEILSTONE_', '').toLowerCase())})` : '';
            const name = `${building}${counter} · ${common ? 'Everyday stock' : 'Specialty stock'}`;
            if (!loc.shops.some((s) => (s as AtlasShop & { _tag?: string })._tag === `${key}:${tag}`)) loc.shops.push({ name, items: [], _tag: `${key}:${tag}` } as AtlasShop);
          }
        }
        // a story item not handed out by a visible NPC: AddItem in a label no NPC reached
        if (!loc.npcs.some((n) => n.gives?.length) || true) {
          for (const g of gainedItems(body)) {
            const id = item(g.c);
            if (loc.items.some((i) => i.item === id && i.how === 'gift')) continue;
            loc.items.push({ item: id, qty: g.qty, how: 'gift', where: `${sub ? `${sub}: ` : ''}story event (${spaced(label.replace(/^[A-Z][A-Za-z0-9]*?_/, ''))})`, respawns: false, ...(sub ? { sub } : {}) });
          }
          for (const line of body) {
            const g = /^GivePokemon\s+(SPECIES_\w+),\s*(\d+)/.exec(line);
            if (g && !loc.npcs.some((n) => n.giftMon?.species === cid(g[1]))) {
              loc.npcs.push({ name: spaced(label.replace(/^[A-Z][A-Za-z0-9]*?_/, '')), sprite: 'Event', says: [], role: 'gift', giftMon: { species: cid(g[1]), level: Number(g[2]) }, ...(sub ? { sub } : {}) });
            }
          }
        }
      }
    }
  }

  // connections
  for (const [place, dests] of connectionsRaw) {
    const out = new Set<string>();
    for (const d of dests) {
      const target = mapOf.get(d) ?? resolvePlace(d);
      if (target && target !== place) out.add(target);
    }
    locations[place].connections = [...out].sort();
  }
  for (const [place, obs] of Object.entries(obstacleCount)) locations[place].obstacles = Object.keys(obs).sort();
  for (const [place, n] of Object.entries(berrySoil)) locations[place].events.push(`${n} berry soil patch${n > 1 ? 'es' : ''} (plant any berry)`);

  // --- shops ---------------------------------------------------------------------------------
  const martFile = readFileSync(resolve(dir, 'include/data/mart_items.h'), 'utf8');
  const commonList = [...martFile.matchAll(/\{\s*(ITEM_\w+),\s*(0x\w+)\s*\}/g)].map((m) => ({ c: m[1], need: parseInt(m[2], 16) }));
  const arrays = new Map<string, string[]>();
  for (const m of martFile.matchAll(/const u16 (\w+)\[\] = \{([^}]*)\}/g)) arrays.set(m[1], [...m[2].matchAll(/\bITEM_(?!END)\w+/g)].map((x) => x[0]));
  const specTable = new Map<string, string>();
  for (const m of martFile.matchAll(/\[(MART_SPECIALTIES_ID_\w+)\]\s*=\s*(\w+)/g)) specTable.set(m[1], m[2]);
  const priced = (c: string, badges?: number) => ({ item: item(c), price: items[item(c)]?.price ?? 0, ...(badges ? { badges } : {}) });
  // badge tiers: requiredBadges 1 = 0 badges, 2 = 1–2, 3 = 3–4, 4 = 5–6, 5 = 7, 6 = 8 (src/scrcmd_shop.c)
  const tierBadges = [0, 0, 1, 3, 5, 7, 8];
  for (const loc of Object.values(locations)) {
    for (const s of loc.shops as (AtlasShop & { _tag?: string })[]) {
      const tag = s._tag!.split(':').slice(1).join(':');
      delete s._tag;
      if (tag === 'common') {
        s.badgeStock = true;
        s.items = commonList.map((c) => priced(c.c, tierBadges[c.need]));
      } else {
        const arr = arrays.get(specTable.get(tag) ?? '') ?? [];
        s.items = arr.map((c) => priced(c));
      }
    }
    // a mart's counters listed once per map can repeat names: merge identical stock
    loc.shops = loc.shops.filter((s, i, a) => s.items.length && a.findIndex((t) => t.name === s.name) === i);
  }

  // --- trainers ------------------------------------------------------------------------------
  const trainers: Record<string, AtlasTrainer> = {};
  const unverified: Record<string, string[]> = {};
  const missingTrainerFiles: string[] = [];
  const formSpecies: Record<string, string[]> = {
    SPECIES_WORMADAM: ['wormadam', 'wormadamsandy', 'wormadamtrash'],
    SPECIES_ROTOM: ['rotom', 'rotomheat', 'rotomwash', 'rotomfrost', 'rotomfan', 'rotommow'],
    SPECIES_GIRATINA: ['giratina', 'giratinaorigin'],
    SPECIES_SHAYMIN: ['shaymin', 'shayminsky'],
    SPECIES_DEOXYS: ['deoxys', 'deoxysattack', 'deoxysdefense', 'deoxysspeed'],
  };
  const kindFor = (cls: string): TrainerKind =>
    /LEADER/.test(cls) ? 'leader' : /ELITE_FOUR/.test(cls) ? 'elite-four' : /CHAMPION/.test(cls) ? 'champion' : /RIVAL/.test(cls) ? 'rival' : /COMMANDER|GALACTIC_BOSS|GALACTIC_ADMIN|ADMIN/.test(cls) ? 'boss' : /SAILOR|PROF|ASSISTANT|OTHER/.test(cls) ? 'other' : 'trainer';
  const STARTERS = ['PIPLUP', 'TURTWIG', 'CHIMCHAR'];

  trainerIds.forEach((tid, idx) => {
    if (tid === 'TRAINER_NONE') return;
    const f = resolve(dir, 'res/trainers/data', `${tid.replace(/^TRAINER_/, '').toLowerCase()}.json`);
    if (!existsSync(f)) {
      missingTrainerFiles.push(tid);
      return;
    }
    const d = readJSON<{
      name: string; class: string; items: string[]; double_battle: boolean;
      party: { species: string; form: number; level: number; item: string | null; moves: string[] | null; iv_scale: number }[];
      messages?: { type: string; en_US: string | string[] }[];
    }>(f);
    const classIdx = classes.indexOf(d.class);
    const female = classGender[classIdx] === 'FEMALE';
    const party: AtlasMon[] = d.party.map((p) => {
      const sd = speciesData(p.species);
      // iv_scale is a byte in the game; one trainer's data has a typo (2500) that wraps.
      const scale = p.iv_scale & 0xff;
      if (scale !== p.iv_scale) (unverified[tid] ??= []).push(`iv_scale ${p.iv_scale} in the source doesn't fit a byte; the game reads ${scale}`);
      const iv = Math.floor((scale * 31) / 255);
      // The game's personality for a trainer mon (src/trainer_data.c): LCG seeded by IV scale + level + species + trainer id,
      // advanced `class` times, then the class's gender byte; nature = pid % 25, ability slot = pid & 1.
      const speciesNum = speciesConstIndex(p.species);
      let seed = (scale + p.level + speciesNum + idx) >>> 0;
      let rnd = seed;
      for (let j = 0; j < classIdx; j++) {
        seed = (Math.imul(seed, 1103515245) + 24691) >>> 0;
        rnd = seed >>> 16;
      }
      const pid = (((rnd << 8) >>> 0) + (female ? 120 : 136)) >>> 0;
      const formIds = formSpecies[p.species];
      const speciesId = formIds ? (formIds[p.form] ?? formIds[0]) : cid(p.species);
      const mon: AtlasMon = { species: speciesId, level: p.level, iv, moves: [] };
      if (p.form && !formIds) (unverified[tid] ??= []).push(`${speciesId}: alternate form ${p.form} not mapped`);
      if (p.item && p.item !== 'ITEM_NONE') mon.item = item(p.item);
      if (p.moves) mon.moves = p.moves.filter((m) => m !== 'MOVE_NONE').map(cid);
      else if (sd) {
        // The game gives the most recent four level-up moves at this level.
        const learned: string[] = [];
        for (const [lv, mv] of sd.learn) if (lv <= p.level && !learned.includes(mv)) learned.push(mv);
        mon.moves = learned.slice(-4).map(cid);
        mon.movesDerived = true;
      }
      if (sd) {
        mon.nature = NATURES[pid % 25];
        const [a1, a2] = sd.abilities;
        const ab = a2 && a2 !== 'ABILITY_NONE' ? (pid & 1 ? a2 : a1) : a1;
        if (ab && ab !== 'ABILITY_NONE') mon.ability = cid(ab);
        mon.gender = sd.ratio === 255 ? 'N' : sd.ratio === 254 ? 'F' : sd.ratio === 0 ? 'M' : (pid & 0xff) >= sd.ratio ? 'M' : 'F';
      } else (unverified[tid] ??= []).push(`${speciesId}: no species data`);
      return mon;
    });
    const msg = (t: string) => {
      const m = d.messages?.find((x) => x.type === t);
      return m?.en_US ? cleanText(m.en_US) : undefined;
    };
    const rm = /^(TRAINER_\w+?)_REMATCH(?:_(\d+))?$/.exec(tid);
    const starter = STARTERS.find((s) => tid.endsWith(`_${s}`));
    const group = rm ? rm[1] : starter ? tid.slice(0, -starter.length - 1) : tid;
    const kind = kindFor(d.class);
    const t: AtlasTrainer = {
      id: tid, name: d.name, cls: classNames[classIdx] ?? title(d.class.replace('TRAINER_CLASS_', '').toLowerCase()), kind, party, group,
      order: rm ? Number(rm[2] ?? 1) : 0,
      ...(d.double_battle ? { double: true } : {}),
      ...(d.items.filter((i) => i !== 'ITEM_NONE').length ? { bag: d.items.filter((i) => i !== 'ITEM_NONE').map(item) } : {}),
      ...(msg('TRMSG_PRE_BATTLE') || msg('TRMSG_DEFEAT') ? { quote: { pre: msg('TRMSG_PRE_BATTLE'), defeat: msg('TRMSG_DEFEAT') } } : {}),
      ...(rm ? { variant: `Rematch ${rm[2] ?? 1}` } : starter ? { variant: `Rival's ${title(starter.toLowerCase())}` } : {}),
    };
    trainers[tid] = t;
  });
  const placeOfTrainer = (tid: string): string | undefined => {
    const direct = trainerPlace.get(tid)?.place;
    if (direct) return direct;
    const t = trainers[tid];
    if (!t) return;
    // rematches, starter variants: same place as their first battle / sibling
    for (const o of Object.values(trainers)) if (o.group === t.group && trainerPlace.get(o.id)) return trainerPlace.get(o.id)!.place;
    return undefined;
  };
  // Scripts that are no map's own (a shared script, a map the Town Map has no place for): a trainer a script
  // fights is placed where that script's name resolves, else described by the script.
  const scriptWhere = new Map<string, string>();
  for (const f of readdirSync(scriptDir).filter((f) => /^scripts_.*\.s$/.test(f))) {
    const key = f.slice(8, -2);
    const src = readFileSync(resolve(scriptDir, f), 'utf8');
    const ids = [...new Set([...src.matchAll(/\bTRAINER_[A-Z0-9_]+\b/g)].map((m) => m[0]))].filter((i) => trainerIdSet.has(i) && !trainerPlace.has(i));
    if (!ids.length) continue;
    const place = resolvePlace(key);
    for (const id of ids) {
      if (place) markTrainer(id, place, true);
      else scriptWhere.set(id, `Fought by the script “${title(key)}”, which belongs to no map on the Town Map (${/pokemon_center/.test(key) ? 'a shared script: these trainers can show up in any Pokémon Center' : 'a facility or event'}).`);
    }
  }
  const unplaced: string[] = [];
  for (const t of Object.values(trainers)) {
    const p = placeOfTrainer(t.id);
    if (p) {
      t.loc = p;
      locations[p].trainers.push(t.id);
    } else unplaced.push(t.id);
  }
  // Double battles share a map-level trainer list; one stable order per location
  for (const l of Object.values(locations)) l.trainers.sort((a, b) => trainerIds.indexOf(a) - trainerIds.indexOf(b));

  // --- gyms ----------------------------------------------------------------------------------
  const badges: string[] = [];
  for (const [place, badge] of badgeOf) {
    const loc = locations[place];
    const leaders = loc.trainers.map((id) => trainers[id]).filter((t) => t.kind === 'leader' && t.order === 0);
    const leader = leaders[0];
    if (!leader) continue;
    const typeCount = new Map<string, number>();
    for (const m of leader.party) for (const ty of speciesData(`SPECIES_${m.species.toUpperCase()}`)?.types ?? []) typeCount.set(ty, (typeCount.get(ty) ?? 0) + 1);
    const top = [...typeCount.entries()].sort((a, b) => b[1] - a[1] || Number(/NORMAL/.test(a[0])) - Number(/NORMAL/.test(b[0])))[0]?.[0];
    const gym: AtlasGym = { leader: leader.name, badge: title(badge.replace('BADGE_ID_', '').toLowerCase()), levelCap: Math.max(...leader.party.map((m) => m.level)), ...(top ? { type: title(top.replace('TYPE_', '').toLowerCase()) } : {}) };
    loc.gym = gym;
    leaderOf.set(place, leader.id);
    if (!badges.includes(gym.badge)) badges.push(gym.badge);
  }

  // --- NPC trades ----------------------------------------------------------------------------
  for (const loc of Object.values(locations)) {
    for (const n of loc.npcs as (AtlasNpc & { _trade?: string })[]) {
      if (!n._trade) continue;
      const f = resolve(dir, 'res/npc_trades', `${n._trade.replace('NPC_TRADE_', '').toLowerCase()}.json`);
      delete n._trade;
      if (!existsSync(f)) continue;
      const t = readJSON<{ name: string; species: string; requestedSpecies: string; heldItem?: string }>(f);
      n.trade = { give: cid(t.requestedSpecies), get: cid(t.species), nickname: t.name, ...(t.heldItem && t.heldItem !== 'ITEM_NONE' ? { item: item(t.heldItem) } : {}) };
    }
  }

  // --- tidy ----------------------------------------------------------------------------------
  const sorted: Record<string, AtlasLocation> = {};
  for (const id of Object.keys(locations).sort()) sorted[id] = locations[id];
  const used = new Set<string>();
  const useItem = (id: string) => used.add(id);
  for (const l of Object.values(sorted)) {
    l.items.forEach((i) => useItem(i.item));
    l.shops.forEach((s) => s.items.forEach((i) => useItem(i.item)));
    l.npcs.forEach((n) => n.gives?.forEach((g) => useItem(g.item)));
  }
  for (const t of Object.values(trainers)) {
    t.party.forEach((m) => m.item && useItem(m.item));
    t.bag?.forEach(useItem);
  }

  const file: AtlasFile = {
    version: 1, game: 'platinum', name: 'Pokémon Platinum', generation: 4, source: { repo: 'pret/pokeplatinum', commit },
    locations: sorted, trainers, items, unplaced, otherTrainers: otherTrainersOf(trainers, unplaced, (id) => scriptWhere.get(id) ?? (trainers[id] && scriptWhere.get(trainers[id].group))), badges, unverified,
  };

  // --- coverage report -----------------------------------------------------------------------
  linkSeaRoutes(sorted);
  const L = Object.values(sorted);
  const trainerFiles = readdirSync(resolve(dir, 'res/trainers/data')).length;
  const encounterLocs = new Set<string>();
  for (const rows of Object.values(pokedex.encounters)) for (const [g, a] of rows) if (pokedex.games[g].id === 'platinum') encounterLocs.add(pokedex.areas[a].loc);
  const missing = [...encounterLocs].filter((l) => !sorted[l]);
  const hidden = L.flatMap((l) => l.items).filter((i) => i.how === 'hidden').length;
  const visibleN = L.flatMap((l) => l.items).filter((i) => i.how === 'visible' || i.how === 'tm' || i.how === 'hm').length;
  const gifts = L.flatMap((l) => l.items).filter((i) => i.how === 'gift').length;
  const gapsMd = [
    '# Atlas data gaps — Pokémon Platinum',
    '',
    'Generated by `npm run atlas` (scripts/build-atlas.ts); do not edit. Source: pret/pokeplatinum @ `' + commit.slice(0, 10) + '`.',
    '',
    '| What | Found | Expected | Notes |',
    '|---|---|---|---|',
    `| Locations on the Town Map with data | ${L.filter((l) => l.maps.length || l.sameAs).length} | ${L.length} | map places with no decomp map folded in: ${L.filter((l) => !l.maps.length && !l.sameAs).map((l) => l.id).join(', ') || '—'} (sea routes 220, 223, 226 and 230 share their land route's map and point at it) |`,
    `| Wild-encounter locations that exist in the atlas | ${encounterLocs.size - missing.length} | ${encounterLocs.size} | missing: ${missing.join(', ') || '—'} |`,
    `| Trainers with full teams | ${Object.keys(trainers).length} | ${trainerFiles} | unplaced on a location: ${unplaced.length}; ids without a data file: ${missingTrainerFiles.length} |`,
    `| Hidden items (Dowsing Machine) | ${hidden} | ${hiddenItems.length} | ${hiddenPlaced.size} of the ${hiddenItems.length} gHiddenItems entries are on a map (a few are on two maps); the other ${hiddenItems.length - hiddenPlaced.size} (${[...Array(hiddenItems.length).keys()].filter((i) => !hiddenPlaced.has(i)).slice(0, 8).join(', ')}…) are table slots no map's events use: unused, not missing |`,
    `| Visible items (balls on the ground, incl. TMs) | ${visibleN} | ${visible.entries.length} | VisibleItems_* scripts placed on a map |`,
    `| Gift / story items | ${gifts} | — | \`AddItem\` in scripts |`,
    `| NPCs with dialogue | ${npcWithText} | ${npcTotal} | NPCs whose reachable script shows text |`,
    `| Shops | ${L.reduce((n, l) => n + l.shops.length, 0)} | — | Poké Marts, specialties and herb shop; Battle Frontier, decoration and seal shops are not included |`,
    `| Gyms with leader, badge, level cap | ${L.filter((l) => l.gym).length} | 8 | |`,
    '',
    '## Aliases without a Town Map place',
    '',
    [...unmapped].map((m) => `- \`${m}\``).join('\n') || '—',
    '',
    '## Decomp maps not attached to any Town Map location',
    '',
    unresolvedMaps.length ? unresolvedMaps.map((m) => `- \`${m}\``).join('\n') : '—',
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
    '- Item "where" text gives the tile in the game\'s map matrix; there is no per-item prose in the decomp.',
    '- Overworld connections between places come from warps and gates only (the decomp has no adjacency list).',
    '- Move, nature, ability and gender of trainer mons are computed from the same rules the game uses; natures and abilities have not been cross-checked against a second source.',
    '- Wild Pokémon are read from the Pokédex encounter tables (PKHeX), not from this file.',
    '',
  ].join('\n');
  void leaderOf;
  return { file, gaps: gapsMd };

  function speciesConstIndex(c: string): number {
    return speciesIdx.get(c) ?? 0;
  }
}

const speciesIdx = new Map<string, number>();
(function initSpecies() {
  const dir = ensure('pokeplatinum', DECOMP_PATHS);
  lines(resolve(dir, 'generated/species.txt')).forEach((c, i) => speciesIdx.set(c, i));
})();

