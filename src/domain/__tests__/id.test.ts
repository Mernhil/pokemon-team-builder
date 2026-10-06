import { describe, expect, it } from 'vitest';
import { toID } from '../id';

describe('toID', () => {
  it('keeps lowercase letters and digits only', () => {
    expect(toID('Mr. Mime')).toBe('mrmime');
    expect(toID("Farfetch’d")).toBe('farfetchd');
    expect(toID('Porygon-Z')).toBe('porygonz');
    expect(toID('Type: Null')).toBe('typenull');
  });
  it('treats missing values as empty', () => {
    expect(toID(undefined)).toBe('');
    expect(toID(null)).toBe('');
    expect(toID(25)).toBe('25');
  });
  it('works as a map callback', () => {
    expect(['Close Combat', 'U-turn'].map(toID)).toEqual(['closecombat', 'uturn']);
  });
});
