import { describe, expect, it } from 'vitest';
import { DEFAULT_NAV, NAV_IDS, moreGroups, resizeBar, resolveBar, sanitizeNav, setSlot } from '../navigation';

describe('main bar', () => {
  it('defaults: four on a phone, Pokénav as the fifth on desktop', () => {
    expect(resolveBar('phone', undefined, false)).toEqual(['builder', 'calc', 'analyse', 'dex']);
    expect(resolveBar('desktop', undefined, false)).toEqual(['builder', 'calc', 'analyse', 'dex', 'atlas']);
  });

  it('Champions swaps Pokénav for Reverse search, never listing it twice, and hides Pokénav in More', () => {
    expect(resolveBar('desktop', undefined, true)).toEqual(['builder', 'calc', 'analyse', 'dex', 'reverse']);
    // a bar the player chose is shown as chosen, Pokénav included
    expect(resolveBar('desktop', { desktop: ['atlas', 'reverse', 'calc'] }, true)).toEqual(['atlas', 'reverse', 'calc']);
    const phone = moreGroups(resolveBar('phone', undefined, true), true);
    expect(phone.tools).toEqual(['reverse', 'regdiff']);
    expect(phone.main).toEqual(['matches', 'gameday', 'meta']);
    expect(moreGroups(resolveBar('phone', undefined, false), false).tools).toEqual(['reverse', 'regdiff', 'atlas']);
  });

  it('More lists whatever the bar leaves out, so nothing becomes unreachable', () => {
    const bar = resolveBar('phone', { phone: ['meta', 'matches', 'builder', 'reverse'] }, false);
    const g = moreGroups(bar, false);
    expect([...bar, ...g.main, ...g.tools].sort()).toEqual([...NAV_IDS].sort());
  });

  it('sanitises a saved choice', () => {
    expect(sanitizeNav(null)).toEqual({});
    expect(sanitizeNav({ phone: ['calc', 'calc', 'nope', 7, 'meta', 'dex', 'atlas', 'reverse'], desktop: ['calc'] })).toEqual({ phone: ['calc', 'meta', 'dex', 'atlas'] });
    expect(sanitizeNav({ phone: 'x' })).toEqual({});
  });

  it('changes a slot by swapping when the choice is already in the bar', () => {
    expect(setSlot(['builder', 'calc', 'analyse', 'dex'], 3, 'meta')).toEqual(['builder', 'calc', 'analyse', 'meta']);
    expect(setSlot(['builder', 'calc', 'analyse', 'dex'], 0, 'dex')).toEqual(['dex', 'calc', 'analyse', 'builder']);
  });

  it('adds and removes slots within the limits', () => {
    expect(resizeBar(DEFAULT_NAV.phone, 'phone', 1)).toEqual(DEFAULT_NAV.phone); // four is the most on a phone
    expect(resizeBar(DEFAULT_NAV.phone, 'phone', -1)).toHaveLength(3);
    expect(resizeBar(['builder', 'calc'], 'phone', -1)).toEqual(['builder', 'calc']);
    expect(resizeBar(DEFAULT_NAV.desktop, 'desktop', 1)).toHaveLength(6);
  });
});
