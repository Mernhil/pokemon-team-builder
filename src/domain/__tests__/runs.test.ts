import { describe, expect, it } from 'vitest';
import hgssJson from '@/data/generated/atlas-heartgold.json';
import platJson from '@/data/generated/atlas-platinum.json';
import redJson from '@/data/generated/atlas-red.json';
import { loadDex, type Dex } from '@/data/dex';
import { wildAt, wildByLocation } from '../atlas';
import { getFormat } from '../formats';
import type { PokedexData } from '../pokedex';
import type { AtlasFile } from '../atlasTypes';
import {
  areaStatus,
  badgeCount,
  bestMatchups,
  capWarnings,
  caughtFamilies,
  createRun,
  defaultRules,
  encounterCheck,
  familyRoot,
  hasMilestones,
  logEncounter,
  markDeath,
  milestones,
  nextMilestone,
  partyOf,
  partyProblems,
  partyToTeam,
  removeEncounter,
  reviveMon,
  sanitizeRun,
  setMonLevel,
  setMonState,
  summarize,
  toggleBeaten,
  type Run,
} from '../runs';

const plat = platJson as unknown as AtlasFile;
const hgss = hgssJson as unknown as AtlasFile;
const red = redJson as unknown as AtlasFile;

let dex: Dex;
const get = (id: string) => dex.species(id);
const beat = (run: Run, ...ids: string[]) => ids.reduce((r, id) => toggleBeaten(r, id), run);
const fresh = (game = 'platinum', rules = defaultRules(true)) => createRun({ game, rules, now: 1_000 });

describe('the dupes clause uses the evolution lines', async () => {
  dex = await loadDex('gen4');

  it('finds the earliest pre-evolution', () => {
    expect(familyRoot(get, 'staraptor')).toBe('starly');
    expect(familyRoot(get, 'starly')).toBe('starly');
    expect(familyRoot(get, 'roserade')).toBe('budew');
    expect(familyRoot(get, 'nonexistent')).toBe('nonexistent');
  });

  it('a caught line blocks every member of it, including after it died, and a different line is fine', () => {
    let run = logEncounter(fresh(), { loc: 'route-201', species: 'starly', status: 'caught' }, 1);
    for (const sp of ['starly', 'staravia', 'staraptor']) {
      const c = encounterCheck(run, 'route-202', sp, get);
      expect(c.ok, sp).toBe(false);
      expect(c.problems[0]).toMatch(/dupes clause/);
    }
    expect(encounterCheck(run, 'route-202', 'bidoof', get).ok).toBe(true);
    run = markDeath(run, run.mons[0].id, { cause: 'Crit' }, 2);
    expect(encounterCheck(run, 'route-202', 'staravia', get).ok).toBe(false);
    expect(caughtFamilies(run, get)).toEqual(new Set(['starly']));
  });

  it('a fainted or fled encounter does not block the line, and the clause can be switched off', () => {
    const run = logEncounter(fresh(), { loc: 'route-201', species: 'starly', status: 'fainted' }, 1);
    expect(encounterCheck(run, 'route-202', 'starly', get).ok).toBe(true);
    const caught = logEncounter(fresh('platinum', { ...defaultRules(true), dupes: false }), { loc: 'route-201', species: 'starly', status: 'caught' }, 1);
    expect(encounterCheck(caught, 'route-202', 'staravia', get).ok).toBe(true);
  });

  it('a gift counts as caught for the dupes clause', () => {
    const run = logEncounter(fresh(), { loc: 'twinleaf', species: 'turtwig', status: 'gift' }, 1);
    expect(encounterCheck(run, 'route-201', 'grotle', get).ok).toBe(false);
  });
});

describe('first encounter per area', () => {
  it('is used by a catch, a faint or a flee; a gift and a skip leave the area open', () => {
    const run = fresh();
    for (const status of ['caught', 'fainted', 'fled'] as const) expect(areaStatus(logEncounter(run, { loc: 'a', species: 'rattata', status }, 1), 'a', true)).toBe('used');
    for (const status of ['gift', 'skipped'] as const) expect(areaStatus(logEncounter(run, { loc: 'a', species: 'rattata', status }, 1), 'a', true)).toBe('available');
    expect(areaStatus(run, 'a', false)).toBe('none');
    expect(areaStatus(run, 'a', true)).toBe('available');
  });

  it('refuses a second wild encounter in a used area, unless it is shiny and the shiny clause is on', () => {
    const run = logEncounter(fresh(), { loc: 'route-201', species: 'bidoof', status: 'fainted' }, 1);
    expect(encounterCheck(run, 'route-201', 'starly', get).problems).toEqual(['This area’s encounter is already used.']);
    expect(encounterCheck(run, 'route-201', 'starly', get, { shiny: true }).ok).toBe(true);
    const noShiny = { ...run, rules: { ...run.rules, shiny: false } };
    expect(encounterCheck(noShiny, 'route-201', 'starly', get, { shiny: true }).ok).toBe(false);
  });

  it('a run without Nuzlocke rules has no restrictions', () => {
    const run = logEncounter(fresh('platinum', defaultRules(false)), { loc: 'route-201', species: 'starly', status: 'caught' }, 1);
    expect(encounterCheck(run, 'route-201', 'staravia', get).ok).toBe(true);
  });
});

describe('party, box and deaths', () => {
  const catchN = (n: number) => Array.from({ length: n }, (_, i) => i).reduce((r, i) => logEncounter(r, { loc: `l${i}`, species: 'rattata', status: 'caught', level: 7 }, i + 1), fresh());

  it('fills the party first, then the box', () => {
    const run = catchN(8);
    expect(partyOf(run)).toHaveLength(6);
    expect(run.mons.filter((m) => m.state === 'box')).toHaveLength(2);
  });

  it('never allows a seventh in the party', () => {
    const run = catchN(7);
    const boxed = run.mons.find((m) => m.state === 'box')!;
    expect(setMonState(run, boxed.id, 'party')).toBe(run);
    const swapped = setMonState(setMonState(run, partyOf(run)[0].id, 'box'), boxed.id, 'party');
    expect(partyOf(swapped)).toHaveLength(6);
  });

  it('a death leaves the party with its place and cause, stays dead, and can be undone to the box', () => {
    let run = catchN(2);
    const id = run.mons[0].id;
    run = markDeath(run, id, { loc: 'route-203', cause: '  Critical hit  ' }, 99);
    expect(run.mons[0]).toMatchObject({ state: 'dead', death: { loc: 'route-203', cause: 'Critical hit', at: 99 } });
    expect(setMonState(run, id, 'party')).toBe(run);
    expect(summarize(run, []).dead).toBe(1);
    expect(summarize(run, []).alive).toBe(1);
    run = reviveMon(run, id);
    expect(run.mons[0]).toMatchObject({ state: 'box' });
    expect(run.mons[0].death).toBeUndefined();
  });

  it('removing an encounter removes the Pokémon it gave', () => {
    const run = catchN(2);
    const next = removeEncounter(run, run.encounters[0].id);
    expect(next.encounters).toHaveLength(1);
    expect(next.mons).toHaveLength(1);
  });

  it('the species clause flags two of one evolution line in the party', async () => {
    dex = await loadDex('gen4');
    let run = fresh('platinum', { ...defaultRules(true), species: true });
    run = logEncounter(run, { loc: 'a', species: 'starly', status: 'caught' }, 1);
    run = logEncounter(run, { loc: 'b', species: 'staraptor', status: 'gift' }, 2);
    expect(partyProblems(run, get)).toHaveLength(1);
    expect(partyProblems({ ...run, rules: { ...run.rules, species: false } }, get)).toEqual([]);
  });

  it('levels are clamped', () => {
    const run = catchN(1);
    expect(setMonLevel(run, run.mons[0].id, 250).mons[0].level).toBe(100);
    expect(setMonLevel(run, run.mons[0].id, -3).mons[0].level).toBe(1);
  });
});

describe('level caps and boss order · Platinum', () => {
  const ms = milestones(plat, 'platinum');
  it('lists the gyms in Platinum’s order, then the Elite Four and the Champion', () => {
    expect(ms.map((m) => m.name)).toEqual(['Roark', 'Gardenia', 'Fantina', 'Maylene', 'Wake', 'Byron', 'Candice', 'Volkner', 'Aaron', 'Bertha', 'Flint', 'Lucian', 'Cynthia']);
    expect(ms.filter((m) => m.kind === 'gym')).toHaveLength(8);
    expect(ms.map((m) => m.kind).slice(8)).toEqual(['elite-four', 'elite-four', 'elite-four', 'elite-four', 'champion']);
  });

  it('takes the level from the first battle in the gym, not a rematch elsewhere', () => {
    const volkner = ms.find((m) => m.name === 'Volkner')!;
    expect(volkner.level).toBe(50); // the Battle Frontier Volkner is 58
    expect(ms.find((m) => m.name === 'Flint')!.level).toBe(57);
    expect(ms.find((m) => m.name === 'Cynthia')!.level).toBe(62);
    expect(ms.find((m) => m.name === 'Fantina')!).toMatchObject({ level: 26, badge: 'Relic', label: 'Fantina (Relic Badge)' });
  });

  it('the next cap follows what has been beaten', () => {
    let run = fresh();
    expect(nextMilestone(ms, run)).toMatchObject({ name: 'Roark', level: 14 });
    run = beat(run, 'gym:roark', 'gym:gardenia');
    expect(nextMilestone(ms, run)).toMatchObject({ name: 'Fantina', level: 26 });
    expect(badgeCount(ms, run)).toBe(2);
    expect(summarize(run, ms)).toMatchObject({ badges: 2, totalBadges: 8, next: { name: 'Fantina' } });
    run = beat(fresh(), ...ms.map((m) => m.id));
    expect(nextMilestone(ms, run)).toBeUndefined();
  });

  it('warns about party members above the cap; only when caps are on and something is left to beat', () => {
    let run = fresh();
    run = logEncounter(run, { loc: 'a', species: 'starly', status: 'caught', level: 16 }, 1);
    run = logEncounter(run, { loc: 'b', species: 'bidoof', status: 'caught', level: 14 }, 2);
    const next = nextMilestone(ms, run);
    expect(capWarnings(run, next)).toEqual([{ monId: run.mons[0].id, level: 16, cap: 14 }]);
    expect(capWarnings({ ...run, rules: { ...run.rules, levelCaps: 'hard' } }, next)).toHaveLength(1);
    expect(capWarnings({ ...run, rules: { ...run.rules, levelCaps: 'off' } }, next)).toEqual([]);
    expect(capWarnings(run, undefined)).toEqual([]);
    // a boxed or dead Pokémon is not a problem
    const boxed = setMonState(run, run.mons[0].id, 'box');
    expect(capWarnings(boxed, next)).toEqual([]);
  });
});

describe('level caps and boss order · HeartGold (Kanto after Johto)', () => {
  const ms = milestones(hgss, 'heartgold');
  const names = ms.map((m) => m.name);

  it('Johto gyms first, then the Elite Four and Lance, then the Kanto gyms', () => {
    expect(names.slice(0, 8)).toEqual(['Falkner', 'Bugsy', 'Whitney', 'Morty', 'Chuck', 'Jasmine', 'Pryce', 'Clair']);
    expect(names.slice(8, 13)).toEqual(['Will', 'Koga', 'Bruno', 'Karen', 'Lance']);
    expect(names.slice(13).sort()).toEqual(['Blaine', 'Blue', 'Brock', 'Erika', 'Janine', 'Lt. Surge', 'Misty', 'Sabrina']);
    expect(ms.slice(0, 8).every((m) => m.region === 'Johto')).toBe(true);
    expect(ms.slice(13).every((m) => m.region === 'Kanto')).toBe(true);
    expect(ms.slice(0, 8).every((m) => m.kind === 'gym')).toBe(true);
  });

  it('the Kanto gyms (take them in any order) are sorted by level', () => {
    const kanto = ms.slice(13).map((m) => m.level);
    expect(kanto).toEqual([...kanto].sort((a, b) => a - b));
    expect(ms.find((m) => m.name === 'Janine')!.level).toBeLessThan(ms.find((m) => m.name === 'Blue')!.level);
  });

  it('Johto caps climb through the Johto gyms, and the Kanto caps come after the Champion', () => {
    const johto = ms.slice(0, 8).map((m) => m.level);
    expect(johto).toEqual([13, 17, 19, 25, 31, 35, 34, 41]);
    const lance = ms.find((m) => m.name === 'Lance')!;
    expect(lance.level).toBeGreaterThanOrEqual(ms.find((m) => m.name === 'Karen')!.level); // never lower than the Elite Four before them
    let run = beat(fresh('heartgold'), ...ms.slice(0, 13).map((m) => m.id));
    expect(nextMilestone(ms, run)!.region).toBe('Kanto');
    expect(nextMilestone(ms, run)!.level).toBeGreaterThanOrEqual(50);
    expect(badgeCount(ms, run)).toBe(8);
    run = beat(run, ms[13].id);
    expect(badgeCount(ms, run)).toBe(9);
  });

  it('SoulSilver reads HeartGold’s data, and Blue Red’s', () => {
    expect(hasMilestones('soulsilver')).toBe(true);
    expect(milestones(hgss, 'soulsilver').map((m) => m.id)).toEqual(ms.map((m) => m.id));
    expect(milestones(red, 'blue').map((m) => m.name).slice(0, 3)).toEqual(['Brock', 'Misty', 'Lt.Surge']);
  });
});

describe('games without caps or bosses', () => {
  it('encounters-only games have no milestones', () => {
    expect(hasMilestones('scarlet')).toBe(false);
    expect(hasMilestones('black')).toBe(false);
    expect(milestones(plat, 'scarlet')).toEqual([]);
    expect(hasMilestones('platinum')).toBe(true);
  });
});

describe('loading a run', () => {
  it('drops what is not a run, fixes what is wrong, and never keeps more than six in the party', () => {
    expect(sanitizeRun(null)).toBeNull();
    expect(sanitizeRun({ name: 'no game' })).toBeNull();
    const mon = (i: number) => ({ id: `m${i}`, species: 'rattata', level: 5, state: 'party' });
    const run = sanitizeRun({
      id: 'r1',
      game: 'platinum',
      name: '  ',
      rules: { nuzlocke: false, levelCaps: 'strict' },
      encounters: [{ id: 'e1', loc: 'a', status: 'caught' }, { id: 'e1', loc: 'dup-id', status: 'caught' }, { id: 'e2', loc: 'b', status: 'exploded' }, 'junk'],
      mons: [...Array.from({ length: 8 }, (_, i) => mon(i)), { id: 'dead', species: 'x', state: 'dead' }, { species: '' }, { id: 'm0', species: 'dup' }],
      beaten: ['gym:roark', 'gym:roark', 4],
      createdAt: 5,
    })!;
    expect(run.name).toBe('Run');
    expect(run.rules).toMatchObject({ nuzlocke: false, firstEncounter: false, levelCaps: 'off' });
    expect(run.encounters.map((e) => e.id)).toEqual(['e1']);
    expect(partyOf(run)).toHaveLength(6);
    expect(run.mons.filter((m) => m.state === 'box')).toHaveLength(2);
    expect(run.mons.find((m) => m.id === 'dead')!.death).toBeDefined();
    expect(run.mons.map((m) => m.id).filter((id) => id === 'm0')).toHaveLength(1);
    expect(run.beaten).toEqual(['gym:roark']);
  });
});

describe('wild encounters by location', () => {
  const pokedexFiles = import.meta.glob('@/data/generated/pokedex-gen4.json', { eager: true, import: 'default' }) as Record<string, PokedexData>;
  const pd = Object.values(pokedexFiles)[0];

  it('gives the same rows as wildAt for every location, in one pass', () => {
    const byLoc = wildByLocation(pd, 'platinum');
    expect(byLoc.size).toBeGreaterThan(50);
    for (const loc of Object.keys(plat.locations).slice(0, 60)) {
      const a = wildAt(pd, 'platinum', loc).map((r) => `${r.species}/${r.method}/${r.min}/${r.max}/${r.sub ?? ''}`).sort();
      const b = (byLoc.get(loc) ?? []).map((r) => `${r.species}/${r.method}/${r.min}/${r.max}/${r.sub ?? ''}`).sort();
      expect(b, loc).toEqual(a);
    }
    expect(wildByLocation(pd, 'no-such-game').size).toBe(0);
  });
});

describe('type matchups against a boss', () => {
  const eff = (atk: string, def: string[]) => {
    const table: Record<string, Record<string, number>> = { Water: { Fire: 2, Grass: 0.5, Water: 0.5 }, Grass: { Water: 2, Fire: 0.5, Grass: 0.5 }, Fire: { Grass: 2, Water: 0.5, Fire: 0.5 } };
    return def.reduce((m, d) => m * (table[atk]?.[d] ?? 1), 1);
  };
  it('picks, for each defender, the attacker type that hits it hardest (earlier attacker on ties)', () => {
    const rows = bestMatchups(
      [{ name: 'Piplup', types: ['Water'] }, { name: 'Turtwig', types: ['Grass'] }],
      [{ name: 'Charmander', types: ['Fire'] }, { name: 'Bulbasaur', types: ['Grass'] }, { name: 'Normal thing', types: ['Normal'] }],
      eff,
    );
    expect(rows[0].best).toEqual({ attacker: 'Piplup', type: 'Water', mult: 2 });
    expect(rows[1].best).toEqual({ attacker: 'Piplup', type: 'Water', mult: 0.5 }); // 0.5 vs 0.5: the earlier one
    expect(rows[2].best).toEqual({ attacker: 'Piplup', type: 'Water', mult: 1 });
    expect(bestMatchups([], [{ name: 'X', types: ['Fire'] }], eff)[0].best).toBeUndefined();
  });
});

describe('the party as a Builder team', () => {
  it('keeps levels and nicknames, only the party, in the game’s format', async () => {
    const dex4 = await loadDex('gen4');
    let run = fresh('platinum');
    run = logEncounter(run, { loc: 'a', species: 'starly', status: 'caught', level: 9, nickname: 'Wing' }, 1);
    run = logEncounter(run, { loc: 'b', species: 'bidoof', status: 'caught', level: 7 }, 2);
    run = setMonState(run, run.mons[1].id, 'box');
    const team = partyToTeam(run, dex4, getFormat('gen4'));
    expect(team.formatId).toBe('gen4');
    expect(team.name).toBe('Run (party)'.replace('Run', run.name));
    expect(team.slots.filter(Boolean)).toHaveLength(1);
    expect(team.slots[0]).toMatchObject({ speciesId: 'starly', level: 9, nickname: 'Wing' });
  });
});
