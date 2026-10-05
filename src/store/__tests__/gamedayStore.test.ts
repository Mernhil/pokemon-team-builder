import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyGame } from '@/domain/gameday';
import { getFormat } from '@/domain/formats';
import { createMatch } from '@/domain/matches';
import { createTeam } from '@/domain/team';
import type { PokemonSet } from '@/domain/types';
import { migrateGameDay, useGameDayStore } from '../gamedayStore';
import { useMatchStore } from '../matchStore';

const fmt = getFormat('champions-vgc-reg-mc');
const mon = (uid: string) => ({ uid, speciesId: 'garchomp' }) as unknown as PokemonSet;
const team = { ...createTeam(fmt), id: 'team1', name: 'Rain', slots: [mon('u1'), mon('u2'), mon('u3'), mon('u4'), mon('u5'), null] as never };
const limits = { bring: 4, lead: 2 };

beforeEach(() => {
  useGameDayStore.setState({ ...emptyGame('team1') });
  useMatchStore.setState({ matches: {}, order: [] });
});

describe('gameday store', () => {
  it('adds and removes their Pokémon, and undoes the last', () => {
    const s = useGameDayStore.getState();
    s.add('kingambit');
    s.add('sneasler');
    s.add('garchomp');
    s.remove('sneasler');
    expect(useGameDayStore.getState().opponents).toEqual(['kingambit', 'garchomp']);
    useGameDayStore.getState().undo();
    expect(useGameDayStore.getState().opponents).toEqual(['kingambit']);
  });

  it('keeps the chosen plan until their six change', () => {
    const s = useGameDayStore.getState();
    s.add('kingambit');
    s.choosePlan(2);
    s.setBring({ brought: ['u1', 'u2'], leads: ['u1'] });
    expect(useGameDayStore.getState()).toMatchObject({ planIndex: 2, bring: { brought: ['u1', 'u2'], leads: ['u1'] } });
    useGameDayStore.getState().add('sneasler');
    expect(useGameDayStore.getState()).toMatchObject({ planIndex: 0, bring: undefined });
  });

  it('switching teams starts the game over, picking the same team does not', () => {
    const s = useGameDayStore.getState();
    s.add('kingambit');
    s.setTeam('team1');
    expect(useGameDayStore.getState().opponents).toEqual(['kingambit']);
    useGameDayStore.getState().setTeam('team2');
    expect(useGameDayStore.getState()).toMatchObject({ myTeamId: 'team2', opponents: [] });
  });

  it('logs the match with what was brought, led and shown, then starts the next game on the same team', () => {
    const s = useGameDayStore.getState();
    for (const id of ['kingambit', 'sneasler', 'garchomp', 'rillaboom', 'incineroar', 'whimsicott']) s.add(id);
    s.reveal('kingambit', { itemId: 'blackglasses', moves: ['suckerpunch'] });
    s.setOppBring({ brought: ['kingambit', 'sneasler'], leads: ['kingambit'] });
    s.setNotes('lost to Tailwind');
    const id = useGameDayStore.getState().logMatch({ result: 'win', team, plan: { brought: ['u1', 'u2', 'u3', 'u4'], leads: ['u1', 'u2'] }, regulationId: 'champions-reg-mc', limits, archetypes: { opponentArchetype: 'Rain' } });
    const m = useMatchStore.getState().matches[id];
    expect(m).toMatchObject({ result: 'win', regulationId: 'champions-reg-mc', category: 'Ranked Ladder', myTeamId: 'team1', myBrought: ['u1', 'u2', 'u3', 'u4'], myLeads: ['u1', 'u2'], oppBrought: ['kingambit', 'sneasler'], oppLeads: ['kingambit'], opponentArchetype: 'Rain', notes: 'lost to Tailwind' });
    expect(m.opponentTeam).toHaveLength(6);
    expect(m.opponentTeam[0]).toEqual({ speciesId: 'kingambit', itemId: 'blackglasses', moves: ['suckerpunch'] });
    expect(useMatchStore.getState().order).toEqual([id]);
    // Next game: their six are gone, my team stays.
    expect(useGameDayStore.getState()).toMatchObject({ ...emptyGame('team1') });
  });

  it('next game clears theirs and keeps my team', () => {
    const s = useGameDayStore.getState();
    s.add('kingambit');
    s.setNotes('x');
    useGameDayStore.getState().nextGame();
    expect(useGameDayStore.getState()).toMatchObject({ ...emptyGame('team1') });
  });

  it('does not touch the match log until a game is logged', () => {
    useGameDayStore.getState().add('kingambit');
    expect(useMatchStore.getState().order).toEqual([]);
    expect(Object.keys(createMatch())).toContain('opponentTeam');
  });
});

describe('persistence', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('survives a reload: the opponent\'s six and the plan come back', async () => {
    useGameDayStore.getState().add('kingambit');
    useGameDayStore.getState().add('sneasler');
    useGameDayStore.getState().choosePlan(1);
    const saved = localStorage.getItem('ptb:gameday:v1');
    expect(saved).toBeTruthy();
    // A reload: the page forgets its state, the saved copy is what it starts from.
    useGameDayStore.setState({ ...emptyGame() });
    localStorage.setItem('ptb:gameday:v1', saved!);
    await useGameDayStore.persist.rehydrate();
    expect(useGameDayStore.getState()).toMatchObject({ myTeamId: 'team1', opponents: ['kingambit', 'sneasler'], planIndex: 1 });
  });

  it('loads a damaged save as what is valid in it', async () => {
    const saved = { version: 1, state: { myTeamId: 'team1', opponents: ['kingambit', 7, null, '!!'], planIndex: 'x', notes: 5 } };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved), setItem: () => {}, removeItem: () => {} });
    await useGameDayStore.persist.rehydrate();
    expect(useGameDayStore.getState()).toMatchObject({ myTeamId: 'team1', opponents: ['kingambit'], planIndex: 0, notes: '' });
  });

  it('migrates any older shape through the sanitiser', () => {
    expect(migrateGameDay(undefined)).toEqual(emptyGame());
    expect(migrateGameDay({ opponents: ['kingambit'], extra: 1 }).opponents).toEqual(['kingambit']);
  });
});
