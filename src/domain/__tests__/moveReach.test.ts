import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import metaJson from '@/data/generated/meta.json';
import { Dex } from '@/data/dex';
import { defaultField } from '@/domain/battle/conditions';
import { getFormat } from '@/domain/formats';
import { parseMetaFile } from '@/domain/meta';
import { metaSets } from '@/domain/metaSets';
import { moveReach } from '@/domain/moveReach';
import { defaultSet, evaluateCandidate, targetFor } from '@/domain/reverseSearch';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const snap = parseMetaFile(metaJson).regulations['champions-reg-mc']!;
const field = defaultField();
const targets = metaSets(snap, dex, fmt, 60);

describe('move reach', () => {
  const mine = defaultSet(dex, 'typhlosion', fmt);
  const fire = mine.moves.find((m) => dex.move(m)?.type === 'Fire')!;

  it('sorts the Pokémon a move reaches into one-shots, high-roll one-shots and two-shots', () => {
    const r = moveReach(dex, fmt, mine, fire, targets, field);
    expect(r.checked).toBe(targets.length);
    expect(r.ohko.length + r.possible.length + r.twoHit.length).toBeGreaterThan(0);
    for (const row of r.ohko) expect(row.percent[0]).toBeGreaterThanOrEqual(100);
    for (const row of r.possible) expect(row.percent[1]).toBeGreaterThanOrEqual(100);
    for (const row of r.twoHit) expect(row.percent[1]).toBeLessThan(100);
    const all = [...r.ohko, ...r.possible, ...r.twoHit].map((x) => x.speciesId);
    expect(new Set(all).size).toBe(all.length); // a Pokémon is in one group only
  });

  it('agrees with Reverse search: Fire one-shots the Mega Golisopod the meta set describes', () => {
    const golisopod = targets.find((t) => t.speciesId === 'golisopod')!;
    expect(golisopod).toBeDefined();
    const r = moveReach(dex, fmt, mine, fire, [golisopod], field);
    const rs = evaluateCandidate(dex, { speciesId: 'typhlosion', set: mine, megaMode: 'base', build: 'default' }, [{ id: 'a', kind: 'ohko', target: targetFor(dex, fmt, 'golisopod', snap) }], field);
    expect(r.ohko.map((x) => x.speciesId)).toEqual(rs ? ['golisopod'] : []);
    expect(rs).toBeDefined();
  });

  it('uses only the chosen move, and the build it is given', () => {
    const only = moveReach(dex, fmt, { ...mine, moves: [fire, '', '', ''] }, fire, targets, field);
    const withOthers = moveReach(dex, fmt, mine, fire, targets, field);
    expect(only).toEqual(withOthers);
    const weaker = moveReach(dex, fmt, { ...mine, nature: 'Brave', sp: { ...mine.sp, spa: 0, atk: 0 } }, fire, targets, field);
    expect(weaker.ohko.length).toBeLessThan(withOthers.ohko.length);
  });

  it('has nothing for a status move or an unknown one', () => {
    const status = dex.move('protect') ? 'protect' : 'swordsdance';
    expect(moveReach(dex, fmt, mine, status, targets, field)).toEqual({ ohko: [], possible: [], twoHit: [], checked: 0 });
    expect(moveReach(dex, fmt, mine, 'nonsense', targets, field).checked).toBe(0);
  });

  it('a Mega Stone holder attacks as the Mega', () => {
    const chomp = { ...defaultSet(dex, 'garchomp', fmt), itemId: 'garchompite' };
    const eq = chomp.moves.find((m) => m === 'earthquake') ?? chomp.moves[0];
    const asMega = moveReach(dex, fmt, chomp, eq, targets, field);
    const noStone = moveReach(dex, fmt, { ...chomp, itemId: undefined }, eq, targets, field);
    expect(asMega.ohko.length + asMega.possible.length).toBeGreaterThanOrEqual(noStone.ohko.length + noStone.possible.length);
  });
});
