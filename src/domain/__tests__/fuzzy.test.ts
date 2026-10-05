import { describe, expect, it } from 'vitest';
import { fuzzyRank, fuzzyScore } from '@/domain/fuzzy';

describe('fuzzyScore', () => {
  it('matches the start of a word best, then the middle, then letters in order', () => {
    const start = fuzzyScore('ril', 'Rillaboom')!;
    const word = fuzzyScore('boom', 'Rillaboom')!;
    const inside = fuzzyScore('laboo', 'Rillaboom')!;
    const scattered = fuzzyScore('rlbm', 'Rillaboom')!;
    expect(start).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
    expect(word).toBeGreaterThan(scattered);
    expect(fuzzyScore('Rillaboom', 'rillaboom')).toBeGreaterThan(start);
  });

  it('needs every word, in any order, and ignores case, accents and punctuation', () => {
    expect(fuzzyScore('speed analyse', 'Analyse · Speed')).not.toBeNull();
    expect(fuzzyScore('speed zzz', 'Analyse · Speed')).toBeNull();
    expect(fuzzyScore('flabebe', 'Flabébé')).not.toBeNull();
    expect(fuzzyScore('mr mime', 'Mr. Mime')).not.toBeNull();
  });

  it('does not match unrelated text, and short queries are not scattered letters', () => {
    expect(fuzzyScore('xyz', 'Rillaboom')).toBeNull();
    expect(fuzzyScore('rb', 'Rillaboom')).toBeNull();
  });

  it('matches everything on an empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('   ', 'anything')).toBe(0);
  });
});

describe('fuzzyRank', () => {
  const items = ['Calc', 'Analyse · Speed', 'Pokédex', 'Speed tiers', 'Meta'];
  it('puts the best match first and drops non-matches', () => {
    expect(fuzzyRank('speed', items, (x) => x)).toEqual(['Speed tiers', 'Analyse · Speed']);
    expect(fuzzyRank('pokedex', items, (x) => x)).toEqual(['Pokédex']);
    expect(fuzzyRank('nothing', items, (x) => x)).toEqual([]);
  });
  it('keeps the original order for equal scores and honours the limit', () => {
    expect(fuzzyRank('', items, (x) => x)).toEqual(items);
    expect(fuzzyRank('', items, (x) => x, 2)).toEqual(['Calc', 'Analyse · Speed']);
  });
});
