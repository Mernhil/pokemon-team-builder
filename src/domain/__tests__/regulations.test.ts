import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { FORMATS, currentRegulation, getFormat } from '@/domain/formats';
import { createSet, createTeam } from '@/domain/team';
import { validateTeam } from '@/domain/validation';
import { introducedIn, megaList, megaStoneName } from '@/domain/pokedex';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);

describe('Regulation overlays', () => {
  it('generates one Champions format per regulation, newest first', () => {
    const ids = FORMATS.filter((f) => f.datasetId === 'champions').map((f) => f.regulationId);
    expect(ids).toEqual(['champions-reg-mc', 'champions-reg-mb', 'champions-reg-ma']);
  });

  it('picks the live regulation by date', () => {
    expect(currentRegulation(new Date('2026-10-01'))?.id).toBe('champions-reg-mc');
    expect(currentRegulation(new Date('2026-07-01'))?.id).toBe('champions-reg-mb');
    expect(currentRegulation(new Date('2026-01-01'))).toBeUndefined();
  });

  it('Reg M-C adds species, Megas, items and moves on top of Reg M-B', () => {
    expect(dex.species('cinderace')!.legalIn).toEqual(['champions-reg-mc']);
    expect(dex.species('garchomp')!.legalIn).toContain('champions-reg-mc');
    expect(dex.species('garchomp')!.megaForms).toEqual(['garchompmega', 'garchompmegaz']);
    expect(dex.megaFor('garchomp', 'garchompitez')?.id).toBe('garchompmegaz');
    expect(dex.item('rockyhelmet')!.legalIn).toEqual(['champions-reg-mc']);
    expect(dex.move('pyroball')!.legalIn).toEqual(['champions-reg-mc']);
  });

  it('evolutions inherit their pre-evolutions\' egg and level-up moves', () => {
    // Egg moves live on the base form in Showdown's data: Fake Out is Grookey's / Pawmi's, not Rillaboom's / Pawmot's.
    expect(data.learnsets.rillaboom).toContain('fakeout');
    expect(data.learnsets.pawmot).toContain('fakeout');
    // TMs a pre-evolution alone could use don't carry over.
    expect(data.learnsets.kingambit).not.toContain('fakeout');
  });

  it('statForm finds the battle forme that changes stats, and nothing else', () => {
    expect(dex.statForm('aegislash')?.id).toBe('aegislashblade');
    expect(dex.statForm('palafin')?.id).toBe('palafinhero');
    expect(dex.statForm('mimikyu')).toBeUndefined(); // Busted keeps Mimikyu's base stats
    expect(dex.statForm('morpeko')).toBeUndefined(); // Hangry only changes the type
    expect(dex.statForm('castform')).toBeUndefined(); // Castform's formes change typing, not stats
    expect(dex.statForm('garchomp')).toBeUndefined(); // Megas are megaFor
    expect(dex.statForm('aegislashblade')).toBeUndefined();
  });

  it('applies species patches and new abilities from announcements', () => {
    expect(dex.species('lucariomegaz')!.abilities['0']).toBe('Aura Guard');
    expect(dex.ability('auraguard')?.name).toBe('Aura Guard');
    expect(dex.species('garchompmegaz')!.abilities['0']).toBe('Levitate');
  });

  it('flags M-C-only content in an M-B team', () => {
    const mb = getFormat('champions-vgc-reg-mb');
    const t = createTeam(mb);
    const s = createSet(dex, 'cinderace', mb);
    s.moves[0] = 'pyroball';
    t.slots[0] = s;
    const codes = validateTeam(t, mb, dex).map((i) => i.code);
    expect(codes).toContain('species-illegal');
    expect(codes).toContain('move-illegal');
  });
});

describe('Sprite atlases', () => {
  it('cover every species in the Champions dataset', () => {
    const idx = JSON.parse(readFileSync('public/sprites/champions.json', 'utf8')).index as Record<string, number>;
    const missing = dex.allSpecies().filter((s) => idx[s.id] === undefined).map((s) => s.id);
    expect(missing).toEqual([]);
  });
  it('gen sets contain only Pokémon from that generation or earlier', () => {
    const g1 = JSON.parse(readFileSync('public/sprites/gen1.json', 'utf8'));
    expect(g1.count).toBe(151);
    expect(g1.index.mew).toBeDefined();
    expect(g1.index.chikorita).toBeUndefined();
  });

  it('every species and item legal in every regulation (M-A, M-B, M-C) resolves to an atlas key', () => {
    const speciesIdx = JSON.parse(readFileSync('public/sprites/champions.json', 'utf8')).index as Record<string, number>;
    const itemIdx = JSON.parse(readFileSync('public/sprites/items.json', 'utf8')).index as Record<string, number>;
    const regulationIds = ['champions-reg-ma', 'champions-reg-mb', 'champions-reg-mc'];

    const missingSpecies: string[] = [];
    const missingItems: string[] = [];
    for (const regulationId of regulationIds) {
      for (const s of dex.allSpecies().filter((s) => s.legalIn.includes(regulationId))) {
        if (speciesIdx[s.id] === undefined) missingSpecies.push(`${regulationId}: ${s.id}`);
      }
      for (const i of dex.items(regulationId)) {
        if (itemIdx[i.id] === undefined) missingItems.push(`${regulationId}: ${i.id}`);
      }
    }
    if (missingSpecies.length) console.error('Missing species sprites:', missingSpecies);
    if (missingItems.length) console.error('Missing item icons:', missingItems);
    expect(missingSpecies).toEqual([]);
    expect(missingItems).toEqual([]);
  });
});

describe('Mega list (Champions Pokédex filter)', () => {
  const ids = (reg?: string) => megaList(dex, reg).map((s) => s.id);
  const REGS = ['champions-reg-ma', 'champions-reg-mb', 'champions-reg-mc'];

  it('lists a regulation\'s Megas, growing with each regulation', () => {
    expect(megaList(dex, 'champions-reg-ma').length).toBe(60);
    expect(megaList(dex, 'champions-reg-mb').length).toBe(76);
    expect(megaList(dex, 'champions-reg-mc').length).toBe(82);
    expect(ids('champions-reg-ma')).not.toContain('garchompmegaz');
    expect(ids('champions-reg-mc')).toContain('garchompmegaz');
  });

  it('keeps a Pokémon\'s Megas side by side, in order, inside National Dex order', () => {
    const all = ids('champions-reg-mc');
    const at = (id: string) => all.indexOf(id);
    expect(at('charizardmegay')).toBe(at('charizardmegax') + 1);
    expect(at('garchompmegaz')).toBe(at('garchompmega') + 1);
    expect(at('raichumegay')).toBe(at('raichumegax') + 1);
    const nums = megaList(dex, 'champions-reg-mc').map((s) => s.num);
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
  });

  it('names the stone and the regulation a Mega arrived in', () => {
    expect(megaStoneName(dex, dex.species('charizardmegax')!)).toBe('Charizardite X');
    expect(megaStoneName(dex, dex.species('garchompmegaz')!)).toBe('Garchompite Z');
    expect(introducedIn(dex.species('garchompmega')!, REGS)).toBe('champions-reg-ma');
    expect(introducedIn(dex.species('garchompmegaz')!, REGS)).toBe('champions-reg-mc');
  });
});
