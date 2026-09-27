import { describe, expect, it } from 'vitest';
import * as ChampionsMod from '@pkmn/mods/champions';
import { Dex as PkmnDex } from '@pkmn/dex';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { calcStats, championsStat, gbStat, modernStat, setSpreadValue, spendBudget, spForTarget } from '@/domain/stats';
import { STAT_IDS, emptyStats, type Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const champions = getFormat('champions-vgc-reg-mb');

describe('Champions stat formula', () => {
  it('matches the published Lv50 formulas', () => {
    // Garchomp: 108/130/95/80/85/102
    expect(championsStat('hp', 108, 0)).toBe(183);
    expect(championsStat('hp', 108, 32)).toBe(215);
    expect(championsStat('atk', 130, 32)).toBe(182);
    expect(championsStat('spe', 102, 32, dex.nature('Jolly'))).toBe(169); // floor(154*1.1)
    expect(championsStat('spa', 80, 0, dex.nature('Jolly'))).toBe(90); // floor(100*0.9)
  });

  it('equals the main-series formula at Lv50 / 31 IVs with EV = 8·SP - 4 (1 SP = 1 point)', () => {
    for (const base of [5, 45, 80, 101, 150, 255])
      for (const sp of [1, 7, 20, 32])
        for (const stat of ['hp', 'atk'] as const)
          expect(championsStat(stat, base, sp)).toBe(modernStat(stat, base, 31, sp * 8 - 4, 50));
  });

  it("agrees with Pokémon Showdown's Champions statModify for every legal species", () => {
    const sdDex = PkmnDex.mod('champions' as never, ChampionsMod as never);
    const ctx = {
      trunc: (n: number, bits = 0) => (bits ? (n >>> 0) % 2 ** bits : n >>> 0),
      ruleTable: { has: () => false },
      dex: sdDex,
    };
    const statModify = (ChampionsMod as unknown as { Scripts: { statModify: Function } }).Scripts.statModify;
    const sp = { hp: 2, atk: 32, def: 0, spa: 5, spd: 1, spe: 26 };
    for (const nature of ['Adamant', 'Timid', 'Hardy', 'Brave']) {
      for (const s of dex.allSpecies()) {
        const ours = calcStats(s.baseStats, { sp, evs: emptyStats(), ivs: emptyStats(31), level: 50 }, champions, dex.nature(nature));
        for (const k of STAT_IDS) {
          const theirs = statModify.call(ctx, s.baseStats, { evs: sp, nature, level: 50 }, k);
          expect(ours[k], `${s.name} ${k} ${nature}`).toBe(theirs);
        }
      }
    }
  });
});

describe('Legacy formulas', () => {
  it('Gen 3–9: Lv100 Garchomp 252 Spe Jolly = 333', () => {
    expect(modernStat('spe', 102, 31, 252, 100, dex.nature('Jolly'))).toBe(333);
    expect(modernStat('hp', 108, 31, 4, 100)).toBe(358);
  });
  it('Shedinja HP is always 1', () => {
    expect(modernStat('hp', 1, 31, 252, 100)).toBe(1);
    expect(championsStat('hp', 1, 32)).toBe(1);
  });
  it('Gen 1–2: Lv100 Mewtwo max DV/StatExp Special = 406', () => {
    expect(gbStat('spa', 154, 15, 65535, 100)).toBe(406);
  });
});

describe('SP budget', () => {
  it('clamps to per-stat and total caps', () => {
    let s = emptyStats();
    s = setSpreadValue(s, 'atk', 40, 66, 32);
    expect(s.atk).toBe(32);
    s = setSpreadValue(s, 'spe', 32, 66, 32);
    s = setSpreadValue(s, 'hp', 32, 66, 32);
    expect(s.hp).toBe(2); // only 2 SP left
    expect(spendBudget(champions.statSystem, s)).toMatchObject({ used: 66, remaining: 0, status: 'complete' });
  });
  it('finds minimum SP for a speed benchmark', () => {
    // Jolly base 102 → outspeed a 168 target needs 31 SP (floor((102+31+20)*1.1)=168)
    expect(spForTarget('spe', 102, 168, 32, dex.nature('Jolly'))).toBe(31);
    expect(spForTarget('spe', 30, 200, 32)).toBeNull();
  });
});
