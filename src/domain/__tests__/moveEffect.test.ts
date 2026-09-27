import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { formatMoveEffect } from '@/domain/moveEffect';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const effect = (id: string) => formatMoveEffect(dex.move(id)!);

describe('formatMoveEffect', () => {
  it('Flamethrower: 10% chance to burn', () => {
    expect(effect('flamethrower')).toBe('10% chance to burn the target.');
  });

  it('Scald: 30% chance to burn', () => {
    expect(effect('scald')).toBe('30% chance to burn the target.');
  });

  it('Fake Out: guaranteed flinch (priority is a separate tooltip field, not effect text)', () => {
    expect(dex.move('fakeout')!.priority).toBe(3);
    expect(effect('fakeout')).toBe('Makes the target flinch.');
  });

  it('Extreme Speed: no secondary effect to generate, falls back to shortDesc', () => {
    expect(dex.move('extremespeed')!.priority).toBe(2);
    expect(effect('extremespeed')).toBe(dex.move('extremespeed')!.shortDesc);
  });

  it('Trick Room: priority -7, field effect falls back to shortDesc', () => {
    expect(dex.move('trickroom')!.priority).toBe(-7);
    expect(effect('trickroom')).toBe(dex.move('trickroom')!.shortDesc);
  });

  it("Draco Meteor: lowers the user's Sp. Atk by 2", () => {
    expect(effect('dracometeor')).toBe("Lowers the user's Sp. Atk by 2.");
  });

  it('Fire Fang: 10% chance to burn + 10% chance to flinch', () => {
    expect(effect('firefang')).toBe('10% chance to burn the target. 10% chance to make the target flinch.');
  });

  it('Iron Head: Champions numbers (20% flinch here, not the standard 30%)', () => {
    expect(dex.move('ironhead')!.secondaries?.[0].chance).toBe(20);
    expect(effect('ironhead')).toBe('20% chance to make the target flinch.');
  });

  it('Protect: no structured effect, falls back to shortDesc', () => {
    expect(effect('protect')).toBe(dex.move('protect')!.shortDesc);
  });

  it('Shift Gear (new in Reg M-C): raises two stats on the user', () => {
    expect(dex.move('shiftgear')!.legalIn).toEqual(['champions-reg-mc']);
    expect(effect('shiftgear')).toBe("Raises the user's Speed by 2 and Attack by 1.");
  });
});
