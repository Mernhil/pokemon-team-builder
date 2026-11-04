import { describe, expect, it } from 'vitest';
import { itemStatBoost } from '../itemStats';

const stats = { hp: 144, atk: 112, def: 95, spa: 72, spd: 95, spe: 137 };

describe('itemStatBoost', () => {
  it('raises the stat a Choice or Assault item boosts by half', () => {
    expect(itemStatBoost('choicescarf', stats)).toMatchObject({ stat: 'spe', value: 205 });
    expect(itemStatBoost('choiceband', stats)).toMatchObject({ stat: 'atk', value: 168 });
    expect(itemStatBoost('assaultvest', stats)).toMatchObject({ stat: 'spd', value: 142 });
  });
  it('ignores items that change no stat', () => {
    expect(itemStatBoost('leftovers', stats)).toBeUndefined();
    expect(itemStatBoost(undefined, stats)).toBeUndefined();
  });
});
