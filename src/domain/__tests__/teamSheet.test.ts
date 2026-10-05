import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { importShowdown } from '@/domain/codecs';
import { getFormat } from '@/domain/formats';
import { speedOrder, teamSheetText } from '@/domain/teamSheet';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');

const PASTE = `Garchomp @ Garchompite
Ability: Rough Skin
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake
- Dragon Claw

Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 32 Atk
Adamant Nature
- Flare Blitz
- Fake Out`;

function team() {
  const t = importShowdown(PASTE, dex, fmt, 'Sheet test').team;
  t.slots[0]!.notes = 'Always Protect turn one.';
  t.notes = 'Bring to the local.';
  t.replicaCode = 'ABCDE12345';
  t.matchupNotes = [{ id: 'm1', title: 'vs Rain', leads: [t.slots[1]!.uid, 'gone'], text: 'Fake Out the sweeper.' }];
  return t;
}

describe('team sheet', () => {
  it('lists speeds fastest first, a Mega as its own row', () => {
    const rows = speedOrder(team(), dex, fmt);
    expect(rows.map((r) => r.speed)).toEqual([...rows.map((r) => r.speed)].sort((a, b) => b - a));
    expect(rows.some((r) => r.mega)).toBe(true);
  });

  it('carries notes, matchup notes, speed order, the replica code and the Showdown export', () => {
    const text = teamSheetText(team(), dex, fmt);
    expect(text).toContain('Sheet test');
    expect(text).toContain('ABCDE 12345');
    expect(text).toContain('Bring to the local.');
    expect(text).toContain('Garchomp: Always Protect turn one.');
    expect(text).toContain('Speed order');
    // A lead that left the team is dropped, the one still on it is named.
    expect(text).toContain('vs Rain (lead Incineroar): Fake Out the sweeper.');
    expect(text).toContain('Showdown export');
    expect(text).toContain('Garchomp @ Garchompite');
  });

  it('leaves out sections that are empty', () => {
    const t = team();
    t.notes = undefined;
    t.matchupNotes = undefined;
    t.slots[0]!.notes = undefined;
    const text = teamSheetText(t, dex, fmt);
    expect(text).not.toContain('Team notes');
    expect(text).not.toContain('Matchup notes');
    expect(text).not.toContain('Pokémon notes');
  });
});
