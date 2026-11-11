import { describe, expect, it } from 'vitest';
import { defaultField, defaultSide } from '@/domain/battle/conditions';
import { mergeCalcState, useCalcStore } from '../calcStore';

const current = useCalcStore.getState();

describe('calcStore merge', () => {
  it('fills fields added after the save with today’s defaults', () => {
    const { friendGuard: _a, ...cond } = defaultSide();
    const { gravity: _b, ...field } = defaultField();
    const out = mergeCalcState({ attacker: { set: null, cond: { ...cond, hpPercent: 40 }, crits: [true, false, false, false] }, field: { ...field, trickRoom: true } }, current);
    expect(out.attacker.cond.friendGuard).toBe(false);
    expect(out.attacker.cond.hpPercent).toBe(40);
    expect(out.attacker.crits).toEqual([true, false, false, false]);
    expect(out.field.gravity).toBe(false);
    expect(out.field.trickRoom).toBe(true);
    expect(out.defender.cond).toEqual(defaultSide());
  });

  it('survives corrupted data', () => {
    for (const bad of [null, 5, 'x', [], { attacker: 3, defender: { set: 'nope', cond: 'x', crits: 'x', hits: [] }, field: { weather: 7, trickRoom: 'yes' } }]) {
      const out = mergeCalcState(bad, current);
      expect(out.attacker.crits).toHaveLength(4);
      expect(out.defender.set).toBeNull();
      expect(out.defender.cond).toEqual(defaultSide());
      expect(out.field).toEqual(defaultField());
    }
  });
});
