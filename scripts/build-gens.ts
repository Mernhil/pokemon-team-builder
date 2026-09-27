/**
 * Per-generation datasets for the Gen 1–9 side of the app (called from build-data.ts).
 *
 * Everything comes from Pokémon Showdown's generation mods (via @pkmn/dex `Dex.forGen(n)`), so each
 * file describes that generation's games as they were:
 *   - species that exist in that generation (Gen 8/9: only those in Sword/Shield, Scarlet/Violet);
 *     no abilities before Gen 3, no Hidden Abilities before Gen 5, Megas in Gen 6–7
 *   - move data as of that generation (power, accuracy, PP, type — Gen 1 Bite is Normal — the
 *     type-based physical/special split before Gen 4, and that generation's effect text)
 *   - movepools: moves learnable in that generation's own games (level-up, TM/HM, tutor, egg,
 *     event), including moves learned by pre-evolutions; transfer-only moves are left out
 *   - held items (none in Gen 1), natures (Gen 3+), and that generation's type chart
 *
 * Writes src/data/generated/gen<N>.json (builder dataset) and gen<N>-learn.json (per-species learn
 * methods, used by the Pokédex's learnset tab).
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Dex, type Species } from '@pkmn/dex';

const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
const toID = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const SPREAD_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes', 'all', 'foeSide', 'allySide']);
/** Learn-method letters in Showdown learnset sources ("9L24", "3M", "4E", "2S0"…). V = transfer-only. */
const METHODS = new Set(['L', 'M', 'T', 'E', 'S', 'D', 'R']);

type GenDex = ReturnType<typeof Dex.forGen>;

export async function buildGenerations(outDir: string) {
  for (let gen = 1; gen <= 9; gen++) {
    const { dataset, learn } = await buildGen(gen);
    writeFileSync(resolve(outDir, `gen${gen}.json`), JSON.stringify(dataset));
    writeFileSync(resolve(outDir, `gen${gen}-learn.json`), JSON.stringify(learn));
    console.log(
      `wrote gen${gen}.json: ${Object.keys(dataset.species).length} species, ${Object.keys(dataset.moves).length} moves, ` +
        `${Object.keys(dataset.items).length} items, ${Object.keys(dataset.abilities).length} abilities`,
    );
  }
}

async function buildGen(gen: number) {
  const dex = Dex.forGen(gen as 1) as GenDex;
  const regId = `gen${gen}`;
  const legal = (x: { exists: boolean; isNonstandard?: string | null }) => x.exists && !x.isNonstandard;

  // ---------- Species ----------
  const isMega = (s: Species) => /^(Mega)/.test(s.forme);
  const pool = dex.species
    .all()
    .filter((s) => legal(s) && (!s.battleOnly || isMega(s)))
    .sort((a, b) => a.num - b.num || a.name.localeCompare(b.name));
  const inGen = new Set<string>(pool.map((s) => s.id));

  /** Own learn sources for this generation: moveId → method codes without the gen digit ("L24", "M"). */
  const ownSources = async (id: string): Promise<Record<string, string[]> | undefined> => {
    const ls = (await dex.learnsets.get(id))?.learnset;
    if (!ls) return undefined;
    const out: Record<string, string[]> = {};
    for (const [move, sources] of Object.entries(ls)) {
      const codes = sources.filter((c) => c.startsWith(String(gen)) && METHODS.has(c[1])).map((c) => c.slice(1));
      if (codes.length && legal(dex.moves.get(move))) out[move] = [...new Set(codes.map((c) => (c[0] === 'S' ? 'S' : c)))];
    }
    return out;
  };

  /** A forme's own list, merged with the forme it changes from (Rotom-Wash, Deoxys-Attack…). */
  const formeSources = async (s: Species) => {
    const own = await ownSources(s.id);
    const parent = s.changesFrom ? toID(s.changesFrom) : !own ? toID(s.baseSpecies) : undefined;
    const from = parent && parent !== s.id ? await ownSources(parent) : undefined;
    if (!own) return from ?? {};
    if (!from) return own;
    const merged = { ...from };
    for (const [m, c] of Object.entries(own)) merged[m] = [...new Set([...(merged[m] ?? []), ...c])];
    return merged;
  };

  const species: Record<string, unknown> = {};
  const learnsets: Record<string, string[]> = {};
  const learn: Record<string, Record<string, string>> = {};

  for (const s of pool) {
    const mega = isMega(s);
    if (!mega) {
      const own = await formeSources(s);
      learn[s.id] = Object.fromEntries(Object.entries(own).sort(([a], [b]) => a.localeCompare(b)).map(([m, c]) => [m, c.join(',')]));
      // Movepool: own moves plus everything its pre-evolutions can learn in this generation.
      const all = new Set(Object.keys(own));
      let prevo = s.prevo ? dex.species.get(s.prevo) : undefined;
      while (prevo?.exists) {
        for (const m of Object.keys(await formeSources(prevo))) all.add(m);
        prevo = prevo.prevo ? dex.species.get(prevo.prevo) : undefined;
      }
      learnsets[s.id] = [...all].sort();
    }

    let abilities: Record<string, string> = {};
    if (gen >= 3) {
      abilities = Object.fromEntries(Object.entries(s.abilities).filter(([slot, name]) => name && (gen >= 5 || slot !== 'H')));
    }
    species[s.id] = {
      id: s.id,
      num: s.num,
      name: s.name,
      baseSpecies: s.baseSpecies,
      forme: s.forme || undefined,
      gen: s.gen,
      types: s.types,
      baseStats: Object.fromEntries(STAT_IDS.map((k) => [k, s.baseStats[k]])),
      abilities,
      weightkg: s.weightkg,
      isMega: mega,
      battleOnly: mega ? toID(s.baseSpecies) : undefined,
      requiredItem: mega && s.requiredItem ? toID(s.requiredItem) : undefined,
      megaForms: [] as string[],
      legalIn: [regId],
      prevo: s.prevo && inGen.has(toID(s.prevo)) ? toID(s.prevo) : undefined,
      evos: s.evos?.map(toID).filter((e) => inGen.has(e)),
      evoLevel: s.evoLevel,
      evoType: s.evoType,
      evoItem: s.evoItem,
      evoMove: s.evoMove,
      evoCondition: s.evoCondition,
      heightm: (s as unknown as { heightm: number }).heightm,
      eggGroups: gen >= 2 ? s.eggGroups : undefined,
      genderRatio: gen >= 2 ? (s.gender ? s.gender : s.genderRatio) : undefined,
    };
  }
  for (const sp of Object.values(species) as { id: string; isMega: boolean; battleOnly?: string }[]) {
    if (sp.isMega && sp.battleOnly && species[sp.battleOnly]) (species[sp.battleOnly] as { megaForms: string[] }).megaForms.push(sp.id);
  }

  // ---------- Items (held items arrived in Gen 2) ----------
  const items: Record<string, unknown> = {};
  if (gen >= 2) {
    for (const it of dex.items.all().filter((i) => legal(i) && !i.isPokeball).sort((a, b) => a.name.localeCompare(b.name))) {
      items[it.id] = {
        id: it.id,
        name: it.name,
        shortDesc: it.shortDesc || it.desc,
        megaStone:
          gen >= 6 && it.megaStone
            ? Object.fromEntries(
                Object.entries(it.megaStone)
                  .map(([b, m]) => [toID(b), toID(m as string)])
                  .filter(([b, m]) => inGen.has(b as string) && inGen.has(m as string)),
              )
            : undefined,
        legalIn: [regId],
      };
    }
  }

  // ---------- Moves (as they were in this generation) ----------
  const moveIds = new Set<string>();
  Object.values(learnsets).forEach((ms) => ms.forEach((m) => moveIds.add(m)));
  const moves: Record<string, unknown> = {};
  for (const id of [...moveIds].sort()) {
    const m = dex.moves.get(id);
    const secondaries = m.secondaries ?? (m.secondary ? [m.secondary] : []);
    moves[id] = {
      id,
      name: m.name,
      type: m.type,
      category: m.category,
      basePower: m.basePower,
      accuracy: m.accuracy,
      pp: m.pp,
      priority: m.priority,
      target: m.target,
      shortDesc: m.shortDesc || m.desc,
      desc: m.desc && m.desc !== m.shortDesc ? m.desc : undefined,
      contact: !!m.flags.contact,
      flags: Object.fromEntries(
        (['slicing', 'punch', 'bite', 'pulse', 'sound', 'wind'] as const).filter((f) => (m.flags as Record<string, unknown>)[f]).map((f) => [f, true]),
      ),
      recoil: !!(m.recoil || m.hasCrashDamage || m.mindBlownRecoil) || undefined,
      secondary: !!(m.secondary || m.secondaries?.length) || undefined,
      multihit: m.multihit ?? undefined,
      boosts: m.boosts ?? undefined,
      self: m.self?.boosts ? { boosts: m.self.boosts } : undefined,
      status: m.status ?? undefined,
      volatileStatus: m.volatileStatus ?? undefined,
      secondaries: secondaries.length
        ? secondaries.map((s) => ({
            chance: s.chance ?? 100,
            status: s.status || undefined,
            volatileStatus: s.volatileStatus || undefined,
            boosts: s.boosts ?? undefined,
            self: s.self?.boosts ? { boosts: s.self.boosts } : undefined,
          }))
        : undefined,
      spread: SPREAD_TARGETS.has(m.target) || undefined,
      breaksProtect: m.breaksProtect || undefined,
      legalIn: [regId],
    };
  }

  // ---------- Abilities ----------
  const abilities: Record<string, unknown> = {};
  for (const sp of Object.values(species) as { abilities: Record<string, string> }[]) {
    for (const name of Object.values(sp.abilities)) {
      const a = dex.abilities.get(name);
      if (!abilities[a.id]) abilities[a.id] = { id: a.id, name: a.name, shortDesc: a.shortDesc || a.desc || '' };
    }
  }

  // ---------- Types, natures ----------
  const types = dex.types.all().filter((t) => legal(t) && t.name !== 'Stellar').map((t) => t.name);
  const typeChart: Record<string, Record<string, number>> = {};
  const codes: Record<number, number> = { 0: 1, 1: 2, 2: 0.5, 3: 0 };
  for (const t of dex.types.all().filter((x) => types.includes(x.name))) {
    typeChart[t.name] = Object.fromEntries(
      Object.entries(t.damageTaken)
        .filter(([k]) => types.includes(k as never))
        .map(([atk, code]) => [atk, codes[code as number]]),
    );
  }
  const TYPE_ORDER = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'];
  const natures = gen >= 3 ? dex.natures.all().map((n) => ({ name: n.name, plus: n.plus, minus: n.minus })) : [];

  // Learnsets are stored as indices into the (sorted) move list to keep the files small;
  // src/data/dex.ts expands them on load.
  const moveIndex = Object.keys(moves);
  const at = new Map(moveIndex.map((m, i) => [m, i]));
  const packedLearnsets = Object.fromEntries(Object.entries(learnsets).map(([s, ms]) => [s, ms.map((m) => at.get(m)!)]));
  const packedLearn = {
    moveIndex,
    learn: Object.fromEntries(
      Object.entries(learn).map(([s, ms]) => [s, Object.entries(ms).filter(([m]) => at.has(m)).map(([m, c]) => [at.get(m)!, c])]),
    ),
  };

  const dataset = {
    id: regId,
    generation: gen,
    generatedAt: new Date().toISOString(),
    source: `@pkmn/dex Gen ${gen} (Pokémon Showdown)`,
    regulations: [],
    species,
    moveIndex,
    learnsets: packedLearnsets,
    moves,
    abilities,
    items,
    natures,
    types: TYPE_ORDER.filter((t) => types.includes(t as never)),
    typeChart,
  };
  return { dataset, learn: packedLearn };
}
