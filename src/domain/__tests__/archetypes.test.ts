import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { ARCHETYPE_RULES, bestArchetype, detectArchetypes, type ArchetypeMon } from '@/domain/archetypes';
import { getFormat } from '@/domain/formats';
import { ARCHETYPE_PRESETS } from '@/domain/matches';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');
const mon = (speciesId: string, abilityId: string | undefined, moves: string[], extra: Partial<ArchetypeMon> = {}): ArchetypeMon => ({ speciesId, abilityId, moves, ...extra });
const attack = ['earthquake', 'rockslide', 'dragonclaw', 'protect'];
const tagsOf = (mons: ArchetypeMon[], meta?: Parameters<typeof detectArchetypes>[3]) => detectArchetypes(mons, dex, fmt, meta);
const names = (d: ReturnType<typeof tagsOf>) => d.tags.map((t) => t.tag);

describe('weather', () => {
  const rain = [
    mon('pelipper', 'drizzle', ['hurricane', 'weatherball', 'tailwind', 'protect']),
    mon('basculegion', 'swiftswim', ['waterfall', 'flipturn', 'shadowball', 'protect']),
    mon('qwilfish', 'swiftswim', ['liquidation', 'crunch', 'poisonjab', 'protect']),
    mon('incineroar', 'intimidate', ['fakeout', 'flareblitz', 'knockoff', 'partingshot']),
  ];

  it('tags Rain for a Drizzle setter with Swift Swim users, and says why', () => {
    const d = tagsOf(rain);
    const t = d.tags.find((x) => x.tag === 'Rain')!;
    expect(t.confidence).toBeGreaterThanOrEqual(0.8);
    expect(t.reasons.join(' ')).toMatch(/Pelipper sets rain/);
    expect(t.reasons.join(' ')).toMatch(/2 rain users \(Basculegion, Qwilfish\)/);
    expect(names(d)).toContain('Tailwind');
  });

  it('tags Sun, Sand and Snow from their setters and users', () => {
    expect(names(tagsOf([mon('torkoal', 'drought', ['eruption', 'protect', 'helpinghand', 'heatwave']), mon('venusaur', 'chlorophyll', ['sludgebomb', 'solarbeam', 'protect', 'sleeppowder'])]))).toContain('Sun');
    expect(names(tagsOf([mon('tyranitar', 'sandstream', ['rockslide', 'crunch', 'protect', 'stoneedge']), mon('excadrill', 'sandrush', ['ironhead', 'highhorsepower', 'protect', 'rockslide'])]))).toContain('Sand');
    expect(names(tagsOf([mon('abomasnow', 'snowwarning', ['blizzard', 'woodhammer', 'protect', 'auroraveil']), mon('beartic', 'slushrush', ['icepunch', 'superpower', 'protect', 'iciclecrash'])]))).toContain('Hail/Snow');
  });

  it('a weather setter nobody uses is a weak signal, not a tag', () => {
    const d = tagsOf([mon('pelipper', 'drizzle', ['hurricane', 'protect', 'wideguard', 'tailwind']), mon('kingambit', 'defiant', ['suckerpunch', 'ironhead', 'kowtowcleave', 'protect'])]);
    expect(names(d)).not.toContain('Rain');
    const weak = d.weak.find((t) => t.tag === 'Rain')!;
    expect(weak.confidence).toBeLessThan(ARCHETYPE_RULES.minConfidence);
    expect(weak.reasons.join(' ')).toMatch(/nothing that uses rain/);
  });

  it('a Mega Stone holder uses its Mega\'s ability', () => {
    const d = tagsOf([mon('tyranitar', 'unnerve', ['rockslide', 'crunch', 'protect', 'stoneedge'], { itemId: 'tyranitarite' }), mon('excadrill', 'sandrush', ['ironhead', 'highhorsepower', 'protect', 'rockslide'])]);
    expect(names(d)).toContain('Sand');
    expect(d.tags.find((t) => t.tag === 'Sand')!.reasons[0]).toMatch(/Mega Tyranitar sets sand/);
  });
});

describe('Trick Room and Tailwind', () => {
  it('Trick Room needs a setter and slow Pokémon', () => {
    const tr = [
      mon('hatterene', 'magicbounce', ['trickroom', 'dazzlinggleam', 'psychic', 'protect']),
      mon('torkoal', 'whitesmoke', ['eruption', 'protect', 'heatwave', 'bodypress']),
      mon('kingambit', 'defiant', ['suckerpunch', 'ironhead', 'kowtowcleave', 'protect']),
      mon('farigiraf', 'armortail', ['hypervoice', 'psychic', 'helpinghand', 'protect']),
    ];
    const d = tagsOf(tr);
    expect(names(d)).toContain('Trick Room');
    expect(d.tags.find((t) => t.tag === 'Trick Room')!.reasons.join(' ')).toMatch(/Hatterene sets Trick Room/);
    // The same setter with a fast team is not a Trick Room team.
    const fastTeam = [mon('hatterene', 'magicbounce', ['trickroom', 'psychic', 'protect', 'dazzlinggleam']), mon('sneasler', 'unburden', attack), mon('talonflame', 'galewings', attack), mon('gengar', 'cursedbody', attack)];
    expect(names(tagsOf(fastTeam))).not.toContain('Trick Room');
    expect(tagsOf(fastTeam).weak.map((t) => t.tag)).toContain('Trick Room');
  });

  it('Tailwind is tagged on one setter', () => {
    const d = tagsOf([mon('whimsicott', 'prankster', ['tailwind', 'moonblast', 'encore', 'protect']), mon('garchomp', 'sandveil', attack)]);
    expect(names(d)).toContain('Tailwind');
  });
});

describe('offensive and defensive profiles', () => {
  it('Hyper Offense: fast, frail attackers', () => {
    const d = tagsOf([mon('sneasler', 'unburden', attack), mon('talonflame', 'galewings', attack), mon('gengar', 'cursedbody', ['shadowball', 'sludgebomb', 'focusblast', 'protect']), mon('hydreigon', 'levitate', ['darkpulse', 'dracometeor', 'flamethrower', 'protect']), mon('lucario', 'justified', ['closecombat', 'meteormash', 'extremespeed', 'protect']), mon('mimikyu', 'disguise', ['playrough', 'shadowclaw', 'woodhammer', 'protect'])]);
    expect(bestArchetype(d)).toBe('Hyper Offense');
  });

  it('Bulky Offense: bulky attackers that are not fast', () => {
    const d = tagsOf([mon('kingambit', 'defiant', ['suckerpunch', 'ironhead', 'kowtowcleave', 'protect']), mon('incineroar', 'intimidate', ['fakeout', 'flareblitz', 'knockoff', 'partingshot']), mon('rillaboom', 'grassysurge', ['grassyglide', 'woodhammer', 'fakeout', 'uturn']), mon('kommoo', 'bulletproof', ['clangingscales', 'closecombat', 'protect', 'poisonjab']), mon('dragonite', 'multiscale', ['extremespeed', 'outrage', 'protect', 'earthquake']), mon('clefable', 'unaware', ['moonblast', 'protect', 'followme', 'helpinghand'])]);
    expect(bestArchetype(d)).toBe('Bulky Offense');
  });

  it('Stall only when it clearly is one', () => {
    const wall = (id: string, ab: string) => mon(id, ab, ['recover', 'protect', 'toxic', 'whirlwind']);
    const d = tagsOf([wall('snorlax', 'thickfat'), wall('umbreon', 'synchronize'), wall('garganacl', 'purifyingsalt'), wall('avalugg', 'sturdy'), wall('hippowdon', 'sandstream'), wall('torkoal', 'whitesmoke')]);
    expect(names(d)).toContain('Stall');
    // Walls that also hit hard are not Stall.
    expect(names(tagsOf([mon('torkoal', 'whitesmoke', ['eruption', 'heatwave', 'earthpower', 'protect']), mon('hatterene', 'healer', ['psychic', 'dazzlinggleam', 'mysticalfire', 'recover']), mon('clefable', 'magicguard', ['moonblast', 'flamethrower', 'thunderbolt', 'recover']), mon('farigiraf', 'cudchew', ['psychic', 'hypervoice', 'shadowball', 'protect'])]))).not.toContain('Stall');
  });

  it('Balance needs several roles and known sets, otherwise nothing', () => {
    const mixed = [mon('incineroar', 'intimidate', ['fakeout', 'flareblitz', 'knockoff', 'partingshot']), mon('whimsicott', 'prankster', ['tailwind', 'moonblast', 'encore', 'protect']), mon('sneasler', 'unburden', ['closecombat', 'direclaw', 'protect', 'fakeout']), mon('kingambit', 'defiant', ['suckerpunch', 'ironhead', 'protect', 'swordsdance'])];
    expect(names(tagsOf(mixed))).toContain('Balance');
    expect(tagsOf([mon('garchomp', undefined, undefined as unknown as string[])]).tags).toEqual([]);
  });
});

describe('unknown sets', () => {
  const meta = (id: string) =>
    id === 'pelipper' ? { abilityId: 'drizzle', itemId: 'damprock', moves: ['hurricane', 'weatherball', 'tailwind', 'protect'], nature: 'Modest' }
    : id === 'basculegion' ? { abilityId: 'swiftswim', itemId: 'mysticwater', moves: ['waterfall', 'flipturn', 'shadowball', 'protect'], nature: 'Adamant' }
    : undefined;

  it('falls back to the most-used set, and reports which species it did that for', () => {
    const d = tagsOf([{ speciesId: 'pelipper' }, { speciesId: 'basculegion' }], meta);
    expect(names(d)).toContain('Rain');
    expect(d.fromMeta.sort()).toEqual(['basculegion', 'pelipper']);
  });

  it('says nothing about species it knows nothing of, and ignores ids that are not species', () => {
    expect(tagsOf([{ speciesId: 'pelipper' }, { speciesId: 'basculegion' }]).tags).toEqual([]);
    expect(tagsOf([{ speciesId: 'notapokemon' }]).tags).toEqual([]);
    expect(tagsOf([]).tags).toEqual([]);
  });

  it('known sets are never replaced by the meta', () => {
    const d = tagsOf([mon('pelipper', 'keeneye', ['surf', 'protect', 'wideguard', 'knockoff'])], meta);
    expect(d.fromMeta).toEqual([]);
    expect(names(d)).not.toContain('Rain');
  });
});

describe('the result', () => {
  it('only uses names the match log knows, best first', () => {
    const d = tagsOf([mon('pelipper', 'drizzle', ['hurricane', 'tailwind', 'protect', 'weatherball']), mon('basculegion', 'swiftswim', ['waterfall', 'protect', 'flipturn', 'shadowball'])]);
    for (const t of [...d.tags, ...d.weak]) expect(ARCHETYPE_PRESETS).toContain(t.tag);
    expect(d.tags.map((t) => t.confidence)).toEqual([...d.tags.map((t) => t.confidence)].sort((a, b) => b - a));
    for (const t of d.tags) {
      expect(t.confidence).toBeGreaterThanOrEqual(ARCHETYPE_RULES.minConfidence);
      expect(t.confidence).toBeLessThanOrEqual(1);
      expect(t.reasons.length).toBeGreaterThan(0);
    }
  });
});
