import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import {
  MAX_BACKUP_TEAMS,
  decodeShareString,
  encodeShareString,
  exportBackup,
  exportTeamShowdown,
  importShowdown,
  normalizeReplicaCode,
  parseBackup,
} from '@/domain/codecs';
import { validateTeam } from '@/domain/validation';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');

const PASTE = `Chompy (Garchomp) (F) @ Garchompite
Ability: Rough Skin
Tera Type: Steel
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Protect
- Rock Slide

Incineroar @ Sitrus Berry
Ability: Intimidate
EVs: 32 HP / 20 Def / 14 SpD
Careful Nature
- Fake Out
- Flare Blitz
- Parting Shot
- Knock Off`;

describe('Showdown codec', () => {
  it('imports and round-trips', () => {
    const { team, warnings } = importShowdown(PASTE, dex, fmt);
    // Champions has no Terastallization: the paste's Tera Type line is ignored, with a note.
    expect(warnings).toEqual(['Tera Types were ignored: Reg M-C has no Terastallization.']);
    const g = team.slots[0]!;
    expect(g.teraType).toBeUndefined();
    expect(g.speciesId).toBe('garchomp');
    expect(g.nickname).toBe('Chompy');
    expect(g.sp).toEqual({ hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 });
    expect(g.itemId).toBe('garchompite');
    const again = importShowdown(exportTeamShowdown(team, dex, fmt), dex, fmt).team;
    expect(again.slots.map((s) => s && { ...s, uid: '' })).toEqual(team.slots.map((s) => s && { ...s, uid: '' }));
  });

  it('maps a Mega header back to its base species', () => {
    const { team } = importShowdown('Garchomp-Mega @ Garchompite\nAbility: Rough Skin\n- Protect', dex, fmt);
    expect(team.slots[0]!.speciesId).toBe('garchomp');
  });
});

describe('Share string & replica code', () => {
  it('round-trips a team', () => {
    const { team } = importShowdown(PASTE, dex, fmt);
    const back = decodeShareString(encodeShareString(team), dex, fmt);
    expect(back.slots[1]!.sp).toEqual(team.slots[1]!.sp);
    expect(back.slots[0]!.moves).toEqual(team.slots[0]!.moves);
  });
  it('restores a backup but refuses an oversized one', () => {
    const { team } = importShowdown(PASTE, dex, fmt);
    expect(parseBackup(exportBackup([team]))[0].slots[0]!.speciesId).toBe(team.slots[0]!.speciesId);
    const huge = JSON.stringify({ app: 'pokemon-team-builder', version: 1, teams: Array(MAX_BACKUP_TEAMS + 1).fill(team) });
    expect(() => parseBackup(huge)).toThrow(/at most/);
  });
  it('normalises replica codes', () => {
    expect(normalizeReplicaCode('ab12c-d34ef')).toBe('AB12CD34EF');
    expect(normalizeReplicaCode('short')).toBeNull();
  });
});

describe('Validation', () => {
  it('flags item clause, species clause, SP cap and illegal moves', () => {
    const { team } = importShowdown(PASTE + '\n\n' + PASTE.split('\n\n')[0].replace('Chompy (Garchomp) (F)', 'Garchomp'), dex, fmt);
    team.slots[1]!.sp.hp = 32; // 32+20+14 = 66 ok
    team.slots[1]!.sp.spe = 10; // → 76 over
    team.slots[1]!.moves[3] = 'surf';
    const codes = validateTeam(team, fmt, dex).map((i) => i.code);
    expect(codes).toContain('species-clause');
    expect(codes).toContain('item-clause');
    expect(codes).toContain('spread-over');
    expect(codes).toContain('move-illegal');
  });
});

describe('share codes carry notes, benchmarks and matchup notes (PTB1)', () => {
  const bench = { id: 'k1', kind: 'survive' as const, savedAt: 5, metAtSave: true, foe: { speciesId: 'kingambit', source: 'meta' as const }, moveId: 'suckerpunch', rolls: 16 };
  const team = () => {
    const { team: t } = importShowdown(PASTE, dex, fmt);
    t.slots[0] = { ...t.slots[0]!, uid: 'u-a', notes: 'Max Speed to outrun Scarf Flutter Mane', benchmarks: [bench] };
    t.notes = 'Lead Garchomp + Incineroar';
    t.matchupNotes = [{ id: 'm1', title: 'vs Rain', leads: ['u-a'], text: 'Keep Kingambit back.' }];
    return t;
  };

  it('round-trips them, with a matchup note\'s leads following the Pokémon to its new id', () => {
    const t = team();
    const back = decodeShareString(encodeShareString(t), dex, fmt);
    expect(back.slots[0]).toMatchObject({ notes: 'Max Speed to outrun Scarf Flutter Mane', benchmarks: [bench] });
    expect(back.notes).toBe('Lead Garchomp + Incineroar');
    expect(back.matchupNotes).toHaveLength(1);
    expect(back.matchupNotes![0]).toMatchObject({ title: 'vs Rain', text: 'Keep Kingambit back.' });
    expect(back.matchupNotes![0].leads).toEqual([back.slots[0]!.uid]);
  });

  it('a code without them (an older version\'s) still decodes', () => {
    const { team: plain } = importShowdown(PASTE, dex, fmt);
    const back = decodeShareString(encodeShareString(plain), dex, fmt);
    expect(back.slots[0]!.notes).toBeUndefined();
    expect(back.slots[0]!.benchmarks).toBeUndefined();
    expect(back.matchupNotes).toBeUndefined();
  });

  it('a damaged benchmark in a code is dropped, not trusted', () => {
    const t = team();
    t.slots[0]!.benchmarks = [{ ...bench, rolls: 99, moveId: 'NOT AN ID' } as never, bench];
    const back = decodeShareString(encodeShareString(t), dex, fmt);
    expect(back.slots[0]!.benchmarks).toEqual([bench]);
  });

  it('the Showdown export ignores all of it', () => {
    const text = exportTeamShowdown(team(), dex, fmt);
    expect(text).not.toMatch(/Flutter|benchmark|Keep Kingambit|Lead Garchomp/i);
  });
});
