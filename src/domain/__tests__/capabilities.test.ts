import { describe, expect, it } from 'vitest';
import { loadDex } from '@/data/dex';
import { datasetCapabilities } from '@/domain/capabilities';
import { toCalcPokemon } from '@/domain/battle/damage';
import { defaultSide } from '@/domain/battle/conditions';
import { decodeShareString, encodeShareString, exportChampionsText, exportTeamShowdown, importShowdown, parseBackup, exportBackup } from '@/domain/codecs';
import { FORMATS } from '@/domain/formats';
import { createSet, createTeam } from '@/domain/team';
import type { FormatRules, Team } from '@/domain/types';
import { validateTeam } from '@/domain/validation';
import { useTeamStore } from '@/store/teamStore';

/** One format per game (dataset): Champions' newest regulation, Gen 1–9, Let's Go, BDSP, Legends. */
const PER_GAME: FormatRules[] = [...new Map(FORMATS.map((f) => [f.datasetId, f])).values()];

describe('capability flags', () => {
  it('covers every game', () => {
    expect(PER_GAME.map((f) => f.datasetId).sort()).toEqual(
      ['bdsp', 'champions', 'gen1', 'gen2', 'gen3', 'gen4', 'gen5', 'gen6', 'gen7', 'gen8', 'gen9', 'lgpe', 'pla', 'za'].sort(),
    );
  });

  it('enables Terastallization only in Scarlet/Violet (gen9)', () => {
    for (const f of FORMATS) expect(f.capabilities.tera, f.id).toBe(f.datasetId === 'gen9');
  });

  it('matches each game’s other gimmicks', () => {
    const on = (k: 'mega' | 'zMoves' | 'dynamax') => PER_GAME.filter((f) => f.capabilities[k]).map((f) => f.datasetId).sort();
    expect(on('mega')).toEqual(['champions', 'gen6', 'gen7', 'lgpe', 'za']);
    expect(on('zMoves')).toEqual(['gen7']);
    expect(on('dynamax')).toEqual(['gen8']);
    expect(datasetCapabilities('unknown')).toEqual({ tera: false, mega: false, zMoves: false, dynamax: false });
  });
});

describe.each(PER_GAME.map((f) => [f.datasetId, f] as const))('Tera data in %s', (datasetId, format) => {
  const sv = datasetId === 'gen9';

  const setup = async () => {
    const dex = await loadDex(format.datasetId);
    const species = dex.selectableSpecies(format.regulationId)[0];
    const set = { ...createSet(dex, species.id, format), teraType: 'Fire' as const };
    const team: Team = { ...createTeam(format, 'Tera test'), slots: [set, null, null, null, null, null] };
    return { dex, species, set, team };
  };

  it(sv ? 'defaults a new set to its first type' : 'gives a new set no Tera Type', async () => {
    const { dex, species } = await setup();
    expect(createSet(dex, species.id, format).teraType).toBe(sv ? species.types[0] : undefined);
  });

  it(sv ? 'can be set in the store' : 'cannot be set in the store', () => {
    const t = createTeam(format, 'Store test');
    useTeamStore.setState({ teams: { [t.id]: t }, order: [t.id], activeTeamId: t.id, activeSlot: 0, battle: {} });
    return setup().then(({ set }) => {
      const { setSlot, updateSet } = useTeamStore.getState();
      setSlot(t.id, 0, set);
      expect(useTeamStore.getState().teams[t.id].slots[0]!.teraType).toBe(sv ? 'Fire' : undefined);
      updateSet(t.id, 0, { teraType: 'Water' });
      expect(useTeamStore.getState().teams[t.id].slots[0]!.teraType).toBe(sv ? 'Water' : undefined);
    });
  });

  it(sv ? 'is exported' : 'is never exported', async () => {
    const { dex, team } = await setup();
    expect(exportTeamShowdown(team, dex, format).includes('Tera Type')).toBe(sv);
    expect(exportChampionsText(team, dex, format).includes('Tera Type')).toBe(sv);
    const code = encodeShareString(team);
    expect(JSON.stringify(decodeShareString(code, dex, format)).includes('"teraType"')).toBe(sv);
    // The share payload itself doesn't carry it either.
    expect(atob(code.slice(5).replace(/-/g, '+').replace(/_/g, '/')).includes('Fire')).toBe(sv);
    expect(exportBackup(parseBackup(exportBackup([team]))).includes('"teraType"')).toBe(sv);
  });

  it(sv ? 'is imported from a Showdown paste' : 'ignores Tera Type lines on import', async () => {
    const { dex, species } = await setup();
    const { team, warnings } = importShowdown(`${species.name}\nTera Type: Fire\n`, dex, format);
    expect(team.slots[0]!.teraType).toBe(sv ? 'Fire' : undefined);
    expect(warnings.some((w) => w.includes('Tera'))).toBe(!sv);
  });

  it(sv ? 'reaches the damage calculator' : 'never reaches the damage calculator', async () => {
    const { dex, set } = await setup();
    const p = toCalcPokemon(dex, set, { ...defaultSide(), tera: true });
    expect(p.teraType).toBe(sv ? 'Fire' : undefined);
  });

  it(sv ? 'is checked by validation' : 'is not referenced by validation', async () => {
    const { dex, team } = await setup();
    const noTera: Team = { ...team, slots: [{ ...team.slots[0]!, teraType: undefined }, null, null, null, null, null] };
    expect(validateTeam(noTera, format, dex).some((i) => i.code === 'no-tera')).toBe(sv);
    expect(validateTeam(team, format, dex).some((i) => /tera/i.test(i.code + i.message))).toBe(false);
  });
});

describe('Mega Stones and Z-Crystals', () => {
  it('offers only the Mega Stones whose Mega is in the game', async () => {
    const lgpe = await loadDex('lgpe');
    const stones = lgpe.items('lgpe');
    expect(stones.map((i) => i.id)).toContain('venusaurite');
    expect(stones.map((i) => i.id)).not.toContain('garchompite');
    for (const i of stones) expect(Object.values(i.megaStone!).some((m) => lgpe.species(m)), i.id).toBe(true);
    // Z-A stones whose Mega the data doesn't define yet are kept rather than silently dropped.
    const za = await loadDex('za');
    expect(za.items('za').map((i) => i.id)).toEqual(expect.arrayContaining(['meowsticite', 'tatsugirinite', 'zygardite']));
  });

  it('notes that Z-Moves are not modelled, only in Sun/Moon', async () => {
    for (const id of ['gen7', 'gen6']) {
      const format = FORMATS.find((f) => f.id === id)!;
      const dex = await loadDex(id);
      const team: Team = { ...createTeam(format), slots: [{ ...createSet(dex, 'charizard', format), itemId: id === 'gen7' ? 'firiumz' : 'charcoal' }, null, null, null, null, null] };
      expect(validateTeam(team, format, dex).some((i) => i.code === 'z-not-modelled')).toBe(id === 'gen7');
    }
  });
});
