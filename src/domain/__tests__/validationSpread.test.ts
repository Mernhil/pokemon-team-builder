import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex, loadDex } from '@/data/dex';
import { DEFAULT_FORMAT_ID, getFormat } from '@/domain/formats';
import { createSet, createTeam } from '@/domain/team';
import type { Dataset, PokemonSet, StatTable } from '@/domain/types';
import { validateTeam } from '@/domain/validation';

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({ hp, atk, def, spa, spd, spe });

describe('spread-under', () => {
  it('does not fire for the standard 252/252/4 modern EV spread (508 of 510)', async () => {
    const dex = await loadDex('gen9');
    const format = getFormat('gen9');
    const set: PokemonSet = { ...createSet(dex, 'garchomp', format), evs: table(4, 252, 0, 0, 0, 252) };
    const team = createTeam(format);
    team.slots[0] = set;
    expect(validateTeam(team, format, dex).map((i) => i.code)).not.toContain('spread-under');
  });

  it('fires for modern EVs when another stat point is still free', async () => {
    const dex = await loadDex('gen9');
    const format = getFormat('gen9');
    const team = createTeam(format);
    team.slots[0] = { ...createSet(dex, 'garchomp', format), evs: table(0, 252, 0, 0, 0, 150) };
    expect(validateTeam(team, format, dex).map((i) => i.code)).toContain('spread-under');
  });

  it('keeps firing for a single unspent Champions SP', () => {
    const dex = new Dex(data as unknown as Dataset);
    const format = getFormat(DEFAULT_FORMAT_ID);
    const team = createTeam(format);
    team.slots[0] = { ...createSet(dex, 'garchomp', format), sp: table(2, 32, 0, 0, 0, 31) };
    expect(validateTeam(team, format, dex).map((i) => i.code)).toContain('spread-under');
    team.slots[0] = { ...team.slots[0]!, sp: table(2, 32, 0, 0, 0, 32) };
    expect(validateTeam(team, format, dex).map((i) => i.code)).not.toContain('spread-under');
  });
});
