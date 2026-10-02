import { describe, expect, it } from 'vitest';
import { loadDex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { PICKER_ORDER, matchRank, moveGroupOf, orderItems, orderMoves, orderSpecies, pushRecent, rankSearch } from '@/domain/pickerOrder';
import { TYPE_NAMES } from '@/domain/types';

const none = { favorites: [], recent: [] };
const ids = (g: { entries: { id: string }[] }) => g.entries.map((e) => e.id);

describe('search ranking', () => {
  it('ranks exact > prefix > word start > substring > keyword', () => {
    expect(matchRank('leftovers', 'Leftovers')).toBe(0);
    expect(matchRank('choice', 'Choice Band')).toBe(1);
    expect(matchRank('band', 'Choice Band')).toBe(2);
    expect(matchRank('oice', 'Choice Band')).toBe(3);
    expect(matchRank('boost', 'Life Orb', 'Boosts damage')).toBe(4);
    expect(matchRank('zzz', 'Life Orb')).toBe(-1);
    expect(matchRank('mr mime', 'Mr. Mime')).toBe(0);
  });

  it('keeps the curated order among equally relevant results', () => {
    const list = ['Choice Specs', 'Choice Band', 'Band Aid', 'Choice Scarf'];
    expect(rankSearch(list, 'choice', (s) => s)).toEqual(['Choice Specs', 'Choice Band', 'Choice Scarf']);
    expect(rankSearch(list, 'band', (s) => s)).toEqual(['Band Aid', 'Choice Band']);
  });

  it('caps recents and moves a repeat to the front', () => {
    let r: string[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'b']) r = pushRecent(r, id);
    expect(r).toHaveLength(PICKER_ORDER.recentsCap);
    expect(r[0]).toBe('b');
    expect(r.filter((x) => x === 'b')).toHaveLength(1);
  });
});

describe('item order', () => {
  it('Scarlet/Violet: staples first in config order, then type items, resist berries, berries, the rest', async () => {
    const f = getFormat('gen9');
    const dex = await loadDex('gen9');
    const groups = orderItems(dex.items(f.regulationId), { prefs: none, caps: f.capabilities });
    expect(groups.map((g) => g.id)).toEqual(['staples', 'typeBoost', 'resistBerries', 'berries', 'other']);
    expect(ids(groups[0]).slice(0, 4)).toEqual(['choicescarf', 'choiceband', 'choicespecs', 'lifeorb']);
    expect(ids(groups[1])[0]).toBe('silkscarf'); // Normal first
    expect(ids(groups[2])[0]).toBe('chilanberry');
    expect(ids(groups[2]).at(-1)).toBe('roseliberry'); // Fairy last
    // Every item appears exactly once.
    expect(groups.flatMap(ids).sort()).toEqual(dex.items(f.regulationId).map((i) => i.id).sort());
  });

  it('puts favorites, then recents, on top without repeating them below', async () => {
    const f = getFormat('gen9');
    const dex = await loadDex('gen9');
    const groups = orderItems(dex.items(f.regulationId), { prefs: { favorites: ['leftovers'], recent: ['charcoal', 'leftovers', 'notanitem'] }, caps: f.capabilities });
    expect(groups.slice(0, 2).map((g) => [g.id, ids(g)])).toEqual([
      ['favorites', ['leftovers']],
      ['recent', ['charcoal']],
    ]);
    expect(groups.flatMap(ids).filter((id) => id === 'leftovers')).toHaveLength(1);
  });

  it('Champions: the set’s own Mega Stone leads the Mega Stones', async () => {
    const f = getFormat('champions-vgc-reg-mc');
    const dex = await loadDex('champions');
    const groups = orderItems(dex.items(f.regulationId), { prefs: none, caps: f.capabilities, speciesId: 'garchomp' });
    const gimmick = groups.find((g) => g.id === 'gimmick')!;
    expect(ids(gimmick)[0]).toBe('garchompite');
  });

  it('Sun/Moon lists Z-Crystals with the Mega Stones; A–Z mode is one alphabetical group', async () => {
    const f = getFormat('gen7');
    const dex = await loadDex('gen7');
    const groups = orderItems(dex.items(f.regulationId), { prefs: none, caps: f.capabilities });
    expect(ids(groups.find((g) => g.id === 'gimmick')!)).toEqual(expect.arrayContaining(['firiumz', 'charizarditex']));
    const az = orderItems(dex.items(f.regulationId), { prefs: none, caps: f.capabilities, alphabetical: true });
    expect(az.map((g) => g.id)).toEqual(['all']);
  });
});

describe('move order', () => {
  it('STAB then coverage grouped by type (strongest first within a type), then setup, support and fixed-power attacks', async () => {
    const f = getFormat('gen9');
    const dex = await loadDex('gen9');
    const garchomp = dex.species('garchomp')!;
    const groups = orderMoves(dex.learnset('garchomp', f.regulationId), { prefs: none, stabTypes: garchomp.types });
    expect(groups.map((g) => g.id)).toEqual(['stab', 'coverage', 'setup', 'support', 'other'].filter((id) => groups.some((g) => g.id === id)));

    // Grouped by type (TYPE_NAMES order: every move of one type before the next type starts),
    // strongest first within a type — for every attack group the new byType comparator covers.
    const expectGroupedByType = (entries: { type: string; basePower: number }[]) => {
      const typeOrder = entries.map((m) => TYPE_NAMES.indexOf(m.type as never));
      expect(typeOrder).toEqual([...typeOrder].sort((a, b) => a - b));
      for (const t of new Set(entries.map((m) => m.type))) {
        const powers = entries.filter((m) => m.type === t).map((m) => m.basePower);
        expect(powers).toEqual([...powers].sort((a, b) => b - a));
      }
    };
    const stab = groups.find((g) => g.id === 'stab')!.entries;
    expect(stab.every((m) => garchomp.types.includes(m.type as never))).toBe(true);
    expectGroupedByType(stab);
    const coverage = groups.find((g) => g.id === 'coverage')?.entries ?? [];
    expect(coverage.every((m) => !garchomp.types.includes(m.type as never))).toBe(true);
    expectGroupedByType(coverage);

    expect(ids(groups.find((g) => g.id === 'setup')!)).toContain('swordsdance');
    expect(ids(groups.find((g) => g.id === 'support')!)).toContain('protect');
  });

  it('classifies moves', async () => {
    const dex = await loadDex('gen9');
    const m = (id: string) => dex.move(id)!;
    expect(moveGroupOf(m('shellsmash'), ['Water'])).toBe('setup');
    expect(moveGroupOf(m('willowisp'), ['Fire'])).toBe('support');
    expect(moveGroupOf(m('seismictoss'), ['Normal'])).toBe('other');
    expect(moveGroupOf(m('earthquake'), ['Ground'])).toBe('stab');
    expect(moveGroupOf(m('earthquake'), ['Fire'])).toBe('coverage');
  });
});

describe('Pokémon order', () => {
  it('lists legal species by National Dex number and unavailable ones last', async () => {
    const f = getFormat('champions-vgc-reg-mc');
    const dex = await loadDex('champions');
    const legal = dex.selectableSpecies(f.regulationId);
    const unavailable = dex.allSpecies().filter((s) => !s.isMega && !s.legalIn.includes(f.regulationId!));
    const groups = orderSpecies(legal, { prefs: { favorites: [unavailable[0]?.id ?? 'x'], recent: [] }, unavailable });
    const available = groups.find((g) => g.id === 'legal')!.entries;
    expect(available.map((s) => s.num)).toEqual([...available.map((s) => s.num)].sort((a, b) => a - b));
    if (unavailable.length) {
      expect(groups.at(-1)!.id).toBe('unavailable');
      // An unavailable species can't be promoted to Favorites.
      expect(groups.some((g) => g.id === 'favorites')).toBe(false);
    }
    expect(orderSpecies(legal, { prefs: none }).some((g) => g.id === 'unavailable')).toBe(false);
  });
});

describe('ability order', () => {
  it('lists slot 1, slot 2, then the Hidden Ability', async () => {
    const dex = await loadDex('gen9');
    expect(dex.abilitiesOf('garchomp').map((a) => a.slot)).toEqual(['0', 'H']);
    expect(dex.abilitiesOf('gyarados').map((a) => a.slot)).toEqual(['0', 'H']);
    expect(dex.abilitiesOf('incineroar').map((a) => a.ability.id)).toEqual(['blaze', 'intimidate']);
    expect(dex.abilitiesOf('dragonite').map((a) => a.slot)).toEqual(['0', 'H']);
  });
});
