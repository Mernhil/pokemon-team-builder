import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AllowlistSchema, applyAllowlist, diffLearnset, diffMegaStone, diffSets, diffSpecies, legalityDiffs, type Difference } from '@/domain/dataAudit';

describe('diffSets / legalityDiffs', () => {
  it('lists what is on one side only, sorted, and ignores duplicates', () => {
    expect(diffSets(['b', 'a', 'a', 'c'], ['c', 'd'])).toEqual({ onlyOurs: ['a', 'b'], onlyTheirs: ['d'] });
    expect(diffSets([], [])).toEqual({ onlyOurs: [], onlyTheirs: [] });
  });

  it('names each difference stably, with the regulation', () => {
    const d = legalityDiffs('species', 'champions-reg-mc', ['rillaboom', 'x'], ['rillaboom', 'garchompmegaz']);
    expect(d.map((x) => x.id)).toEqual(['species-only-ours:champions-reg-mc:x', 'species-only-upstream:champions-reg-mc:garchompmegaz']);
    expect(legalityDiffs('items', 'r', ['a'], ['a'])).toEqual([]);
    expect(legalityDiffs('moves', 'r', [], ['pound'])[0].id).toBe('move-only-upstream:r:pound');
  });
});

describe('diffSpecies', () => {
  const base = { types: ['Fire', 'Flying'], abilities: { '0': 'Blaze', H: 'Solar Power' }, baseStats: { hp: 78, atk: 84 } };
  it('is silent when identical, and ignores ability spelling', () => {
    expect(diffSpecies('charizard', base, structuredClone(base))).toEqual([]);
    expect(diffSpecies('charizard', base, { ...base, abilities: { '0': 'blaze', H: 'SolarPower' } })).toEqual([]);
  });

  it('reports a changed type, a missing ability slot and a base stat', () => {
    const theirs = { types: ['Fire', 'Dragon'], abilities: { '0': 'Blaze', '1': 'Tough Claws', H: 'Solar Power' }, baseStats: { hp: 78, atk: 90 } };
    expect(diffSpecies('charizard', base, theirs).map((d) => d.id)).toEqual(['types:charizard', 'abilities:charizard:1', 'stats:charizard:atk']);
  });
});

describe('diffLearnset / diffMegaStone', () => {
  it('splits missing and extra moves', () => {
    expect(diffLearnset('rillaboom', ['grassyglide', 'x'], ['grassyglide', 'fakeout']).map((d) => d.id)).toEqual(['learnset-missing:rillaboom:fakeout', 'learnset-extra:rillaboom:x']);
  });
  it('compares the Mega each base species gets', () => {
    expect(diffMegaStone('charizarditex', { charizard: 'charizardmegax' }, { charizard: 'charizardmegax' })).toEqual([]);
    expect(diffMegaStone('garchompitez', undefined, { garchomp: 'garchompmegaz' }).map((d) => d.id)).toEqual(['megastone:garchompitez:garchomp']);
  });
});

describe('applyAllowlist', () => {
  const d = (id: string): Difference => ({ id, area: 'learnsets', detail: id });
  const diffs = [d('learnset-extra:foo:a'), d('learnset-extra:foo:b'), d('types:bar'), d('stats:baz:atk')];

  it('explains exact ids and trailing-* families, and leaves the rest', () => {
    const r = applyAllowlist(diffs, { entries: [{ id: 'learnset-extra:foo:*', reason: 'known upstream lag' }, { id: 'types:bar', reason: 'speciesPatch in a regulation file' }] });
    expect(r.explained.map((e) => e.id)).toEqual(['learnset-extra:foo:a', 'learnset-extra:foo:b', 'types:bar']);
    expect(r.unexplained.map((e) => e.id)).toEqual(['stats:baz:atk']);
    expect(r.explained[2].reason).toContain('speciesPatch');
    expect(r.stale).toEqual([]);
  });

  it('reports allowlist entries that match nothing any more', () => {
    expect(applyAllowlist(diffs, { entries: [{ id: 'types:gone', reason: 'was needed once upon a time' }] }).stale).toEqual(['types:gone']);
  });
});

describe('scripts/audit-allowlist.json', () => {
  it('has the right shape: a lowercase id and a real reason for every entry, no duplicates', () => {
    const list = AllowlistSchema.parse(JSON.parse(readFileSync(new URL('../../../scripts/audit-allowlist.json', import.meta.url), 'utf8')));
    const ids = list.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('refuses an entry without a reason or with a vague id', () => {
    expect(AllowlistSchema.safeParse({ entries: [{ id: 'types:x', reason: '' }] }).success).toBe(false);
    expect(AllowlistSchema.safeParse({ entries: [{ id: 'Types X', reason: 'long enough reason' }] }).success).toBe(false);
  });
});
