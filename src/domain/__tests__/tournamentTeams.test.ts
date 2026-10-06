import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { emptyGame, prefillOpponent } from '@/domain/gameday';
import { parseMetaFile, type MetaSnapshot } from '@/domain/meta';
import { teamFromDecklist, type TeamRecord } from '@/domain/metaSources';
import { tournamentTeamToTeam } from '@/domain/tournamentImport';
import {
  TT_CAP,
  filterTournamentTeams,
  parseStanding,
  parseTournamentTeams,
  selectTopCuts,
  sortTournamentTeams,
  placingLabel,
  type RawEvent,
  type TournamentRegulation,
} from '@/domain/tournamentTeams';
import { validateTeam } from '@/domain/validation';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mb');
const snapshot: MetaSnapshot = parseMetaFile(metaJson).regulations['champions-reg-mb'];

/** Six different legal Pokémon from the meta, each with its most-used legal item (no repeats), ability and four moves. */
function sixLegal(offset = 0): TeamRecord {
  const team: TeamRecord = [];
  const items = new Set<string>();
  for (const e of snapshot.entries.slice(offset)) {
    const sp = dex.species(e.speciesId);
    if (!sp || !sp.legalIn.includes('champions-reg-mb')) continue;
    const item = e.items.map((i) => dex.item(i.id)).find((i) => i && i.legalIn.includes('champions-reg-mb') && !items.has(i.id) && (!i.megaStone || dex.megaFor(sp.id, i.id)));
    const moves = e.moves.map((m) => dex.move(m.id)).filter((m) => m && dex.canLearn(sp.id, m.id) && m.legalIn.includes('champions-reg-mb')).slice(0, 4).map((m) => m!.id);
    if (!item || moves.length < 4) continue;
    items.add(item.id);
    team.push({ speciesId: sp.id, brought: true, itemId: item.id, abilityId: dex.ability(e.abilities[0]?.id)?.id, moves });
    if (team.length === 6) break;
  }
  return team;
}

const standing = (placing: number, team: TeamRecord) => ({ placing, player: `Player ${placing}`, team });
const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n)).toISOString().slice(0, 10);
const event = (n: number, players: number, rows = 8): RawEvent => ({
  id: `ev${n}`,
  name: `Event ${n}`,
  date: day(n),
  players,
  standings: Array.from({ length: rows }, (_, i) => standing(i + 1, sixLegal(i % 3))),
});

describe('parsing standings', () => {
  const resolve = (name: string) => (dex.species(name.toLowerCase().replace(/[^a-z0-9]/g, ''))?.id);
  it('reads placing, player and the open team sheet; skips rows without a team list', () => {
    const decklist = [
      { name: 'Incineroar', item: 'Sitrus Berry', ability: 'Intimidate', attacks: ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Knock Off'] },
      { name: 'Garchomp', item: 'Garchompite', ability: 'Rough Skin', attacks: ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect'] },
      { name: 'Whimsicott', item: 'Focus Sash', ability: 'Prankster', attacks: ['Tailwind', 'Moonblast', 'Encore', 'Protect'] },
      { name: 'Rillaboom', item: 'Assault Vest', ability: 'Grassy Surge', attacks: ['Grassy Glide', 'Wood Hammer', 'Fake Out', 'U-turn'] },
    ];
    const row = parseStanding({ placing: 3, name: '  Ash   Ketchum ', player: 'ash', decklist }, (d) => teamFromDecklist(d, resolve));
    expect(row).toMatchObject({ placing: 3, player: 'Ash Ketchum' });
    expect(row!.team.map((m) => m.speciesId)).toEqual(['incineroar', 'garchomp', 'whimsicott', 'rillaboom']);
    expect(row!.team[0].moves).toEqual(['fakeout', 'flareblitz', 'partingshot', 'knockoff']);
    expect(parseStanding({ placing: 1, decklist: null }, (d) => teamFromDecklist(d, resolve))).toBeNull();
    expect(parseStanding({ placing: 0, decklist }, (d) => teamFromDecklist(d, resolve))).toBeNull();
    expect(parseStanding({ decklist }, (d) => teamFromDecklist(d, resolve))).toBeNull();
    expect(parseStanding({ placing: 2, player: 'bob', decklist }, (d) => teamFromDecklist(d, resolve))!.player).toBe('bob');
  });
});

describe('selecting top cuts', () => {
  const today = day(80);
  it('keeps the top 8 of recent events with enough players, newest first, each linked to Limitless', () => {
    const reg = selectTopCuts([event(40, 64, 20), event(75, 31), event(76, 40), event(10, 100)], { today });
    expect(reg.events.map((e) => e.id)).toEqual(['ev76', 'ev40']); // 75: too small; 10: older than 60 days
    expect(reg.teams.filter((t) => t.e === 1)).toHaveLength(8);
    expect(Math.max(...reg.teams.map((t) => t.p))).toBe(8);
    expect(reg.events[0].url).toBe('https://play.limitlesstcg.com/tournament/ev76');
    expect(reg.teams[0]).toMatchObject({ e: 0, p: 1 });
  });

  it('caps the teams per regulation, dropping the oldest, and the file stays small', () => {
    const many = Array.from({ length: 60 }, (_, i) => event(30 + (i % 50), 64, 8)).map((e, i) => ({ ...e, id: `e${i}`, date: day(30 + Math.floor(i / 2)) }));
    const reg = selectTopCuts(many, { today: day(90), days: 100 });
    expect(reg.teams.length).toBe(TT_CAP);
    expect(reg.teams.every((t) => t.e < reg.events.length)).toBe(true);
    expect(reg.events[0].date >= reg.events.at(-1)!.date).toBe(true);
    expect(JSON.stringify(reg).length).toBeLessThan(200_000);
  });

  it('drops illegal teams and validates as a file', () => {
    const reg = selectTopCuts([event(70, 64)], { today, legal: (t) => t[0].speciesId !== sixLegal(1)[0].speciesId });
    expect(reg.teams.length).toBeLessThan(8);
    const file = { version: 1 as const, generatedAt: today, regulations: { 'champions-reg-mb': reg } };
    expect(parseTournamentTeams(JSON.parse(JSON.stringify(file))).regulations['champions-reg-mb'].teams).toHaveLength(reg.teams.length);
    expect(() => parseTournamentTeams({ ...file, regulations: { x: { events: [], teams: reg.teams } } })).toThrow(/missing event/);
  });
});

describe('filters and sorting', () => {
  const reg: TournamentRegulation = selectTopCuts([event(60, 64), event(70, 64)], { today: day(80) });
  const isMega = (s: string, i: string) => !!i && !!dex.megaFor(s, i);
  const has = (id: string) => reg.teams.filter((t) => t.m.some((m) => m[0] === id));

  it('filters by several species at once', () => {
    const [a, b] = [sixLegal(0)[0].speciesId, sixLegal(0)[1].speciesId];
    expect(filterTournamentTeams(reg, { species: [a] }, { isMega })).toHaveLength(has(a).length);
    expect(filterTournamentTeams(reg, { species: [a, b] }, { isMega }).every((t) => t.m.some((m) => m[0] === a) && t.m.some((m) => m[0] === b))).toBe(true);
    expect(filterTournamentTeams(reg, { species: ['notamon'] }, { isMega })).toEqual([]);
  });

  it('filters by Mega, archetype and date range', () => {
    const withMega = filterTournamentTeams(reg, { mega: true }, { isMega });
    const without = filterTournamentTeams(reg, { mega: false }, { isMega });
    expect(withMega.length + without.length).toBe(reg.teams.length);
    expect(withMega.every((t) => t.m.some((m) => isMega(m[0], m[1])))).toBe(true);
    expect(filterTournamentTeams(reg, { archetype: 'Rain' }, { isMega, archetypeOf: (t) => (t.p === 1 ? 'Rain' : undefined) }).every((t) => t.p === 1)).toBe(true);
    const from = filterTournamentTeams(reg, { from: day(65) }, { isMega });
    expect(from.length).toBe(8);
    expect(filterTournamentTeams(reg, { from: day(61), to: day(69) }, { isMega })).toEqual([]);
  });

  it('sorts by date or by placing', () => {
    const byDate = sortTournamentTeams(reg, reg.teams, 'date');
    expect(reg.events[byDate[0].e].date).toBe(day(70));
    const byPlacing = sortTournamentTeams(reg, reg.teams, 'placing');
    expect(byPlacing.map((t) => t.p)).toEqual(byPlacing.map((t) => t.p).sort((a, b) => a - b));
    expect(placingLabel(1)).toBe('1st');
    expect(placingLabel(8)).toBe('8th');
  });
});

describe('using a tournament team', () => {
  const reg = selectTopCuts([event(70, 64)], { today: day(80) });
  const t = reg.teams[0];
  const ev = reg.events[0];

  it('imports as a team that passes validateTeam for the regulation, in "Tournament teams", with the source in its notes', () => {
    const { team, dropped } = tournamentTeamToTeam(t, ev, dex, fmt, snapshot, 'Reg M-B');
    expect(dropped).toEqual([]);
    expect(team.category).toBe('Tournament teams');
    expect(team.notes).toContain('https://play.limitlesstcg.com/tournament/ev70');
    expect(team.slots.filter(Boolean)).toHaveLength(6);
    expect(validateTeam(team, fmt, dex).filter((i) => i.severity === 'error')).toEqual([]);
    // the sheet's own item, ability and moves survive
    const first = team.slots[0]!;
    expect(first.itemId).toBe(t.m[0][1]);
    expect(first.moves.filter(Boolean)).toEqual(t.m[0][3]);
  });

  it('marks every spread as estimated: the meta spread where there is one, else from base stats', () => {
    const { team, estimated } = tournamentTeamToTeam(t, ev, dex, fmt, snapshot, 'Reg M-B');
    expect(estimated).toHaveLength(6);
    for (const s of team.slots) expect(s!.notes).toMatch(/Spread estimated/);
    const noMeta = tournamentTeamToTeam(t, ev, dex, fmt, undefined, 'Reg M-B');
    for (const s of noMeta.team.slots) {
      expect(s!.notes).toMatch(/Spread estimated from base stats/);
      expect(Object.values(s!.sp).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(66);
    }
    expect(team.notes).toMatch(/spreads are estimated/);
  });

  it('leaves out and reports what the regulation does not allow', () => {
    const bad = { ...t, m: [['pikachuxx', '', '', []], ...t.m.slice(1)] as typeof t.m };
    const r = tournamentTeamToTeam(bad as typeof t, ev, dex, fmt, snapshot, 'Reg M-B');
    expect(r.dropped[0]).toMatch(/isn't legal in Reg M-B/);
    expect(r.team.slots.filter(Boolean)).toHaveLength(5);
  });

  it('pre-fills Game day with their six and what the sheet shows', () => {
    const g = prefillOpponent({ myTeamId: 'mine' }, t.m.map(([speciesId, itemId, abilityId, moves]) => ({ speciesId, itemId, abilityId, moves })));
    expect(g.myTeamId).toBe('mine');
    expect(g.opponents).toEqual(t.m.map((m) => m[0]));
    expect(g.reveals[t.m[0][0]]).toMatchObject({ itemId: t.m[0][1], moves: t.m[0][3] });
    expect(prefillOpponent({}, []).opponents).toEqual(emptyGame().opponents);
  });
});
