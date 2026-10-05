import { describe, expect, it } from 'vitest';
import { ANALYSE_TABS, VIEWS, parseRoute, routeFromSaved, routeHash } from '@/domain/routes';

describe('parseRoute', () => {
  it('reads every plain view, with or without the #', () => {
    for (const v of VIEWS.filter((x) => x !== 'analyse')) {
      expect(parseRoute(`#${v}`)).toEqual({ view: v });
      expect(parseRoute(v)).toEqual({ view: v });
    }
  });

  it('reads Analyse and its tabs', () => {
    expect(parseRoute('#analyse')).toEqual({ view: 'analyse', tab: 'overview' });
    for (const t of ANALYSE_TABS.filter((x) => x !== 'ohko')) expect(parseRoute(`#analyse/${t}`)).toEqual({ view: 'analyse', tab: t });
    expect(parseRoute('#analyse/ohko')).toEqual({ view: 'analyse', tab: 'ohko', ohko: 'by' });
    expect(parseRoute('#analyse/ohko/to')).toEqual({ view: 'analyse', tab: 'ohko', ohko: 'to' });
  });

  it('redirects every old hash to its Analyse tab', () => {
    expect(parseRoute('#speed')).toEqual({ view: 'analyse', tab: 'speed' });
    expect(parseRoute('#threats')).toEqual({ view: 'analyse', tab: 'threats' });
    expect(parseRoute('#showcase')).toEqual({ view: 'analyse', tab: 'overview' });
    expect(parseRoute('#compare')).toEqual({ view: 'analyse', tab: 'compare' });
    expect(parseRoute('#ohkod')).toEqual({ view: 'analyse', tab: 'ohko', ohko: 'by' });
    expect(parseRoute('#ohko')).toEqual({ view: 'analyse', tab: 'ohko', ohko: 'to' });
  });

  it('returns a fresh object for a legacy hash, so callers can not change the table', () => {
    const a = parseRoute('#speed')!;
    a.tab = 'compare';
    expect(parseRoute('#speed')).toEqual({ view: 'analyse', tab: 'speed' });
  });

  it('refuses what it does not know', () => {
    for (const bad of ['', '#', '#nope', '#analyse/nope', '#analyse/speed/x', '#analyse/ohko/sideways', '#analyse/ohko/to/x', '#calc/speed', '#speed/x', '#__proto__', '#constructor']) {
      expect(parseRoute(bad), bad).toBeNull();
    }
  });
});

describe('routeHash', () => {
  it('writes the new hashes, and reads back what it wrote', () => {
    expect(routeHash({ view: 'calc' })).toBe('#calc');
    expect(routeHash({ view: 'analyse' })).toBe('#analyse/overview');
    expect(routeHash({ view: 'analyse', tab: 'speed' })).toBe('#analyse/speed');
    expect(routeHash({ view: 'analyse', tab: 'ohko', ohko: 'to' })).toBe('#analyse/ohko/to');
    expect(routeHash({ view: 'analyse', tab: 'ohko' })).toBe('#analyse/ohko/by');
    for (const r of [{ view: 'meta' }, { view: 'analyse', tab: 'compare' }, { view: 'analyse', tab: 'ohko', ohko: 'by' }] as const) {
      expect(parseRoute(routeHash(r))).toEqual(r);
    }
  });
});

describe('routeFromSaved', () => {
  it('maps a view id an older version saved, falling back to the builder', () => {
    expect(routeFromSaved('speed')).toEqual({ view: 'analyse', tab: 'speed' });
    expect(routeFromSaved('ohkod')).toEqual({ view: 'analyse', tab: 'ohko', ohko: 'by' });
    expect(routeFromSaved('dex')).toEqual({ view: 'dex' });
    expect(routeFromSaved('garbage')).toEqual({ view: 'builder' });
    expect(routeFromSaved(42)).toEqual({ view: 'builder' });
    expect(routeFromSaved(undefined)).toEqual({ view: 'builder' });
  });
});
