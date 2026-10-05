import { describe, expect, it } from 'vitest';
import { MAX_OPPONENTS, addOpponent, defaultTeam, emptyGame, matchFromGame, opponentLog, playableTeams, recentOpponents, removeOpponent, sanitizeGameDay, setReveal, speedOrder, topOpponents, undoOpponent } from '@/domain/gameday';
import { createTeam } from '@/domain/team';
import { getFormat } from '@/domain/formats';
import type { MetaSnapshot } from '@/domain/meta';
import type { PokemonSet, Team } from '@/domain/types';

const fmt = getFormat('champions-vgc-reg-mc');
const set = (uid: string, speciesId: string) => ({ uid, speciesId }) as unknown as PokemonSet;
const team = (id: string, uids: string[], over: Partial<Team> = {}): Team => ({ ...createTeam(fmt), id, name: id, category: 'Ranked', slots: [...uids.map((u) => set(u, u)), null, null, null, null, null, null].slice(0, 6) as never, ...over });
const limits = { bring: 4, lead: 2 };

describe('their six', () => {
  it('adds in order, ignores repeats and a seventh, and undoes the last', () => {
    let g = emptyGame('t');
    for (const s of ['kingambit', 'sneasler', 'kingambit', 'garchomp', 'rillaboom', 'incineroar', 'whimsicott', 'pelipper']) g = addOpponent(g, s);
    expect(g.opponents).toEqual(['kingambit', 'sneasler', 'garchomp', 'rillaboom', 'incineroar', 'whimsicott']);
    expect(g.opponents).toHaveLength(MAX_OPPONENTS);
    g = undoOpponent(g);
    expect(g.opponents.at(-1)).toBe('incineroar');
    expect(undoOpponent(emptyGame()).opponents).toEqual([]);
  });

  it('refuses ids that are not ids', () => {
    expect(addOpponent(emptyGame(), '').opponents).toEqual([]);
    expect(addOpponent(emptyGame(), 'Not An Id!').opponents).toEqual([]);
  });

  it('removing one drops what it showed and what was marked about it, and resets the plan choice', () => {
    let g = addOpponent(addOpponent(emptyGame('t'), 'kingambit'), 'sneasler');
    g = setReveal(g, 'kingambit', { itemId: 'blackglasses', moves: ['suckerpunch', ''] });
    g = { ...g, planIndex: 2, oppBring: { brought: ['kingambit', 'sneasler'], leads: ['kingambit'] } };
    const r = removeOpponent(g, 'kingambit');
    expect(r.reveals).toEqual({});
    expect(r.oppBring).toEqual({ brought: ['sneasler'], leads: [] });
    expect(r.planIndex).toBe(0);
  });

  it('what they showed replaces the note; an empty note removes it; unknown species are ignored', () => {
    let g = addOpponent(emptyGame(), 'kingambit');
    g = setReveal(g, 'kingambit', { itemId: 'blackglasses', abilityId: 'defiant', moves: ['suckerpunch', 'ironhead', ''] });
    expect(opponentLog(g)).toEqual([{ speciesId: 'kingambit', itemId: 'blackglasses', abilityId: 'defiant', moves: ['suckerpunch', 'ironhead'] }]);
    expect(setReveal(g, 'kingambit', {}).reveals).toEqual({});
    expect(setReveal(g, 'garchomp', { itemId: 'x' })).toBe(g);
  });

  it('offers the most used first, and the latest opponents without those already picked', () => {
    const snap = { entries: [{ speciesId: 'b', usageRank: 2 }, { speciesId: 'a', usagePct: 40 }, { speciesId: 'c', usagePct: 10 }] } as unknown as MetaSnapshot;
    expect(topOpponents(snap, 2)).toEqual(['a', 'c']);
    expect(topOpponents(undefined)).toEqual([]);
    const m = (date: string, ...ids: string[]) => ({ date, createdAt: 1, opponentTeam: ids.map((speciesId) => ({ speciesId })) });
    expect(recentOpponents([m('2026-09-01', 'x', 'y'), m('2026-09-03', 'z', 'x'), m('2026-09-02', 'w')], ['z'], 3)).toEqual(['x', 'w', 'y']);
  });
});

describe('sanitising a saved game', () => {
  it('loads garbage as an empty game, and keeps what is valid', () => {
    expect(sanitizeGameDay(null)).toEqual(emptyGame());
    expect(sanitizeGameDay('x')).toEqual(emptyGame());
    const g = sanitizeGameDay({
      myTeamId: 't1',
      opponents: ['kingambit', 42, '__proto__!', 'kingambit', 'a', 'b', 'c', 'd', 'e', 'f'],
      reveals: { kingambit: { itemId: 'blackglasses', moves: ['a', 5, 'b', 'c', 'd', 'e'] }, ghost: { itemId: 'x' } },
      planIndex: 9,
      bring: { brought: ['u1', 'u2'], leads: ['u2', 'nope'] },
      oppBring: { brought: ['kingambit', 'zzz'], leads: ['kingambit'] },
      notes: 'n'.repeat(900),
    });
    expect(g.opponents).toEqual(['kingambit', 'a', 'b', 'c', 'd', 'e']);
    expect(g.reveals).toEqual({ kingambit: { itemId: 'blackglasses', moves: ['a', 'b', 'c', 'd'] } });
    expect(g.planIndex).toBe(0);
    expect(g.bring).toEqual({ brought: ['u1', 'u2'], leads: ['u2'] });
    expect(g.oppBring).toEqual({ brought: ['kingambit'], leads: ['kingambit'] });
    expect(g.notes).toHaveLength(500);
  });
});

describe('my team', () => {
  const teams = { a: team('a', ['u1']), b: team('b', ['u2']), c: team('c', []), s: team('s', ['u3'], { shared: { owner: 'x@y.z', role: 'view' } as never }) };
  it('lists the saved, own, non-empty Champions teams in order', () => {
    expect(playableTeams(teams, ['c', 's', 'b', 'a'], () => true).map((t) => t.id)).toEqual(['b', 'a']);
    expect(playableTeams(teams, ['a', 'b'], (t) => t.id === 'b').map((t) => t.id)).toEqual(['b']);
  });
  it('starts on the team of the latest match, else the first', () => {
    const playable = playableTeams(teams, ['a', 'b'], () => true);
    expect(defaultTeam(playable, [{ date: '2026-09-01', createdAt: 1, myTeamId: 'a' }, { date: '2026-09-05', createdAt: 1, myTeamId: 'b' }, { date: '2026-09-09', createdAt: 1, myTeamId: 'gone' }])?.id).toBe('b');
    expect(defaultTeam(playable, [])?.id).toBe('a');
    expect(defaultTeam([], [])).toBeUndefined();
  });
});

describe('speed order', () => {
  const e = [
    { id: 'a', name: 'A', side: 'mine' as const, speed: 100 },
    { id: 'b', name: 'B', side: 'mine' as const, speed: 60 },
    { id: 'c', name: 'C', side: 'theirs' as const, speed: 80 },
    { id: 'd', name: 'D', side: 'theirs' as const, speed: 60 },
  ];
  it('is fastest first, flags a tie across sides, and reverses under Trick Room', () => {
    const rows = speedOrder(e);
    expect(rows.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(rows.find((r) => r.id === 'b')!.tie).toBe(true);
    expect(rows.find((r) => r.id === 'a')!.tie).toBe(false);
    expect(speedOrder(e, { trickRoom: true }).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
  });
  it('Tailwind doubles one side', () => {
    expect(speedOrder(e, { theirTailwind: true }).map((r) => [r.id, r.effective])).toEqual([['c', 160], ['d', 120], ['a', 100], ['b', 60]]);
    // Both sides with Tailwind: the order of the sides is unchanged.
    expect(speedOrder(e, { myTailwind: true, theirTailwind: true }).map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
  });
});

describe('the logged match', () => {
  it('carries the plan, what they showed and what they brought, within the limits', () => {
    let g = emptyGame('t');
    for (const s of ['kingambit', 'sneasler', 'garchomp', 'rillaboom', 'incineroar']) g = addOpponent(g, s);
    g = setReveal(g, 'kingambit', { itemId: 'blackglasses' });
    g = { ...g, oppBring: { brought: ['kingambit', 'sneasler', 'garchomp', 'rillaboom', 'incineroar'], leads: ['kingambit', 'sneasler', 'garchomp'] }, notes: ' close one ' };
    const t = team('t', ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
    const m = matchFromGame(g, { team: t, plan: { brought: ['u1', 'u2', 'u3', 'u4'], leads: ['u1', 'u2'] }, regulationId: 'champions-reg-mc', result: 'loss', limits });
    expect(m).toMatchObject({ result: 'loss', regulationId: 'champions-reg-mc', category: 'Ranked Ladder', myTeamId: 't', myBrought: ['u1', 'u2', 'u3', 'u4'], myLeads: ['u1', 'u2'], notes: 'close one' });
    expect(m.opponentTeam[0]).toEqual({ speciesId: 'kingambit', itemId: 'blackglasses' });
    expect(m.oppBrought).toHaveLength(4);
    expect(m.oppLeads).toEqual(['kingambit', 'sneasler']);
  });

  it('an edited bring beats the plan, and a Pokémon no longer on the team is dropped', () => {
    const g = { ...emptyGame('t'), bring: { brought: ['u1', 'gone', 'u3'], leads: ['u3'] } };
    const m = matchFromGame(g, { team: team('t', ['u1', 'u2', 'u3']), plan: { brought: ['u2'], leads: ['u2'] }, result: 'win', limits });
    expect(m.myBrought).toEqual(['u1', 'u3']);
    expect(m.myLeads).toEqual(['u3']);
    expect(m.oppBrought).toBeUndefined();
    expect(m.notes).toBeUndefined();
  });
});
