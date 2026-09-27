import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { FORMATS, currentRegulation, getFormat } from '@/domain/formats';
import { createSet, createTeam } from '@/domain/team';
import { validateTeam } from '@/domain/validation';
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
