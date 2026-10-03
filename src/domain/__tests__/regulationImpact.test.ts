import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import changesJson from '@/data/generated/regulation-changes.json';
import mc from '@/data/regulations/champions-reg-mc.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { copyTeamToRegulation, daysUntil, regulationDiff, relevantRegulations, teamImpact, type RegulationChanges } from '@/domain/regulationImpact';
import { createSet, createTeam } from '@/domain/team';
import type { Dataset, PokemonSet, Team, TeamSlots } from '@/domain/types';
import { validateTeam } from '@/domain/validation';

const dex = new Dex(data as unknown as Dataset);
const changes = changesJson as unknown as RegulationChanges;
const MC = 'champions-reg-mc';
const MB = 'champions-reg-mb';
const MA = 'champions-reg-ma';
const fmtMC = getFormat('champions-vgc-reg-mc');
const fmtMB = getFormat('champions-vgc-reg-mb');

const teamOf = (format: typeof fmtMC, sets: (PokemonSet | null)[]): Team => ({ ...createTeam(format, 'Test'), slots: [...sets, null, null, null, null, null, null].slice(0, 6) as TeamSlots });
const mk = (id: string, patch: Partial<PokemonSet> = {}) => ({ ...createSet(dex, id, fmtMC), ...patch });

describe('regulation diff, real files', () => {
  const d = regulationDiff(dex, MB, MC, changes);

  it('M-B → M-C matches the delta file: counts of added species, Megas, items and moves', () => {
    expect(d.species.removed).toEqual([]);
    expect(d.megas.removed).toEqual([]);
    expect(d.items.removed).toEqual([]);
    expect(d.moves.removed).toEqual([]);
    expect(d.species.added.length + d.megas.added.length).toBe(mc.addSpecies.length);
    expect(d.megas.added.length).toBeGreaterThan(0);
    expect(d.items.added.length).toBe(mc.addItems.length);
    expect(d.moves.added.length).toBe(mc.addMoves.length);
    for (const id of mc.addSpecies) expect([...d.species.added, ...d.megas.added].some((s) => s.id === id)).toBe(true);
    // The new ability the delta defines comes in with the Pokémon that have it.
    expect(d.abilities.added.map((a) => a.id)).toContain('auraguard');
  });

  it('lists the species patches with before → after, and the unconfirmed species', () => {
    expect(d.patches).toHaveLength(Object.keys(mc.speciesPatches).length);
    const garchomp = d.patches.find((p) => p.speciesId === 'garchompmegaz')!;
    expect(garchomp).toMatchObject({ field: 'ability', before: 'Sand Force', after: 'Levitate' });
    const baxcalibur = d.patches.find((p) => p.speciesId === 'baxcaliburmega')!;
    expect(baxcalibur).toMatchObject({ label: 'Hidden Ability', before: 'Ice Body', after: '—' });
    expect(d.unconfirmed).toHaveLength(1);
    expect(d.unconfirmed[0].speciesIds).toEqual(mc.unconfirmed.species);
    expect(d.unconfirmed[0].note).toBe(mc.unconfirmed.note);
  });

  it('going backwards swaps added and removed and before and after, and drops unconfirmed', () => {
    const back = regulationDiff(dex, MC, MB, changes);
    expect(back.species.removed).toEqual(d.species.added);
    expect(back.items.removed).toEqual(d.items.added);
    expect(back.moves.removed).toEqual(d.moves.added);
    const g = back.patches.find((p) => p.speciesId === 'garchompmegaz')!;
    expect([g.before, g.after]).toEqual(['Levitate', 'Sand Force']);
    expect(back.unconfirmed).toEqual([]);
  });

  it('Showdown-based sets work too: M-A → M-B follows the dataset, not a delta file', () => {
    const ab = regulationDiff(dex, MA, MB, changes);
    const net = ab.species.added.length + ab.megas.added.length - ab.species.removed.length - ab.megas.removed.length;
    const counts = Object.fromEntries(dex.data.regulations.map((r) => [r.id, r.speciesCount + r.megaCount]));
    expect(net).toBe(counts[MB] - counts[MA]);
    expect(ab.patches).toEqual([]);
    expect(regulationDiff(dex, MC, MC, changes).species.added).toEqual([]);
  });
});

/** Things that are legal in M-C but not in M-B, so a team using them breaks going back. */
const newSpecies = mc.addSpecies.find((id) => dex.species(id) && !dex.species(id)!.isMega && dex.species(id)!.legalIn.includes(MC))!;
const stone = mc.addItems.map((id) => dex.item(id)!).find((i) => i?.megaStone && Object.keys(i.megaStone).some((sp) => dex.species(sp)?.legalIn.includes(MB)))!;
const stoneHolder = Object.keys(stone.megaStone!).find((sp) => dex.species(sp)?.legalIn.includes(MB))!;
// Moves added in M-C are only learnable by Pokémon that are new in M-C, so a regulation that takes a
// move away from a Pokémon that stays needs a synthetic delta: here M-B no longer allows Protect.
const edited = JSON.parse(JSON.stringify(data)) as { moves: Record<string, { legalIn: string[] }> };
edited.moves.protect.legalIn = edited.moves.protect.legalIn.filter((r) => r !== MB);
const synth = new Dex(edited as unknown as Dataset);
const newMove = { move: 'protect', holder: 'incineroar' };

describe('teamImpact', () => {
  // A team built in M-C, then moved back to M-B (the same as a delta that removes a species, a Mega Stone and a move).
  const team = teamOf(fmtMC, [
    mk(newSpecies, { moves: ['', '', '', ''] }),
    mk(stoneHolder, { itemId: stone.id, moves: ['', '', '', ''] }),
    mk(newMove.holder, { moves: [newMove.move, 'fakeout', '', ''] }),
  ]);

  it('catches the species, the Mega Stone and the move that go away', () => {
    const impact = teamImpact(team, MB, synth, changes);
    const kinds = (slot: number) => impact.slots.find((s) => s.slot === slot)?.items.filter((i) => i.severity === 'breaks').map((i) => i.kind) ?? [];
    expect(kinds(0)).toContain('species');
    expect(kinds(1)).toContain('item');
    expect(kinds(2)).toContain('move');
    expect(impact.slots.find((s) => s.slot === 2)!.items.find((i) => i.kind === 'move')!.subject).toBe(newMove.move);
    expect(impact.counts.breaks).toBeGreaterThanOrEqual(3);
    expect(impact.fromRegulationId).toBe(MC);
    expect(impact.toRegulationId).toBe(MB);
  });

  it('only reports what is new: an already illegal Pokémon is not blamed on the move', () => {
    const wrong = teamOf(fmtMB, [mk(newSpecies, { moves: ['protect', '', '', ''] })]);
    expect(teamImpact(wrong, MB, dex, changes).counts.breaks).toBe(0);
    expect(teamImpact(wrong, MC, dex, changes).counts.breaks).toBe(0);
  });

  it('is empty for the regulation the team is already in', () => {
    const impact = teamImpact(team, MC, synth, changes);
    expect(impact.counts).toEqual({ breaks: 0, changes: 0, opportunity: 0 });
  });

  it('shows a patched Pokémon as a change, and a new Mega as an opportunity', () => {
    const inMC = teamOf(fmtMC, [mk('garchomp', { itemId: 'garchompitez', abilityId: 'sandveil', moves: ['protect', '', '', ''] })]);
    const back = teamImpact(inMC, MB, dex, changes);
    expect(back.slots[0].items.some((i) => i.severity === 'changes' && i.text.includes('Levitate → Sand Force'))).toBe(true);
    const inMB = teamOf(fmtMB, [{ ...createSet(dex, 'garchomp', fmtMB), moves: ['protect', '', '', ''] }]);
    const fwd = teamImpact(inMB, MC, dex, changes);
    const opp = fwd.slots[0].items.find((i) => i.severity === 'opportunity')!;
    expect(opp.kind).toBe('mega');
    expect(opp.text).toContain('Garchomp-Mega-Z');
    expect(fwd.counts.opportunity).toBeGreaterThanOrEqual(1);
  });
});

describe('copy to a regulation', () => {
  const team = teamOf(fmtMC, [
    mk(newSpecies, { moves: ['', '', '', ''] }),
    mk(stoneHolder, { itemId: stone.id, moves: ['', '', '', ''] }),
    mk(newMove.holder, { moves: [newMove.move, 'fakeout', '', ''] }),
  ]);

  it('leaves the original untouched and makes a valid variation with a checklist', () => {
    const before = JSON.stringify(team);
    const r = copyTeamToRegulation(team, MB, synth, changes)!;
    expect(JSON.stringify(team)).toBe(before);
    expect(r.team.id).not.toBe(team.id);
    expect(r.team.formatId).toBe(fmtMB.id);
    expect(r.team.groupId).toBe(team.id);
    expect(r.team.variationLabel).toBe('Reg M-B');
    expect(r.team.slots[0]).toBeNull();
    expect(r.team.slots[1]!.itemId).toBeUndefined();
    expect(r.team.slots[2]!.moves).not.toContain(newMove.move);
    expect(r.team.slots[2]!.moves).toContain('fakeout');
    expect(r.checklist.length).toBeGreaterThanOrEqual(3);
    expect(r.checklist.join(' ')).toContain("isn't legal in Reg M-B");
    // Every Pokémon, item and move that is left is legal in M-B.
    const legality = validateTeam(r.team, fmtMB, synth).filter((i) => i.severity === 'error' && ['species-illegal', 'item-illegal', 'move-illegal', 'ability-illegal'].includes(i.code));
    expect(legality).toEqual([]);
    // The copy is independent of the original.
    r.team.slots[1]!.nature = 'Bold';
    expect(team.slots[1]!.nature).not.toBe('Bold');
  });

  it('nests under the same folder when the team is itself a variation', () => {
    const variation = { ...team, groupId: 'folder', variationLabel: 'vs Rain' };
    expect(copyTeamToRegulation(variation, MB, synth, changes)!.team.groupId).toBe('folder');
  });

  it('returns nothing for a regulation that has no data', () => {
    expect(copyTeamToRegulation(team, 'champions-reg-zz', synth, changes)).toBeUndefined();
  });
});

describe('which regulations matter', () => {
  it('finds the live one and counts down to the next', () => {
    expect(relevantRegulations(new Date('2026-10-03T12:00:00Z')).live).toBe(MC);
    expect(relevantRegulations(new Date('2026-10-03T12:00:00Z')).next).toBeUndefined();
    expect(daysUntil('2026-12-02T00:00:00Z', Date.parse('2026-10-03T12:00:00Z'))).toBe(60);
    expect(daysUntil('2026-01-01T00:00:00Z', Date.parse('2026-10-03T12:00:00Z'))).toBe(0);
  });
});
