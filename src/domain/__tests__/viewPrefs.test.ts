import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, sanitizeView } from '../viewPrefs';

describe('sanitizeView', () => {
  it('gives the defaults for nothing, junk or the wrong types', () => {
    expect(sanitizeView(undefined)).toEqual(DEFAULT_VIEW);
    expect(sanitizeView('x')).toEqual(DEFAULT_VIEW);
    expect(sanitizeView({ threatCount: 7, metaTab: 'nope', metaPeriod: 99, threatField: { weather: 'Fog', terrain: 3, trickRoom: 'yes' } })).toEqual(DEFAULT_VIEW);
  });
  it('keeps Tailwind choices and drops junk', () => {
    expect(sanitizeView({ threatField: { myTailwind: true, theirTailwind: 'yes' } }).threatField).toMatchObject({ myTailwind: true });
    expect(sanitizeView({ threatField: { theirTailwind: 'yes' } }).threatField).not.toHaveProperty('theirTailwind');
  });
  it('keeps valid choices', () => {
    const v = { threatCount: 30, metaTab: 'trends', metaPeriod: 'season', threatField: { gameType: 'Singles', weather: 'Rain', terrain: 'Grassy', trickRoom: true, gravity: true } };
    expect(sanitizeView(v)).toEqual(v);
    expect(sanitizeView({ metaPeriod: 30 }).metaPeriod).toBe(30);
  });
});
