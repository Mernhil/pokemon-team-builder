import { describe, expect, it } from 'vitest';
import { Generations, Pokemon as CalcPokemon } from '@smogon/calc';
import { loadDex, type Dex } from '@/data/dex';
import { exportTeamShowdown, importShowdown } from '@/domain/codecs';
import { calcMoves, calcSpeed } from '@/domain/battle/damage';
import { defaultField, defaultSide } from '@/domain/battle/conditions';
import { getFormat } from '@/domain/formats';
import { calcStats, gbStatExpBonus, investmentForTarget, lgpeFriendshipPercent, plaEffortBonus, plaStat, statExpToEV, withSpreadValue } from '@/domain/stats';
import { createSet, createTeam } from '@/domain/team';
import { STAT_IDS, type PokemonSet, type StatId, type StatTable } from '@/domain/types';
import { validateTeam } from '@/domain/validation';

const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const dexes = new Map<number, Dex>();
const dexFor = async (g: number) => dexes.get(g) ?? (dexes.set(g, await loadDex(`gen${g}`)), dexes.get(g)!);
const stats = (f: (s: StatId) => number) => Object.fromEntries(STAT_IDS.map((s) => [s, f(s)])) as StatTable;

describe('Gen 1–9 datasets', () => {
  it.each(GENS)('gen %i is self-consistent', async (g) => {
    const dex = await dexFor(g);
    expect(dex.generation).toBe(g);
    for (const s of dex.allSpecies()) {
      for (const t of s.types) expect(dex.types, `${s.id} ${t}`).toContain(t);
      if (!s.isMega) for (const m of dex.data.learnsets[s.id]) expect(dex.data.moves[m], `${s.id} → ${m}`).toBeDefined();
      if (g < 3) expect(Object.keys(s.abilities)).toHaveLength(0);
      if (g < 5) expect(s.abilities.H).toBeUndefined();
    }
  });

  it('has each generation’s roster, types and items', async () => {
    const counts = await Promise.all(GENS.map(async (g) => (await dexFor(g)).selectableSpecies().filter((s) => !s.forme).length));
    expect(counts.slice(0, 7)).toEqual([151, 251, 386, 493, 649, 721, 807]); // Gen 7 adds Meltan/Melmetal in Let's Go, not SM/USUM
    expect((await dexFor(1)).types).not.toContain('Dark');
    expect((await dexFor(2)).types).toContain('Steel');
    expect((await dexFor(5)).types).not.toContain('Fairy');
    expect((await dexFor(6)).types).toContain('Fairy');
    expect((await dexFor(1)).items()).toHaveLength(0);
    expect((await dexFor(8)).species('bulbasaur')).toBeDefined(); // Isle of Armor
    expect((await dexFor(8)).species('chikorita')).toBeUndefined(); // not in Sword/Shield
  });

  it('uses move data as it was in each generation', async () => {
    const m = async (g: number, id: string) => (await dexFor(g)).move(id)!;
    expect((await m(1, 'bite')).type).toBe('Normal');
    expect((await m(2, 'bite')).type).toBe('Dark');
    expect((await m(1, 'gust')).type).toBe('Normal');
    expect((await m(3, 'shadowball')).category).toBe('Physical'); // Ghost was a physical type
    expect((await m(4, 'shadowball')).category).toBe('Special');
    expect((await m(2, 'curse')).type).toBe('???');
    expect((await m(5, 'curse')).type).toBe('Ghost');
    expect((await m(5, 'thunderbolt')).basePower).toBe(95);
    expect((await m(6, 'thunderbolt')).basePower).toBe(90);
    expect((await m(1, 'psychic')).shortDesc).toMatch(/Special/);
  });

  it('limits movepools to what the generation’s games taught, including pre-evolution moves', async () => {
    const d1 = await dexFor(1);
    expect(d1.canLearn('pikachu', 'surf')).toBe(true); // Surfing Pikachu (Stadium)
    expect(d1.canLearn('pikachu', 'irontail')).toBe(false); // Gen 2 TM
    expect((await dexFor(2)).canLearn('pikachu', 'irontail')).toBe(true);
    expect((await dexFor(4)).canLearn('garchomp', 'dragonrush')).toBe(true); // Gible egg move
    expect((await dexFor(9)).canLearn('garchomp', 'dragonrage')).toBe(false); // gone after Gen 7
    expect((await dexFor(4)).canLearn('raichu', 'volttackle')).toBe(true); // via Pichu (Light Ball breeding)
  });
});

describe('stat formulas match Pokémon Showdown’s calculator', () => {
  it.each(GENS)('gen %i, every species', async (g) => {
    const dex = await dexFor(g);
    const format = getFormat(`gen${g}`);
    const gen = Generations.get(g as never);
    const gb = g <= 2;
    const set: PokemonSet = {
      ...createSet(dex, dex.allSpecies()[0].id, format),
      level: 77,
      evs: gb ? stats((s) => ({ hp: 65535, atk: 400, def: 0, spa: 12345, spd: 12345, spe: 1 })[s]!) : stats((s) => ({ hp: 4, atk: 252, def: 0, spa: 100, spd: 0, spe: 152 })[s]!),
      ivs: gb ? stats((s) => ({ hp: 0, atk: 13, def: 6, spa: 15, spd: 15, spe: 2 })[s]!) : stats((s) => ({ hp: 31, atk: 0, def: 17, spa: 31, spd: 30, spe: 31 })[s]!),
      nature: 'Adamant',
    };
    for (const sp of dex.allSpecies()) {
      if (!gen.species.get(sp.id as never)) continue;
      const ours = calcStats(sp.baseStats, set, format, dex.nature(set.nature));
      const theirs = new CalcPokemon(gen, sp.name, {
        level: set.level,
        nature: (gb ? undefined : 'Adamant') as never,
        evs: gb ? stats((s) => statExpToEV(set.evs[s])) : set.evs,
        ivs: gb ? stats((s) => set.ivs[s] * 2) : set.ivs,
        overrides: { baseStats: sp.baseStats } as never,
      }).stats;
      expect(ours, sp.id).toEqual({ ...theirs });
    }
  });

  it('finds the least Stat Exp / EVs for a Speed target', async () => {
    const f1 = getFormat('gen1');
    const dex = await dexFor(1);
    const set = { ...createSet(dex, 'tauros', f1), evs: stats(() => 0) };
    const need = investmentForTarget('spe', dex.species('tauros')!.baseStats, 290, set, f1)!;
    expect(calcStats(dex.species('tauros')!.baseStats, { ...set, evs: { ...set.evs, spe: need } }, f1).spe).toBeGreaterThanOrEqual(290);
    expect(calcStats(dex.species('tauros')!.baseStats, { ...set, evs: { ...set.evs, spe: need - 1 } }, f1).spe).toBeLessThan(290);
    expect(gbStatExpBonus(need)).toBeGreaterThan(gbStatExpBonus(need - 1));
    const f4 = getFormat('gen4');
    const d4 = await dexFor(4);
    const s4 = createSet(d4, 'garchomp', f4);
    expect(investmentForTarget('spe', d4.species('garchomp')!.baseStats, 333, s4, f4, d4.nature('Jolly'))).toBe(252);
    expect(investmentForTarget('spe', d4.species('garchomp')!.baseStats, 400, s4, f4, d4.nature('Jolly'))).toBeNull();
  });
});

describe('Gen 1–2 sets', () => {
  it('keep Sp. Atk and Sp. Def on one Special DV and Stat Exp', () => {
    const sys = getFormat('gen2').statSystem;
    const set = { sp: stats(() => 0), evs: stats(() => 0), ivs: stats(() => 15) };
    const a = withSpreadValue(set, sys, 'ivs', 'spa', 7);
    expect([a.ivs.spa, a.ivs.spd]).toEqual([7, 7]);
    const b = withSpreadValue(set, sys, 'evs', 'spa', 99999);
    expect([b.evs.spa, b.evs.spd]).toEqual([65535, 65535]);
  });

  it('round-trip through Showdown text (Stat Exp as EVs, DVs as IVs)', async () => {
    const dex = await dexFor(2);
    const format = getFormat('gen2');
    const team = createTeam(format);
    const set = createSet(dex, 'snorlax', format);
    set.itemId = 'leftovers';
    set.moves = ['bodyslam', 'curse', 'rest', 'sleeptalk'];
    set.ivs = { ...set.ivs, atk: 14, def: 13 };
    set.evs = { ...set.evs, spe: 0, def: 10000 };
    team.slots[0] = set;
    const text = exportTeamShowdown(team, dex, format);
    expect(text).toContain('IVs: 28 Atk / 26 Def');
    expect(text).toContain('EVs: 100 Def / 0 Spe');
    expect(text).not.toMatch(/Nature|Ability/);
    const back = importShowdown(text, dex, format).team.slots[0]!;
    expect(back.ivs).toMatchObject({ atk: 14, def: 13, spa: 15, spe: 15 });
    expect(calcStats(dex.species('snorlax')!.baseStats, back, format)).toEqual(calcStats(dex.species('snorlax')!.baseStats, set, format));
    expect(validateTeam(team, format, dex).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flag what a generation did not have', async () => {
    const dex = await dexFor(1);
    const format = getFormat('gen1');
    const team = createTeam(format);
    team.slots[0] = { ...createSet(dex, 'pikachu', format), itemId: 'leftovers', moves: ['thunderbolt', 'flamethrower', 'irontail', ''] };
    const codes = validateTeam(team, format, dex).map((i) => i.code);
    expect(codes).toContain('item-illegal');
    expect(codes).toContain('move-illegal'); // exists in Gen 1, Pikachu can't learn it
    expect(codes).toContain('unknown-move'); // Iron Tail didn't exist yet
    expect(codes).not.toContain('no-ability');
  });
});

describe('damage calc per generation', () => {
  it('runs Gen 1 mechanics (Normal-type Bite, one Special stat)', async () => {
    const dex = await dexFor(1);
    const f = getFormat('gen1');
    const tauros = { ...createSet(dex, 'tauros', f), moves: ['bodyslam', 'hyperbeam', 'blizzard', 'earthquake'] as PokemonSet['moves'] };
    const chansey = createSet(dex, 'chansey', f);
    const [bodySlam, , blizzard] = calcMoves(dex, { set: tauros, cond: defaultSide() }, { set: chansey, cond: defaultSide() }, defaultField());
    expect(bodySlam.range[0]).toBeGreaterThan(0);
    expect(bodySlam.percent[1]).toBeLessThan(blizzard.percent[1] * 10);
    expect(blizzard.category).toBe('Special');
  });
});

describe('Pokédex Area maps', () => {
  /** Locations without a fixed spot on the region map: roaming, event islands, Mirage spots, Ultra Space… */
  const OFF_MAP = /^(roaming-|unknown-|.*-pokemart$|.*-pokecenter$)|^(terra-cave|marine-cave|navel-rock|birth-island|faraway-island|southern-island|crescent-isle|trackless-forest|nameless-cavern|soaring-in-the-sky|pathless-plain|fabled-cave|gnarled-den|mirage-spot-.*|new-mauville|ultra-.*|team-flare-secret-hq)$/;

  it.each(['gen1', 'gen2', 'gen3', 'gen4', 'gen5', 'gen6', 'gen7', 'gen8', 'gen9', 'lgpe', 'bdsp', 'pla', 'za'])('%s: every wild location is on its game’s map', async (g) => {
    const { default: maps } = (await import('@/data/generated/maps.json')) as unknown as {
      default: { maps: Record<string, { places: Record<string, unknown> }>; games: Record<string, string[]> };
    };
    const { default: dex } = (await import(`@/data/generated/pokedex-${g}.json`)) as {
      default: { games: { id: string }[]; areas: { loc: string }[]; encounters: Record<string, number[][]> };
    };
    const missing = new Set<string>();
    for (const rows of Object.values(dex.encounters))
      for (const [game, area] of rows) {
        const loc = dex.areas[area].loc;
        const onMap = (maps.games[dex.games[game].id] ?? []).some((m) => maps.maps[m].places[loc]);
        if (!onMap && !OFF_MAP.test(loc)) missing.add(`${dex.games[game].id}:${loc}`);
      }
    expect([...missing]).toEqual([]);
  });
});

describe("Let's Go, BDSP and Legends formats", () => {
  it("computes Let's Go stats with AVs and friendship (PKHeX PB7)", async () => {
    const dex = await loadDex('lgpe');
    const f = getFormat('lgpe');
    const set = { ...createSet(dex, 'pikachu', f), level: 50, nature: 'Hardy' };
    expect(lgpeFriendshipPercent(255)).toBe(110);
    expect(lgpeFriendshipPercent(70)).toBe(102);
    // HP = ⌊(2×35 + 31) × 50/100⌋ + 50 + 10 = 110; Atk = ⌊110 × ⌊(2×55 + 31)/2 + 5⌋ / 100⌋ = ⌊110 × 75 / 100⌋ = 82
    const st = calcStats(dex.species('pikachu')!.baseStats, set, f, dex.nature('Hardy'));
    expect([st.hp, st.atk]).toEqual([110, 82]);
    const trained = calcStats(dex.species('pikachu')!.baseStats, { ...set, evs: stats(() => 200) }, f, dex.nature('Hardy'));
    expect([trained.hp, trained.atk]).toEqual([310, 282]);
    // The damage calculator uses these stats, not its own EV formula.
    const cond = defaultSide();
    expect(calcSpeed(dex, { set: { ...set, evs: stats(() => 200) }, cond }, defaultField())).toBe(trained.spe);
  });

  it('computes Legends: Arceus stats from Effort Levels (PKHeX PA8)', () => {
    expect(plaEffortBonus(100, 0, 50)).toBe(20); // (0 + 50) / 2.5
    expect(plaEffortBonus(100, 10, 50)).toBe(120); // (10 × 25 + 50) / 2.5
    expect(plaStat('hp', 100, 0, 50)).toBe(20 + 200); // ⌊(0.5 + 1) × 100 + 50⌋
    expect(plaStat('atk', 100, 0, 50)).toBe(20 + 133); // ⌊(50/50 + 1) × 100 / 1.5⌋ = 133
    expect(plaStat('atk', 100, 0, 50, { name: 'Adamant', plus: 'atk', minus: 'spa' })).toBe(20 + 146); // ⌊133 × 1.1⌋
  });

  it('builds each game from its own roster and movepools', async () => {
    const lgpe = await loadDex('lgpe');
    expect(lgpe.selectableSpecies().filter((s) => s.num > 151).map((s) => s.id).sort()).toEqual(['melmetal', 'meltan']);
    expect(lgpe.canLearn('pikachustarter', 'zippyzap')).toBe(true);
    expect(Object.keys(lgpe.data.abilities)).toHaveLength(0);
    expect(lgpe.items().every((i) => i.megaStone)).toBe(true);
    const bdsp = await loadDex('bdsp');
    expect(bdsp.species('sylveon')).toBeUndefined();
    expect(bdsp.species('arceus')).toBeDefined();
    const pla = await loadDex('pla');
    expect(pla.canLearn('kleavor', 'stoneaxe')).toBe(true);
    expect(pla.items()).toHaveLength(0);
    const za = await loadDex('za');
    expect(za.species('starmiemega')?.baseStats).toEqual({ hp: 60, atk: 140, def: 105, spa: 130, spd: 105, spe: 120 });
    expect(za.megaFor('starmie', 'starminite')?.id).toBe('starmiemega');
  });
});
