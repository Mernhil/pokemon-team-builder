import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { parseMetaFile } from '@/domain/meta';
import { everyThreat, topThreats } from '@/domain/reportThreats';
import { createSet } from '@/domain/team';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const snapshot = Object.values(parseMetaFile(metaJson).regulations)[0];

describe('report threats', () => {
  it('top N is the most-used sets; a player build replaces one of them, with its own form', () => {
    const plain = topThreats(dex, fmt, snapshot, 10);
    expect(plain).toHaveLength(10);
    const id = plain[0].speciesId;
    const own = { ...createSet(dex, id, fmt), nature: 'Bold' as const };
    const custom = topThreats(dex, fmt, snapshot, 10, { [id]: own });
    expect(custom[0].custom).toBe(true);
    expect(custom[0].set.nature).toBe('Bold');
    expect(custom.slice(1).every((t) => !t.custom)).toBe(true);
  });

  it('every Pokémon: meta-backed first by usage, the rest after, "with <Stone>" rows last, keys unique', () => {
    const all = everyThreat(dex, fmt, snapshot);
    expect(all.length).toBeGreaterThan(topThreats(dex, fmt, snapshot, 30).length);
    expect(new Set(all.map((t) => t.key)).size).toBe(all.length);
    const firstStone = all.findIndex((t) => t.withStone);
    expect(firstStone).toBeGreaterThan(0);
    expect(all.slice(firstStone).every((t) => t.withStone && t.megaMode === 'mega')).toBe(true);
    expect(all.slice(firstStone).every((t) => t.usagePct === undefined && t.usageRank === undefined)).toBe(true);
    // The top of the list is the top-N list, in the same order.
    expect(all.slice(0, 10).map((t) => t.speciesId)).toEqual(topThreats(dex, fmt, snapshot, 10).map((t) => t.speciesId));
  });

  it('a player build reaches every row of its species, stone rows included', () => {
    const id = everyThreat(dex, fmt, snapshot).find((t) => t.withStone)!.speciesId;
    const own = { ...createSet(dex, id, fmt), nature: 'Calm' as const };
    const rows = everyThreat(dex, fmt, snapshot, { [id]: own }).filter((t) => t.speciesId === id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((t) => t.set.nature === 'Calm')).toBe(true);
  });
});
