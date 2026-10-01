import { describe, expect, it } from 'vitest';
import atlasJson from '@/data/generated/atlas-platinum.json';
import mapsJson from '@/data/generated/maps.json';
import { loadDex } from '@/data/dex';
import { importShowdown } from '@/domain/codecs';
import { getFormat } from '@/domain/formats';
import type { PokedexData } from '@/domain/pokedex';
import { ATLAS_GAMES, completion, itemSources, matchLocations, monToSet, searchTrainers, trainerToShowdown, trainerToTeam, trainerVariants, type AtlasFile } from '@/domain/atlas';
import { neighbour } from '@/domain/regionMaps';
import { validateTeam } from '@/domain/validation';

const file = atlasJson as unknown as AtlasFile;
const maps = mapsJson as unknown as { maps: Record<string, { places: Record<string, [number, number, number, number][]> }>; games: Record<string, string[]> };

describe('Atlas · Platinum data', () => {
  it('has the schema the UI reads', () => {
    expect(file.version).toBe(1);
    expect(file.game).toBe('platinum');
    expect(Object.keys(file.locations).length).toBeGreaterThan(100);
    expect(Object.keys(file.trainers).length).toBeGreaterThan(800);
    for (const [id, l] of Object.entries(file.locations)) {
      expect(l.id).toBe(id);
      for (const k of ['maps', 'connections', 'shops', 'obstacles', 'items', 'npcs', 'trainers', 'events'] as const) expect(Array.isArray(l[k]), `${id}.${k}`).toBe(true);
    }
  });

  it('every location is on the map and every map place resolves to data', () => {
    const plat = ATLAS_GAMES.find((g) => g.id === 'platinum')!;
    const places = maps.maps[plat.mapIds[0]].places;
    expect(maps.games.platinum).toContain(plat.mapIds[0]);
    for (const id of Object.keys(file.locations)) expect(places[id], `${id} is not on the Platinum map`).toBeDefined();
    for (const id of Object.keys(places)) expect(file.locations[id], `map place ${id} has no atlas data`).toBeDefined();
  });

  it('keeps every cross-reference valid', () => {
    for (const l of Object.values(file.locations)) {
      for (const c of l.connections) expect(file.locations[c], `${l.id} → ${c}`).toBeDefined();
      for (const t of l.trainers) expect(file.trainers[t]?.loc, `${l.id} lists ${t}`).toBe(l.id);
      for (const i of l.items) expect(file.items[i.item], `${l.id}: item ${i.item}`).toBeDefined();
      for (const s of l.shops) for (const i of s.items) expect(file.items[i.item], `${l.id} shop: ${i.item}`).toBeDefined();
    }
    for (const t of Object.values(file.trainers)) if (t.loc) expect(file.locations[t.loc].trainers).toContain(t.id);
  });

  it('places the gyms, shops and first trainers the game has', () => {
    const gyms = Object.values(file.locations).filter((l) => l.gym);
    expect(gyms.map((g) => g.gym!.leader).sort()).toEqual(['Byron', 'Candice', 'Fantina', 'Gardenia', 'Maylene', 'Roark', 'Volkner', 'Wake']);
    expect(file.locations['oreburgh-gym'].gym).toMatchObject({ leader: 'Roark', badge: 'Coal', levelCap: 14, type: 'Rock' });
    const roark = file.trainers.TRAINER_LEADER_ROARK;
    expect(roark.party.map((m) => [m.species, m.level])).toEqual([['geodude', 12], ['onix', 12], ['cranidos', 14]]);
    const mart = file.locations['jubilife-city'].shops.find((s) => s.badgeStock)!;
    expect(mart.items.find((i) => i.item === 'pokeball')).toMatchObject({ price: 200 });
    expect(file.locations['sinnoh-route-209'].items.some((i) => i.how === 'hidden')).toBe(true);
  });

  it('groups rematches and starter variants under one trainer', () => {
    const v = trainerVariants(file, 'TRAINER_LEADER_ROARK');
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v[0].order).toBe(0);
    const rival = trainerVariants(file, 'TRAINER_RIVAL_ROUTE_203');
    expect(rival.map((r) => r.variant).sort()).toEqual(["Rival's Chimchar", "Rival's Piplup", "Rival's Turtwig"]);
  });
});

describe('Atlas · trainer teams against the Gen 4 data', () => {
  it('uses only species, moves, items and abilities the Gen 4 dex knows', async () => {
    const dex = await loadDex('gen4');
    const bad: string[] = [];
    const notInBuilder = new Set<string>();
    for (const t of Object.values(file.trainers)) {
      expect(t.party.length, t.id).toBeGreaterThan(0);
      expect(t.party.length, t.id).toBeLessThanOrEqual(6);
      for (const m of t.party) {
        if (!dex.species(m.species)) bad.push(`${t.id}: species ${m.species}`);
        if (m.level < 1 || m.level > 100) bad.push(`${t.id}: level ${m.level}`);
        if (m.iv < 0 || m.iv > 31) bad.push(`${t.id}: iv ${m.iv}`);
        if (m.moves.length < 1 || m.moves.length > 4) bad.push(`${t.id}: ${m.species} has ${m.moves.length} moves`);
        for (const mv of m.moves) if (!dex.move(mv)) bad.push(`${t.id}: move ${mv}`);
        // Held items must be items of the game; the builder's dex lacks a few bag-only ones (Rare Candy), which import drops.
        if (m.item && !file.items[m.item]) bad.push(`${t.id}: item ${m.item}`);
        if (m.item && !dex.item(m.item)) notInBuilder.add(m.item);
        if (m.ability) {
          const sp = dex.species(m.species);
          if (sp && !Object.values(sp.abilities).includes(dex.ability(m.ability)?.name ?? '?')) bad.push(`${t.id}: ${m.species} can't have ${m.ability}`);
        }
      }
    }
    expect(bad.slice(0, 25)).toEqual([]);
    expect([...notInBuilder]).toEqual(['rarecandy']);
  });

  it('round-trips a trainer through Load into Builder (Showdown import)', async () => {
    const dex = await loadDex('gen4');
    const format = getFormat('gen4');
    for (const id of ['TRAINER_LEADER_ROARK', 'TRAINER_CHAMPION_CYNTHIA', 'TRAINER_RIVAL_ROUTE_203_PIPLUP']) {
      const t = file.trainers[id];
      const text = trainerToShowdown(t, dex, format);
      const { team, warnings } = importShowdown(text, dex, format, t.name);
      expect(warnings, id).toEqual([]);
      const direct = trainerToTeam(t, dex, format);
      t.party.forEach((m, i) => {
        const s = team.slots[i]!;
        const d = direct.slots[i]!;
        expect(s.speciesId, `${id} #${i}`).toBe(m.species);
        expect(s.level).toBe(m.level);
        expect(s.moves.filter(Boolean)).toEqual(m.moves);
        expect(s.itemId).toBe(m.item);
        expect(dex.ability(s.abilityId)?.id).toBe(m.ability);
        expect(s.nature.toLowerCase()).toBe(m.nature);
        expect(Object.values(s.ivs)).toEqual([m.iv, m.iv, m.iv, m.iv, m.iv, m.iv]);
        // the matrices' direct conversion agrees with the importer
        expect(d.moves).toEqual(s.moves);
        expect(d.level).toBe(s.level);
        expect(monToSet(m, dex, format, 'x').nature).toBe(s.nature);
      });
      expect(validateTeam(team, format, dex).filter((i) => i.severity === 'error' && /level|species|format/i.test(i.message))).toEqual([]);
    }
  });
});

describe('Atlas · search, filters and progress', () => {
  it('finds trainers by name, class, Pokémon and move', () => {
    expect(searchTrainers(file, { text: 'roark' }).some((t) => t.id === 'TRAINER_LEADER_ROARK')).toBe(true);
    expect(searchTrainers(file, { species: 'onix' }).every((t) => t.party.some((m) => m.species === 'onix'))).toBe(true);
    expect(searchTrainers(file, { move: 'stealthrock' }).map((t) => t.id)).toContain('TRAINER_LEADER_ROARK');
    expect(searchTrainers(file, { loc: 'oreburgh-gym' }).length).toBeGreaterThan(0);
  });

  it('filters locations', () => {
    expect(matchLocations(file, {})).toBeNull();
    expect([...matchLocations(file, { gym: true })!].sort()).toContain('oreburgh-gym');
    expect(matchLocations(file, { gym: true })!.size).toBe(8);
    expect(matchLocations(file, { item: 'rarecandy' })!.size).toBeGreaterThan(0);
    expect(matchLocations(file, { trainerMove: 'stealthrock' })!.has('oreburgh-gym')).toBe(true);
  });

  it('indexes where each item can be found', () => {
    const src = itemSources(file);
    expect(src.get('pokeball')!.some((s) => s.how === 'mart')).toBe(true);
    expect(src.get('rarecandy')!.some((s) => s.how === 'hidden')).toBe(true);
  });

  it('counts completion', () => {
    const c = completion(file, { locations: ['oreburgh-city'], items: [], trainers: [] });
    expect(c.locations.done).toBe(1);
    expect(c.locations.pct).toBe(Math.round(100 / Object.keys(file.locations).length));
    expect(c.items.total).toBeGreaterThan(400);
  });
});

describe('Map keyboard navigation', () => {
  const places = { a: [[0, 0, 7, 7]], b: [[20, 0, 7, 7]], c: [[0, 20, 7, 7]], d: [[22, 22, 7, 7]] } as Record<string, [number, number, number, number][]>;
  it('moves to the nearest place in the arrow direction', () => {
    expect(neighbour(places, 'a', 'right')).toBe('b');
    expect(neighbour(places, 'a', 'down')).toBe('c');
    expect(neighbour(places, 'b', 'left')).toBe('a');
    expect(neighbour(places, 'a', 'left')).toBeUndefined();
    expect(neighbour(places, 'a', 'up')).toBeUndefined();
  });
});

describe('Place outlines', () => {
  it('merges a row of blocks into one rectangle', async () => {
    const { unionOutline } = await import('@/domain/regionMaps');
    expect(unionOutline([[0, 0, 7, 7], [0, 7, 7, 7], [0, 14, 7, 7]])).toBe('M0 0L7 0L7 21L0 21Z');
    // an L of three blocks is one six-corner shape, a lone block stays a square
    expect(unionOutline([[0, 0, 7, 7], [0, 7, 7, 7], [7, 7, 7, 7]]).split('L').length).toBe(6);
    expect(unionOutline([[5, 5, 7, 7]])).toBe('M5 5L12 5L12 12L5 12Z');
  });
});

// Every game with an atlas must satisfy the same invariants.
const atlasFiles = import.meta.glob('@/data/generated/atlas-*.json', { eager: true, import: 'default' }) as Record<string, AtlasFile>;
describe.each(ATLAS_GAMES.filter((g) => g.available && !g.lite))('Atlas · $name', (g) => {
  const f = Object.entries(atlasFiles).find(([k]) => k.endsWith(`atlas-${g.file ?? g.id}.json`))?.[1];
  it('has a built file', () => expect(f, `run npm run atlas -- ${g.id}`).toBeDefined());
  it('puts every location on the map and every place in the data', () => {
    const places: Record<string, unknown> = Object.assign({}, ...g.mapIds.map((m) => maps.maps[m].places));
    for (const m of g.mapIds) expect(maps.games[g.dexGame], `${g.id}: map ${m} is not shown for ${g.dexGame}`).toContain(m);
    for (const id of Object.keys(f!.locations)) expect(places[id], `${g.id}: ${id} is not on any of its maps`).toBeDefined();
    for (const id of Object.keys(places)) expect(f!.locations[id], `${g.id}: map place ${id} has no atlas data`).toBeDefined();
  });
  it('keeps references valid and teams legal for the dex', async () => {
    const dex = await loadDex(g.formatId);
    const bad: string[] = [];
    for (const l of Object.values(f!.locations)) {
      for (const c of l.connections) if (!f!.locations[c]) bad.push(`${l.id} → ${c}`);
      for (const i of l.items) if (!f!.items[i.item]) bad.push(`${l.id}: item ${i.item}`);
      for (const s of l.shops) for (const i of s.items) if (!f!.items[i.item]) bad.push(`${l.id} shop: ${i.item}`);
      for (const t of l.trainers) if (f!.trainers[t]?.loc !== l.id) bad.push(`${l.id} lists ${t}`);
    }
    for (const t of Object.values(f!.trainers)) {
      if (!t.party.length || t.party.length > 6) bad.push(`${t.id}: party of ${t.party.length}`);
      for (const m of t.party) {
        if (!dex.species(m.species)) bad.push(`${t.id}: species ${m.species}`);
        if (m.level < 1 || m.level > 100) bad.push(`${t.id}: level ${m.level}`);
        for (const mv of m.moves) if (!dex.move(mv)) bad.push(`${t.id}: move ${mv}`);
        if (m.item && !f!.items[m.item]) bad.push(`${t.id}: item ${m.item}`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});

// Encounters-only games (Generation 5 onward): every place has wild / static / gift encounters in the Pokédex data.
const pokedexFiles = import.meta.glob('@/data/generated/pokedex-*.json', { eager: true, import: 'default' }) as Record<string, PokedexData>;
describe.each(ATLAS_GAMES.filter((g) => g.lite))('Pokénav (encounters only) · $name', (g) => {
  const f = Object.entries(atlasFiles).find(([k]) => k.endsWith(`atlas-${g.file ?? g.id}.json`))?.[1];
  const pd = Object.entries(pokedexFiles).find(([k]) => k.endsWith(`pokedex-${g.book}.json`))?.[1];
  it('has a built file and Pokédex data', () => {
    expect(f, `run npm run atlas -- ${g.file ?? g.id}`).toBeDefined();
    expect(pd).toBeDefined();
    expect(pd!.games.some((x) => x.id === g.dexGame)).toBe(true);
  });
  it('lists places with encounters, and only those', () => {
    const gi = pd!.games.findIndex((x) => x.id === g.dexGame);
    const here = new Set(Object.values(pd!.encounters).flatMap((e) => e.filter((r) => r[0] === gi).map((r) => pd!.areas[r[1]].loc)));
    expect(here.size).toBeGreaterThan(0);
    for (const id of here) expect(f!.locations[id], `${g.id}: ${id} has encounters but no atlas place`).toBeDefined();
    expect(Object.keys(f!.trainers)).toEqual([]);
    expect(g.mapIds).toEqual([]);
  });
});
