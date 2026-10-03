import { describe, expect, it } from 'vitest';
import { compareSnapshots, isProvisional, metaSourceKind, metaSourceRank, MIN_REPLAY_GAMES, MIN_TOURNAMENT_TEAMS, pickSnapshot, type MetaFile, type MetaSnapshot } from '@/domain/meta';
import {
  carryOverSnapshot,
  estimateSpread,
  fillSpreads,
  parseReplayLog,
  ratingFromLog,
  replayCutoff,
  teamFromDecklist,
  teamsToSnapshot,
  type TeamRecord,
} from '@/domain/metaSources';

/** Test resolver: Showdown names → ids, Megas → base forme, unknown names → undefined. */
const KNOWN = ['incineroar', 'rillaboom', 'garchomp', 'kingambit', 'sneasler', 'whimsicott', 'charizard', 'amoonguss', 'gardevoir', 'urshifurapidstrike', 'cofagrigus', 'ditto'];
const resolve = (name: string) => {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const base = id.replace(/mega[xy]?$/, '');
  return KNOWN.includes(base) ? base : undefined;
};

/**
 * A battle log in Showdown's protocol (shape of https://replay.pokemonshowdown.com/<id>.json's `log`,
 * hand-written, not a real game).
 */
const LOG = [
  '|player|p1|Alice|1|1612',
  '|player|p2|Bob|2|1540',
  '|gametype|doubles',
  '|rated|',
  '|clearpoke',
  '|poke|p1|Incineroar, L50, M|',
  '|poke|p1|Rillaboom, L50, M|',
  '|poke|p1|Charizard, L50, M|',
  '|poke|p1|Garchomp, L50, F|',
  '|poke|p1|Amoonguss, L50, F|',
  '|poke|p1|Whimsicott, L50, M|',
  '|poke|p2|Kingambit, L50, M|',
  '|poke|p2|Sneasler, L50, F|',
  '|poke|p2|Gardevoir, L50, F|',
  '|poke|p2|Urshifu-*, L50, M|',
  '|poke|p2|Garchomp, L50, M|',
  '|poke|p2|Fakemon, L50|',
  '|teampreview|4',
  '|start',
  '|switch|p1a: Cat|Incineroar, L50, M|100/100',
  '|switch|p1b: Charizard|Charizard, L50, M|100/100',
  '|switch|p2a: Kingambit|Kingambit, L50, M|100/100',
  '|switch|p2b: Gardevoir|Gardevoir, L50, F|100/100',
  '|-ability|p1a: Cat|Intimidate|boost',
  '|-unboost|p2a: Kingambit|atk|1',
  '|-ability|p2a: Kingambit|Defiant|boost',
  '|-boost|p2a: Kingambit|atk|2|[from] ability: Defiant',
  '|-ability|p2b: Gardevoir|Intimidate|[from] ability: Trace|[of] p1a: Cat',
  '|turn|1',
  '|detailschange|p1b: Charizard|Charizard-Mega-Y, L50, M',
  '|-mega|p1b: Charizard|Charizard|Charizardite Y',
  '|-weather|SunnyDay|[from] ability: Drought|[of] p1b: Charizard',
  '|move|p1a: Cat|Fake Out|p2b: Gardevoir',
  '|move|p1b: Charizard|Heat Wave|p2a: Kingambit|[spread] p2a,p2b',
  '|move|p2a: Kingambit|Sucker Punch|p1b: Charizard',
  '|-damage|p2a: Kingambit|80/100|[from] item: Life Orb',
  '|move|p2b: Gardevoir|Trick|p1a: Cat',
  '|-item|p1a: Cat|Choice Scarf|[from] move: Trick',
  '|-item|p2b: Gardevoir|Sitrus Berry|[from] move: Trick',
  '|turn|2',
  '|-enditem|p1a: Cat|Sitrus Berry|[eat]',
  '|move|p1a: Cat|Parting Shot|p2a: Kingambit',
  '|move|p1a: Cat|Flare Blitz|p2a: Kingambit|[from]lockedmove',
  '|switch|p1a: Chomp|Garchomp, L50, F|100/100',
  '|-enditem|p1a: Chomp|Focus Sash',
  '|switch|p2b: Urshifu|Urshifu-Rapid-Strike, L50, M|100/100',
  '|move|p2b: Urshifu|Surging Strikes|p1a: Chomp',
  '|move|p2b: Urshifu|Struggle|p1a: Chomp',
  '|win|Alice',
  "|raw|Alice's rating: 1612 &rarr; <strong>1630</strong><br />(+18 for winning)",
  "|raw|Bob's rating: 1540 &rarr; <strong>1522</strong><br />(-18 for losing)",
].join('\n');

describe('Showdown replay logs', () => {
  const parsed = parseReplayLog(LOG, resolve)!;
  const [p1, p2] = parsed;
  const get = (team: TeamRecord, id: string) => team.find((m) => m.speciesId === id)!;

  it('reads both Team Previews, dropping unknown species', () => {
    expect(p1.map((m) => m.speciesId)).toEqual(['incineroar', 'rillaboom', 'charizard', 'garchomp', 'amoonguss', 'whimsicott']);
    expect(p2.map((m) => m.speciesId)).toEqual(['kingambit', 'sneasler', 'gardevoir', 'urshifurapidstrike', 'garchomp']);
  });

  it('marks who was brought, matching nicknames and forme-hidden previews', () => {
    expect(p1.filter((m) => m.brought).map((m) => m.speciesId)).toEqual(['incineroar', 'charizard', 'garchomp']);
    expect(p2.filter((m) => m.brought).map((m) => m.speciesId)).toEqual(['kingambit', 'gardevoir', 'urshifurapidstrike']);
  });

  it('records moves used, not ones called by another effect or Struggle', () => {
    expect(get(p1, 'incineroar').moves).toEqual(['fakeout', 'partingshot']);
    expect(get(p2, 'urshifurapidstrike').moves).toEqual(['surgingstrikes']);
  });

  it('pins abilities on the right Pokémon (Trace reveals both; a Mega’s ability is ignored)', () => {
    expect(get(p1, 'incineroar').abilityId).toBe('intimidate');
    expect(get(p2, 'kingambit').abilityId).toBe('defiant');
    expect(get(p2, 'gardevoir').abilityId).toBe('trace');
    expect(get(p1, 'charizard').abilityId).toBeUndefined();
  });

  it('records original items, not ones swapped in by Trick', () => {
    expect(get(p1, 'charizard').itemId).toBe('charizarditey');
    expect(get(p2, 'kingambit').itemId).toBe('lifeorb');
    expect(get(p1, 'garchomp').itemId).toBe('focussash');
    expect(get(p1, 'incineroar').itemId).toBeUndefined();
    expect(get(p2, 'gardevoir').itemId).toBeUndefined();
  });

  it('reads the pre-battle ladder rating', () => {
    expect(ratingFromLog(LOG)).toBe(1612);
    expect(ratingFromLog('|win|x')).toBe(0);
  });

  it('rejects a log without two Team Previews', () => {
    expect(parseReplayLog('|start\n|switch|p1a: X|Incineroar|100/100', resolve)).toBeNull();
  });

  it('ignores moves and abilities after Transform, and pins Mummy on its holder', () => {
    const log = [
      ...['incineroar', 'rillaboom', 'garchomp', 'ditto'].map((s) => `|poke|p1|${s}, L50|`),
      ...['kingambit', 'sneasler', 'cofagrigus', 'amoonguss'].map((s) => `|poke|p2|${s}, L50|`),
      '|switch|p1a: Ditto|Ditto, L50|100/100',
      '|switch|p1b: Rillaboom|Rillaboom, L50|100/100',
      '|switch|p2a: Cofagrigus|Cofagrigus, L50|100/100',
      '|-transform|p1a: Ditto|p2a: Cofagrigus|[from] ability: Imposter',
      '|move|p1a: Ditto|Trick Room|p1a: Ditto',
      '|move|p1b: Rillaboom|Wood Hammer|p2a: Cofagrigus',
      '|-activate|p1b: Rillaboom|ability: Mummy|Grassy Surge|[of] p2a: Cofagrigus',
    ].join('\n');
    const [a, b] = parseReplayLog(log, resolve)!;
    expect(get(a, 'ditto').moves).toEqual([]);
    expect(get(a, 'ditto').abilityId).toBe('imposter');
    expect(get(a, 'rillaboom').abilityId).toBe('grassysurge');
    expect(get(b, 'cofagrigus').abilityId).toBe('mummy');
  });
});

describe('teams → usage snapshot', () => {
  const mon = (speciesId: string, over: Partial<TeamRecord[number]> = {}) => ({ speciesId, brought: true, moves: [], ...over });
  const teams: TeamRecord[] = [
    [mon('incineroar', { itemId: 'sitrusberry', moves: ['fakeout', 'fakeout'] }), mon('rillaboom'), mon('garchomp', { brought: false, itemId: 'never' })],
    [mon('incineroar', { itemId: 'safetygoggles', moves: ['fakeout'] }), mon('kingambit')],
    [mon('incineroar', { brought: false }), mon('rillaboom')],
    [mon('sneasler')],
  ];
  const snap = teamsToSnapshot(teams, { regulationId: 'champions-reg-mc', updatedAt: '2026-10-01', source: { kind: 'replays', name: 'Test', battles: 2 } })!;
  const entry = (id: string) => snap.entries.find((e) => e.speciesId === id)!;

  it('counts usage as % of teams and orders by it', () => {
    expect(snap.entries.map((e) => [e.speciesId, e.usagePct])).toEqual([
      ['incineroar', 75],
      ['rillaboom', 50],
      ['garchomp', 25],
      ['kingambit', 25],
      ['sneasler', 25],
    ]);
  });

  it('counts details over the games it was brought to, once per game', () => {
    expect(entry('incineroar').items).toEqual([
      { id: 'safetygoggles', pct: 50 },
      { id: 'sitrusberry', pct: 50 },
    ]);
    expect(entry('incineroar').moves).toEqual([{ id: 'fakeout', pct: 100 }]);
    expect(entry('garchomp').items).toEqual([]);
  });

  it('counts teammates over the teams with it', () => {
    expect(entry('incineroar').teammates[0]).toEqual({ id: 'rillaboom', pct: 66.7 });
    expect(entry('sneasler').teammates).toEqual([]);
  });

  it('returns null without teams', () => {
    expect(teamsToSnapshot([], { regulationId: 'x', source: { name: 'Test' } })).toBeNull();
  });

  it('picks the highest rating cutoff with enough games', () => {
    const games = [...Array(10)].map((_, i) => ({ rating: 1000 + i * 60 }));
    expect(replayCutoff(games, 1)).toBe(1500);
    expect(replayCutoff(games, 6)).toBe(1100);
    expect(replayCutoff(games, 100)).toBe(0);
  });
});

describe('tournament team lists', () => {
  it('reads Limitless team lists in either shape', () => {
    const list = [
      { name: 'Incineroar', item: 'Safety Goggles', ability: 'Intimidate', attacks: ['Fake Out', 'Parting Shot'] },
      { name: 'Charizard', item: 'Charizardite Y', ability: 'Solar Power', attacks: ['Heat Wave'] },
      { id: 'rillaboom', item: 'Miracle Seed', ability: 'Grassy Surge', moves: ['Wood Hammer'] },
      { species: 'Garchomp', item: null, ability: 'Rough Skin', attacks: [] },
    ];
    const team = teamFromDecklist(list, resolve)!;
    expect(team.map((m) => m.speciesId)).toEqual(['incineroar', 'charizard', 'rillaboom', 'garchomp']);
    expect(team[0]).toEqual({ speciesId: 'incineroar', brought: true, itemId: 'safetygoggles', abilityId: 'intimidate', moves: ['fakeout', 'partingshot'] });
    expect(team[3].itemId).toBeUndefined();
    expect(teamFromDecklist({ pokemon: list }, resolve)).toEqual(team);
  });

  it('rejects lists it can’t read fully', () => {
    expect(teamFromDecklist(null, resolve)).toBeNull();
    expect(teamFromDecklist([{ name: 'Incineroar' }, { name: 'Fakemon' }, { name: 'Garchomp' }, { name: 'Rillaboom' }], resolve)).toBeNull();
    expect(teamFromDecklist([{ name: 'Incineroar' }], resolve)).toBeNull();
  });
});

const snap = (over: Partial<MetaSnapshot> & { source: MetaSnapshot['source'] }): MetaSnapshot => ({
  regulationId: 'champions-reg-mc',
  updatedAt: '2026-10-01',
  entries: [{ speciesId: 'incineroar', usagePct: 50, abilities: [], items: [], moves: [], teammates: [], spreads: [] }],
  ...over,
});

describe('carry-over from the previous regulation', () => {
  const prev = snap({
    regulationId: 'champions-reg-mb',
    source: { kind: 'smogon', name: 'Smogon', month: '2026-08', battles: 100 },
    entries: [
      { speciesId: 'incineroar', usagePct: 50, abilities: [], items: [{ id: 'sitrusberry', pct: 40 }, { id: 'banneditem', pct: 30 }], moves: [{ id: 'fakeout', pct: 99 }, { id: 'bannedmove', pct: 10 }], teammates: [{ id: 'kingambit', pct: 30 }, { id: 'rillaboom', pct: 20 }], spreads: [{ nature: 'Careful', values: [32, 0, 2, 0, 32, 0], pct: 20 }] },
      { speciesId: 'kingambit', usagePct: 40, abilities: [], items: [], moves: [], teammates: [], spreads: [] },
    ],
  });
  const legal = { species: (id: string) => id !== 'kingambit', item: (id: string) => id !== 'banneditem', move: (id: string) => id !== 'bannedmove' };

  it('keeps what the new regulation allows, with the old numbers', () => {
    const c = carryOverSnapshot(prev, 'champions-reg-mc', legal, '2026-10-03')!;
    expect(c.source).toMatchObject({ kind: 'carryover', basedOn: 'champions-reg-mb', month: '2026-08' });
    expect(c.entries.map((e) => e.speciesId)).toEqual(['incineroar']);
    expect(c.entries[0]).toMatchObject({ usagePct: 50, items: [{ id: 'sitrusberry', pct: 40 }], moves: [{ id: 'fakeout', pct: 99 }], teammates: [{ id: 'rillaboom', pct: 20 }] });
  });

  it('names the original regulation through a chain of carry-overs, and returns null when nothing is left', () => {
    const c = carryOverSnapshot(prev, 'champions-reg-mc', legal)!;
    expect(carryOverSnapshot(c, 'champions-reg-md', legal)!.source.basedOn).toBe('champions-reg-mb');
    expect(carryOverSnapshot(prev, 'x', { ...legal, species: () => false })).toBeNull();
  });
});

describe('spreads for sources without them', () => {
  const donor = snap({
    regulationId: 'champions-reg-mb',
    source: { kind: 'smogon', name: 'Smogon' },
    entries: [{ speciesId: 'incineroar', usagePct: 50, abilities: [], items: [], moves: [], teammates: [], spreads: [{ nature: 'Careful', values: [32, 0, 2, 0, 32, 0], pct: 20 }] }],
  });
  const early = snap({
    source: { kind: 'replays', name: 'Replays' },
    entries: [
      { speciesId: 'incineroar', usagePct: 50, abilities: [], items: [], moves: [], teammates: [], spreads: [] },
      { speciesId: 'garchomp', usagePct: 40, abilities: [], items: [], moves: [], teammates: [], spreads: [] },
      { speciesId: 'unknown', usagePct: 30, abilities: [], items: [], moves: [], teammates: [], spreads: [] },
    ],
  });
  const stats: Record<string, { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }> = { garchomp: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 } };

  it('borrows the species’ spreads from another regulation, else estimates one', () => {
    const filled = fillSpreads(early, [donor], (id) => stats[id]);
    expect(filled.entries[0]).toMatchObject({ spreadFrom: 'champions-reg-mb', spreads: donor.entries[0].spreads });
    expect(filled.entries[1]).toMatchObject({ spreadFrom: 'estimate', spreads: [{ nature: 'Jolly', values: [2, 32, 0, 0, 0, 32] }] });
    expect(filled.entries[2].spreads).toEqual([]);
  });

  it('estimates 66 Stat Points shaped by base stats', () => {
    const slow = estimateSpread({ hp: 100, atk: 60, def: 80, spa: 110, spd: 80, spe: 30 });
    const mid = estimateSpread({ hp: 100, atk: 120, def: 80, spa: 60, spd: 80, spe: 70 });
    expect(slow).toMatchObject({ nature: 'Quiet', values: [32, 0, 0, 32, 2, 0] });
    expect(mid).toMatchObject({ nature: 'Adamant', values: [32, 32, 0, 0, 2, 0] });
    for (const s of [slow, mid]) expect(s.values.reduce((a, b) => a + b, 0)).toBe(66);
  });
});

describe('ranking sources', () => {
  const smogon = snap({ updatedAt: '2026-09-01', source: { kind: 'smogon', name: 'Smogon', month: '2026-08' } });
  const replays = (battles: number) => snap({ updatedAt: '2026-10-02', source: { kind: 'replays', name: 'Replays', battles } });
  const tournaments = (teams: number) => snap({ updatedAt: '2026-10-02', source: { kind: 'tournaments', name: 'Limitless', teams } });
  const carry = snap({ updatedAt: '2026-10-03', source: { kind: 'carryover', name: 'Smogon', month: '2026-08', basedOn: 'champions-reg-mb' } });

  it('infers the kind of older snapshots', () => {
    expect(metaSourceKind({ source: { name: 'x', url: 'https://www.smogon.com/stats/2026-08/chaos/x-1760.json' } })).toBe('smogon');
    expect(metaSourceKind({ source: { name: 'x', url: 'https://example.com/' } })).toBe('manual');
  });

  it('prefers Smogon, then well-sampled early sources, then thin ones, then the carry-over', () => {
    const order = [carry, replays(10), tournaments(10), replays(MIN_REPLAY_GAMES), tournaments(MIN_TOURNAMENT_TEAMS), smogon].sort(compareSnapshots);
    expect(order.map((s) => `${s.source.kind}:${metaSourceRank(s)}`)).toEqual(['smogon:0', 'tournaments:2', 'replays:3', 'tournaments:4', 'replays:5', 'carryover:6']);
    expect(order.map(isProvisional)).toEqual([false, true, true, true, true, true]);
  });

  it('picks across files by source, then by date', () => {
    const file = (s: MetaSnapshot): MetaFile => ({ version: 1, generatedAt: s.updatedAt, regulations: { [s.regulationId]: s } });
    expect(pickSnapshot('champions-reg-mc', file(carry), file(smogon))?.source.kind).toBe('smogon');
    expect(pickSnapshot('champions-reg-mc', file(replays(500)), file(carry))?.source.kind).toBe('replays');
    const manual = snap({ source: { name: 'Official usage', url: 'https://example.com/' } });
    expect(pickSnapshot('champions-reg-mc', file(replays(500)), file(manual))?.source.name).toBe('Official usage');
  });
});
