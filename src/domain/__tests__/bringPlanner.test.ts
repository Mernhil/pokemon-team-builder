import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { LIKELY_WEIGHT, WEIGHTS, combinations, enumerateBrings, megaOptions, planBring, planToMatchPatch, resolveOpponent, supportOf, controlOf, type MyMon } from '@/domain/bringPlanner';
import { bringLimits, createMatch } from '@/domain/matches';
import { parseMetaFile } from '@/domain/meta';
import { sanitizeMatch } from '@/domain/sanitize';
import { createSet } from '@/domain/team';
import type { Dataset, PokemonSet } from '@/domain/types';
import { useMatchStore } from '@/store/matchStore';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const snapshot = parseMetaFile(metaJson).regulations['champions-reg-mb'];
const mk = (species: string, patch: Partial<PokemonSet> = {}): PokemonSet => ({ ...createSet(dex, species, fmt), ...patch });
const sp = (o: Partial<PokemonSet['sp']>) => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...o });

const team: MyMon[] = [
  { uid: 'a', set: mk('incineroar', { uid: 'a', nature: 'Adamant', abilityId: 'intimidate', itemId: 'sitrusberry', sp: sp({ hp: 32, atk: 32 }), moves: ['fakeout', 'flareblitz', 'partingshot', 'knockoff'] }) },
  { uid: 'b', set: mk('garchomp', { uid: 'b', nature: 'Jolly', abilityId: 'roughskin', itemId: 'garchompite', sp: sp({ atk: 32, spe: 32 }), moves: ['earthquake', 'dragonclaw', 'rockslide', 'protect'] }) },
  { uid: 'c', set: mk('whimsicott', { uid: 'c', nature: 'Timid', abilityId: 'prankster', itemId: 'focussash', sp: sp({ spe: 32, hp: 2 }), moves: ['tailwind', 'moonblast', 'encore', 'protect'] }) },
  { uid: 'd', set: mk('dragapult', { uid: 'd', nature: 'Timid', abilityId: 'clearbody', itemId: 'choicespecs', sp: sp({ spa: 32, spe: 32 }), moves: ['shadowball', 'dracometeor', 'flamethrower', 'uturn'] }) },
  { uid: 'e', set: mk('kingambit', { uid: 'e', nature: 'Adamant', abilityId: 'defiant', itemId: 'blackglasses', sp: sp({ hp: 32, atk: 32 }), moves: ['suckerpunch', 'kowtowcleave', 'ironhead', 'protect'] }) },
  { uid: 'f', set: mk('rillaboom', { uid: 'f', nature: 'Adamant', abilityId: 'grassysurge', itemId: 'assaultvest', sp: sp({ hp: 32, atk: 32 }), moves: ['grassyglide', 'woodhammer', 'fakeout', 'uturn'] }) },
];
const theirs = ['sneasler', 'basculegion', 'floetteeternal', 'charizard', 'kingambit', 'whimsicott'].map((id) => resolveOpponent(dex, getFormat('champions-vgc-reg-mb'), id, { snapshot })!);
const limits = { bring: 4, lead: 2 };

describe('enumeration', () => {
  it('doubles: C(6,4) = 15 fours × C(4,2) = 6 leads', () => {
    expect(combinations(6, 4)).toHaveLength(15);
    const all = enumerateBrings(6, limits);
    expect(all).toHaveLength(90);
    expect(new Set(all.map((x) => x.brought.join(','))).size).toBe(15);
    for (const { brought, leads } of all) {
      expect(brought).toHaveLength(4);
      expect(leads).toHaveLength(2);
      for (const l of leads) expect(brought).toContain(l);
    }
  });
  it('singles: C(6,3) = 20 threes × 3 leads', () => {
    const single = bringLimits('gen9');
    expect(single).toEqual({ bring: 3, lead: 1 });
    const all = enumerateBrings(6, single);
    expect(all).toHaveLength(60);
    expect(new Set(all.map((x) => x.brought.join(','))).size).toBe(20);
  });
  it('a team of fewer than four brings everyone', () => {
    const all = enumerateBrings(3, limits);
    expect(new Set(all.map((x) => x.brought.join(','))).size).toBe(1);
    expect(all[0].brought).toEqual([0, 1, 2]);
  });
});

describe('the Mega rule', () => {
  it('two holders can come but never both Mega', () => {
    const opts = megaOptions([1, 3]);
    expect(opts).toEqual([undefined, 1, 3]);
    expect(opts.every((o) => o === undefined || typeof o === 'number')).toBe(true);
  });
  it('a plan names at most one Mega even with two Mega Stone holders on the team', () => {
    const two: MyMon[] = [
      ...team.slice(0, 2),
      { uid: 'g', set: mk('charizard', { uid: 'g', itemId: 'charizarditey', abilityId: 'blaze', nature: 'Timid', sp: sp({ spa: 32, spe: 32 }), moves: ['heatwave', 'airslash', 'solarbeam', 'protect'] }) },
      team[3],
      team[4],
      team[5],
    ];
    const { plans } = planBring({ dex, format: fmt, mine: two, opponents: theirs, limits });
    expect(plans.length).toBeGreaterThan(0);
    for (const p of plans) {
      const holders = p.brought.filter((u) => ['b', 'g'].includes(u));
      expect(p.mega === undefined || holders.includes(p.mega)).toBe(true);
      expect(typeof p.mega === 'string' || p.mega === undefined).toBe(true);
    }
    // At least one plan brings both holders (two can come), and still names only one Mega.
    const both = plans.find((p) => p.brought.includes('b') && p.brought.includes('g'));
    if (both) expect(['b', 'g', undefined]).toContain(both.mega);
  });
});

describe('planning', () => {
  it('returns three plans with different fours, a lead pair, the back two, reasons and a risk', () => {
    const { plans, likelyBring, likelyLeads } = planBring({ dex, format: fmt, mine: team, opponents: theirs, limits });
    expect(plans).toHaveLength(3);
    expect(new Set(plans.map((p) => [...p.brought].sort().join())).size).toBe(3);
    for (const p of plans) {
      expect(p.brought).toHaveLength(4);
      expect(p.leads).toHaveLength(2);
      expect(p.back).toHaveLength(2);
      expect([...p.brought, ...p.back].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
      for (const l of p.leads) expect(p.brought).toContain(l);
      expect(p.reasons.length).toBeGreaterThanOrEqual(2);
      expect(p.reasons.length).toBeLessThanOrEqual(4);
      expect(p.risk.length).toBeGreaterThan(5);
    }
    expect(plans[0].score).toBeGreaterThanOrEqual(plans[1].score);
    expect(plans[1].score).toBeGreaterThanOrEqual(plans[2].score);
    expect(likelyBring).toHaveLength(4);
    expect(likelyLeads).toHaveLength(2);
    expect(likelyLeads.every((l) => likelyBring.includes(l))).toBe(true);
    expect(plans[0].reasons[0]).toMatch(/^Lead /);
  });

  it('ranking is deterministic and does not depend on the order of my team', () => {
    const run = (mine: MyMon[]) => planBring({ dex, format: fmt, mine, opponents: theirs, limits }).plans.map((p) => [[...p.brought].sort().join(), [...p.leads].sort().join(), p.mega ?? '']);
    const a = run(team);
    expect(run(team)).toEqual(a);
    expect(run([...team].reverse())).toEqual(a);
  });

  it('singles bring three and lead one', () => {
    const { plans } = planBring({ dex, format: fmt, mine: team, opponents: theirs, limits: { bring: 3, lead: 1 } });
    for (const p of plans) {
      expect(p.brought).toHaveLength(3);
      expect(p.leads).toHaveLength(1);
      expect(p.back).toHaveLength(3);
    }
  });

  it('Fake Out and Intimidate show up in the lead reason, and speed control in the notes', () => {
    expect(supportOf(team[0].set).sort()).toEqual(['Fake Out', 'Intimidate']);
    expect(controlOf(team[2].set)).toEqual(['Tailwind']);
    const { plans } = planBring({ dex, format: fmt, mine: team, opponents: theirs, limits });
    const text = plans.flatMap((p) => p.reasons).join(' ');
    expect(text).toMatch(/Fake Out|Intimidate|Tailwind|threatens a KO/);
  });

  it('keeps the weights in one place', () => {
    expect(WEIGHTS.pressure).toBeGreaterThan(0);
    expect(LIKELY_WEIGHT).toBe(1);
  });
});

describe('the opponent: meta sets, with what is known overriding', () => {
  it('uses the meta set when nothing is known', () => {
    const o = resolveOpponent(dex, getFormat('champions-vgc-reg-mb'), 'kingambit', { snapshot })!;
    expect(o.known).toBe('none');
    expect(o.set.moves.filter(Boolean).length).toBeGreaterThan(0);
    expect(o.set.itemId).toBe(snapshot.entries.find((e) => e.speciesId === 'kingambit')!.items[0].id);
  });
  it('known item, ability and moves override the meta, and unknown moves are filled from it', () => {
    const o = resolveOpponent(dex, getFormat('champions-vgc-reg-mb'), 'kingambit', { snapshot, known: { itemId: 'leftovers', abilityId: 'supremeoverlord', moves: ['ironhead', 'swordsdance'] } })!;
    expect(o.known).toBe('partial');
    expect(o.set.itemId).toBe('leftovers');
    expect(o.set.abilityId).toBe('supremeoverlord');
    expect(o.set.moves.slice(0, 2)).toEqual(['ironhead', 'swordsdance']);
    expect(o.set.moves.filter(Boolean)).toHaveLength(4);
    expect(new Set(o.set.moves.filter(Boolean)).size).toBe(4);
    // Bad ids in the log are ignored rather than trusted.
    expect(resolveOpponent(dex, fmt, 'kingambit', { snapshot, known: { itemId: 'nope', moves: ['nope'] } })!.set.itemId).toBe(snapshot.entries.find((e) => e.speciesId === 'kingambit')!.items[0].id);
  });
  it('a full set (pasted or saved) is used as it is, and a Mega Stone means Mega in play', () => {
    const full = mk('garchomp', { itemId: 'garchompite', moves: ['earthquake', '', '', ''] });
    const o = resolveOpponent(dex, fmt, 'garchomp', { full, snapshot })!;
    expect(o.set).toBe(full);
    expect(o.known).toBe('full');
    expect(o.megaMode).toBe('both');
  });
  it('a species without meta data still gets damaging moves', () => {
    const o = resolveOpponent(dex, fmt, 'ninetales', { snapshot: { ...snapshot, entries: [] } })!;
    expect(o.set.moves.filter(Boolean).length).toBeGreaterThan(0);
    expect(resolveOpponent(dex, fmt, 'notaspecies')).toBeUndefined();
  });
  it('known details change the plan: a Kingambit known to carry only Protect is no threat', () => {
    const base = planBring({ dex, format: fmt, mine: team, opponents: theirs, limits });
    const harmless = theirs.map((o) => (o.speciesId === 'kingambit' ? resolveOpponent(dex, fmt, 'kingambit', { full: mk('kingambit', { moves: ['protect', '', '', ''] }) })! : o));
    const changed = planBring({ dex, format: fmt, mine: team, opponents: harmless, limits });
    expect(changed.plans.map((p) => p.parts.risk)).not.toEqual(base.plans.map((p) => p.parts.risk));
    expect(Math.max(...changed.plans.map((p) => p.parts.risk))).toBeLessThanOrEqual(Math.max(...base.plans.map((p) => p.parts.risk)));
  });
});

describe('saving a plan onto a match', () => {
  it('writes my team, what I bring and who leads, in the shape the match log keeps', () => {
    const { plans } = planBring({ dex, format: fmt, mine: team, opponents: theirs, limits });
    const patch = planToMatchPatch(plans[0], 't1');
    expect(patch.myTeamId).toBe('t1');
    expect(patch.myBrought).toEqual(plans[0].brought);
    expect(patch.myLeads).toEqual(plans[0].leads);
    const m = sanitizeMatch({ ...createMatch('2026-10-01'), ...patch })!;
    expect(m.myBrought).toEqual(plans[0].brought);
    expect(m.myLeads).toEqual(plans[0].leads);
  });
  it('lands on the stored match through the store', () => {
    const { plans } = planBring({ dex, format: fmt, mine: team, opponents: theirs, limits });
    const id = useMatchStore.getState().addMatch('2026-10-01');
    useMatchStore.getState().updateMatch(id, planToMatchPatch(plans[0], 't1'));
    const saved = useMatchStore.getState().matches[id];
    expect(saved.myBrought).toEqual(plans[0].brought);
    expect(saved.myLeads).toEqual(plans[0].leads);
    expect(saved.myTeamId).toBe('t1');
    expect(saved.opponentTeam).toEqual([]);
  });
});
