import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { decodeShareString, encodeShareString, exportBackup, parseBackup } from '@/domain/codecs';
import { sanitizeTeam } from '@/domain/sanitize';
import { createSet, createTeam } from '@/domain/team';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const backup = (teams: unknown[]) => JSON.stringify({ app: 'pokemon-team-builder', version: 1, teams });
const shareCode = (payload: unknown) => 'PTB1.' + btoa(JSON.stringify(payload)).replace(/=+$/, '');

describe('import sanitising', () => {
  it('round-trips a valid backup unchanged', () => {
    const t = createTeam(fmt, 'Mine');
    t.slots[0] = { ...createSet(dex, 'garchomp', fmt), moves: ['earthquake', '', '', ''], shiny: true, gender: 'F' };
    expect(parseBackup(exportBackup([t]))).toEqual([t]);
  });

  it('coerces malformed teams into a renderable shape', () => {
    const [t] = parseBackup(
      backup([{ id: '__proto__', name: { x: 1 }, slots: [{}, { speciesId: 'pikachu', moves: 'abc', sp: { hp: 1e9, atk: -5, spe: 'x' }, level: NaN }] }]),
    );
    expect(t.id).not.toBe('__proto__');
    expect(t.name).toBe('Imported Team');
    expect(t.slots).toHaveLength(6);
    expect(t.slots[0]).toBeNull();
    const s = t.slots[1]!;
    expect(s.moves).toEqual(['', '', '', '']);
    expect(s.sp).toEqual({ hp: 255, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(s.level).toBe(100);
  });

  it('drops entries that are not teams', () => {
    expect(parseBackup(backup([null, 1, 'x', { slots: 'no' }]))).toEqual([]);
    expect(() => parseBackup('null')).toThrow('Not a Team Builder backup');
  });

  it('rejects malformed share codes and sanitises odd fields', () => {
    expect(() => decodeShareString(shareCode(null), dex, fmt)).toThrow('Not a valid share code');
    expect(() => decodeShareString(shareCode({ n: 'x', s: 5 }), dex, fmt)).toThrow('Not a valid share code');
    const t = decodeShareString(shareCode({ n: { a: 1 }, f: 7, s: [['garchomp', 1, 2, 3, 4, 'moves', 'x', null, null, 'lvl'], 'junk'] }), dex, fmt);
    expect(typeof t.name).toBe('string');
    expect(t.slots[0]!.speciesId).toBe('garchomp');
    expect(t.slots[0]!.level).toBe(100);
    expect(t.slots[1]).toBeNull();
  });

  it('keeps share codes lossless', () => {
    const t = createTeam(fmt, 'Share');
    t.slots[2] = { ...createSet(dex, 'garchomp', fmt), moves: ['earthquake', 'protect', '', ''] };
    const back = decodeShareString(encodeShareString(t), dex, fmt);
    expect(back.slots[2]).toEqual({ ...t.slots[2], uid: back.slots[2]!.uid });
  });

  it('returns null for non-objects', () => {
    expect(sanitizeTeam(undefined)).toBeNull();
    expect(sanitizeTeam([])).toBeNull();
  });
});
