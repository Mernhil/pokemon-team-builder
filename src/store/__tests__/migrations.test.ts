import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEAM_BACKUP_V2_KEY, useTeamStore } from '../teamStore';
import { MATCH_BACKUP_V1_KEY, useMatchStore } from '../matchStore';
import { useCalcStore } from '../calcStore';

/** In-memory localStorage, so the stores' real persist/rehydrate path runs in node. */
function fakeStorage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

const set = (speciesId: string, teraType?: string) => ({
  uid: `u-${speciesId}`,
  speciesId,
  abilityId: 'intimidate',
  itemId: 'sitrusberry',
  nature: 'Careful',
  teraType,
  moves: ['fakeout', 'flareblitz', 'partingshot', 'knockoff'],
  level: 50,
  sp: { hp: 32, atk: 0, def: 20, spa: 0, spd: 14, spe: 0 },
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});
const empty = [null, null, null, null, null];

/** A v2 save exactly as 0.6.x wrote it: Champions teams carried a Tera Type by default. */
const V2_SAVE = {
  version: 2,
  state: {
    teams: {
      champ: { id: 'champ', name: 'Champions team', formatId: 'champions-vgc-reg-mc', category: 'Reg M-C', slots: [set('incineroar', 'Grass'), ...empty], createdAt: 1, updatedAt: 2 },
      sv: {
        id: 'sv',
        name: 'SV team',
        formatId: 'gen9',
        slots: [set('incineroar', 'Ghost'), ...empty],
        // Its Champions roster, kept from an earlier format switch, has a Tera Type too.
        slotsByFormat: { 'champions-vgc-reg-mc': [set('garchomp', 'Steel'), ...empty] },
        createdAt: 1,
        updatedAt: 3,
      },
      variation: { id: 'variation', name: 'Champions team', formatId: 'champions-vgc-reg-mc', groupId: 'champ', variationLabel: 'vs Rain', slots: [set('pelipper', 'Water'), ...empty], createdAt: 1, updatedAt: 4 },
    },
    order: ['sv', 'champ'],
    activeTeamId: 'champ',
    theme: 'light',
    view: 'calc',
    battle: {},
  },
};

describe('0.6.x saves (teams v2, matches v1, calc v1) → current', () => {
  let storage: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    storage = fakeStorage({
      'ptb:v1': JSON.stringify(V2_SAVE),
      'ptb:matches:v1': JSON.stringify({
        version: 1,
        state: {
          matches: {
            m1: {
              id: 'm1',
              date: '2026-08-01',
              result: 'win',
              regulationId: 'champions-reg-mc',
              opponentTeam: [{ speciesId: 'garchomp', teraType: 'Steel', moves: ['earthquake'] }],
              myTeam: [{ speciesId: 'incineroar', teraType: 'Grass' }],
              createdAt: 1,
              updatedAt: 1,
            },
          },
          order: ['m1'],
        },
      }),
      'ptb:calc:v1': JSON.stringify({
        version: 1,
        state: {
          attacker: { set: set('garchomp', 'Steel'), cond: { tera: true, mega: false }, crits: [false, false, false, false] },
          defender: { set: null, cond: { tera: false }, crits: [false, false, false, false] },
          field: { gameType: 'Doubles', weather: '', terrain: '', trickRoom: false, gravity: false },
        },
      }),
    });
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps every team, folder and variation, and strips Tera only outside Scarlet/Violet', async () => {
    await useTeamStore.persist.rehydrate();
    const s = useTeamStore.getState();

    expect(Object.keys(s.teams).sort()).toEqual(['champ', 'sv', 'variation']);
    expect(s.order).toEqual(['sv', 'champ']);
    expect(s.activeTeamId).toBe('champ');
    expect(s.theme).toBe('light');
    expect(s.teams.variation.groupId).toBe('champ');
    expect(s.teams.variation.variationLabel).toBe('vs Rain');

    expect(s.teams.champ.slots[0]!.teraType).toBeUndefined();
    expect(s.teams.variation.slots[0]!.teraType).toBeUndefined();
    expect(s.teams.sv.slots[0]!.teraType).toBe('Ghost');
    expect(s.teams.sv.slotsByFormat!['champions-vgc-reg-mc'][0]!.teraType).toBeUndefined();

    // Everything else about the sets is untouched.
    const { teraType: _t, ...rest } = V2_SAVE.state.teams.champ.slots[0]!;
    expect(s.teams.champ.slots[0]).toEqual(expect.objectContaining(rest));
    expect(s.teams.champ.name).toBe('Champions team');
    expect(s.teams.champ.updatedAt).toBe(2);

    // The original save is backed up once, verbatim, and the store now writes v3.
    const backup = JSON.parse(storage.getItem(TEAM_BACKUP_V2_KEY)!);
    expect(backup.version).toBe(2);
    expect(backup.state.teams.champ.slots[0].teraType).toBe('Grass');
    useTeamStore.getState().setTheme('dark');
    expect(JSON.parse(storage.getItem('ptb:v1')!).version).toBe(3);
  });

  it('never overwrites an existing backup', async () => {
    storage.setItem(TEAM_BACKUP_V2_KEY, 'earlier backup');
    await useTeamStore.persist.rehydrate();
    expect(storage.getItem(TEAM_BACKUP_V2_KEY)).toBe('earlier backup');
  });

  it('strips revealed Tera Types from Champions matches and backs the log up', async () => {
    await useMatchStore.persist.rehydrate();
    const m = useMatchStore.getState().matches.m1;
    expect(m.opponentTeam).toEqual([{ speciesId: 'garchomp', moves: ['earthquake'] }]);
    expect(m.myTeam).toEqual([{ speciesId: 'incineroar' }]);
    expect(JSON.parse(storage.getItem(MATCH_BACKUP_V1_KEY)!).state.matches.m1.opponentTeam[0].teraType).toBe('Steel');
  });

  it('clears the calculator’s Tera toggle and Tera Type', async () => {
    await useCalcStore.persist.rehydrate();
    const { attacker } = useCalcStore.getState();
    expect(attacker.cond.tera).toBe(false);
    expect(attacker.set!.teraType).toBeUndefined();
    expect(attacker.set!.speciesId).toBe('garchomp');
  });
});

describe('match log v2 → v3 (brought and led)', () => {
  const v2 = {
    version: 2,
    state: {
      matches: {
        old: { id: 'old', date: '2026-09-01', result: 'loss', regulationId: 'champions-reg-mc', opponentTeam: [{ speciesId: 'kingambit' }], myTeamId: 't1', createdAt: 5, updatedAt: 6 },
        weird: { id: 'weird', date: '2026-09-02', result: 'win', opponentTeam: [], myBrought: ['u1', 'u1', 7], myLeads: ['nope'] },
      },
      order: ['old', 'weird'],
      scoutYourTeamId: 't1',
    },
  };
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage({ 'ptb:matches:v1': JSON.stringify(v2) });
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps every match as it was and leaves the new fields empty', async () => {
    await useMatchStore.persist.rehydrate();
    const s = useMatchStore.getState();
    expect(s.order).toEqual(['old', 'weird']);
    expect(s.scoutYourTeamId).toBe('t1');
    expect(s.matches.old).toEqual(expect.objectContaining({ id: 'old', date: '2026-09-01', result: 'loss', myTeamId: 't1', createdAt: 5, updatedAt: 6, opponentTeam: [{ speciesId: 'kingambit' }] }));
    for (const k of ['myBrought', 'myLeads', 'oppBrought', 'oppLeads'] as const) expect(s.matches.old[k]).toBeUndefined();
    // A hand-edited or corrupted new field is sanitised rather than trusted.
    expect(s.matches.weird.myBrought).toEqual(['u1']);
    expect(s.matches.weird.myLeads).toBeUndefined();
  });

  it('no backup is made (the change is additive) and the next write is v3', async () => {
    await useMatchStore.persist.rehydrate();
    expect(storage.getItem(MATCH_BACKUP_V1_KEY)).toBeNull();
    useMatchStore.getState().updateMatch('old', { myBrought: ['u1', 'u2'], myLeads: ['u1'], oppBrought: ['kingambit'] });
    const saved = JSON.parse(storage.getItem('ptb:matches:v1')!);
    expect(saved.version).toBe(3);
    expect(saved.state.matches.old.myLeads).toEqual(['u1']);
    await useMatchStore.persist.rehydrate();
    expect(useMatchStore.getState().matches.old.oppBrought).toEqual(['kingambit']);
  });

  it('a v3 save is read unchanged', async () => {
    storage.setItem('ptb:matches:v1', JSON.stringify({ version: 3, state: { matches: { a: { id: 'a', date: '2026-10-01', result: 'win', opponentTeam: [{ speciesId: 'garchomp' }], oppBrought: ['garchomp'], oppLeads: ['garchomp'] } }, order: ['a'] } }));
    await useMatchStore.persist.rehydrate();
    expect(useMatchStore.getState().matches.a.oppLeads).toEqual(['garchomp']);
  });
});
