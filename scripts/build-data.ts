/**
 * Build-time data pipeline.
 *
 * Reads Pokémon Showdown data (via @pkmn/dex + @pkmn/mods) plus the regulation files in
 * src/data/regulations/*.json and emits:
 *   src/data/generated/champions.json    full dataset (lazy-loaded by the app)
 *   src/data/generated/regulations.json  tiny manifest (bundled; drives the format list + banners)
 *   src/data/generated/gen<N>.json       Gen 1–9 datasets, as each generation's games had them (build-gens.ts)
 *   src/data/generated/{lgpe,bdsp,pla,za}.json  Let's Go, BDSP, Legends: Arceus, Legends: Z-A (build-games.ts)
 *
 *   npm run data
 *
 * A regulation file either points at a Showdown mod ({"base": {"showdownMod": "champions"}}) or
 * extends another regulation with deltas ({"base": {"extends": "champions-reg-mb"}, addSpecies,
 * addItems, addMoves, speciesPatches, newAbilities, …}). The delta form lets the weekly updater add
 * a regulation from official announcements before Showdown ships it.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Dex, type ModData } from '@pkmn/dex';
import * as ChampionsMod from '@pkmn/mods/champions';
import * as RegMAMod from '@pkmn/mods/championsregma';
import { buildGames } from './build-games.js';
import { buildGenerations } from './build-gens.js';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/data/generated');
const REG_DIR = resolve(here, '../src/data/regulations');

type AnyDex = ReturnType<typeof Dex.mod>;
const STAT_IDS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
const STRICT = process.argv.includes('--strict');
const toID = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const MODS: Record<string, AnyDex> = {
  champions: Dex.mod('champions' as never, ChampionsMod as unknown as ModData),
  championsregma: Dex.mod('championsregma' as never, {
    ...(ChampionsMod as unknown as ModData),
    ...(RegMAMod as unknown as ModData),
  } as ModData),
};
/** Superset data source: every species/move/item the Champions mod knows about, legal or not. */
const base = MODS.champions;
const gen9 = Dex.forGen(9);

interface RegulationFile {
  id: string;
  name: string;
  shortName: string;
  game: string;
  start: string;
  end?: string;
  base: { showdownMod: string } | { extends: string };
  addSpecies?: string[];
  removeSpecies?: string[];
  addItems?: string[];
  removeItems?: string[];
  addMoves?: string[];
  removeMoves?: string[];
  newAbilities?: { id: string; name: string; shortDesc: string }[];
  speciesPatches?: Record<string, { abilities?: Record<string, string>; types?: string[]; baseStats?: Record<string, number> }>;
  /** Pokémon Showdown doesn't know these yet — full definitions from official announcements. */
  newSpecies?: CustomSpecies[];
  newItems?: CustomItem[];
  unconfirmed?: { species?: string[]; note?: string };
  sources?: string[];
  updatedAt?: string;
}

interface CustomSpecies {
  id: string;
  name: string;
  num: number;
  baseSpecies: string;
  forme?: string;
  gen: number;
  types: string[];
  baseStats: Record<string, number>;
  abilities: Record<string, string>;
  weightkg?: number;
  /** Megas: the stone that triggers it. */
  requiredItem?: string;
  /** Learnset donor (defaults to the base species). */
  learnsetFrom?: string;
}

interface CustomItem {
  id: string;
  name: string;
  shortDesc: string;
  /** base species id → mega species id */
  megaStone?: Record<string, string>;
}

const customSpecies = new Map<string, CustomSpecies>();
const customItems = new Map<string, CustomItem>();

interface Resolved {
  meta: RegulationFile;
  species: Set<string>;
  items: Set<string>;
  moves: Set<string>;
}

const isLegal = (x: { exists: boolean; isNonstandard?: string | null; tier?: string }) =>
  x.exists && !x.isNonstandard && x.tier !== 'Illegal';

function loadRegulations(): RegulationFile[] {
  const files = readdirSync(REG_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'schedule.json')
    .map((f) => JSON.parse(readFileSync(resolve(REG_DIR, f), 'utf8')) as RegulationFile)
    .sort((a, b) => a.start.localeCompare(b.start));
  for (const f of files) {
    for (const sp of f.newSpecies ?? []) customSpecies.set(toID(sp.id), { ...sp, id: toID(sp.id) });
    for (const it of f.newItems ?? []) customItems.set(toID(it.id), { ...it, id: toID(it.id) });
  }
  return files;
}

function resolveRegulations(files: RegulationFile[]): Resolved[] {
  const byId = new Map<string, Resolved>();
  const resolveOne = (f: RegulationFile, stack: string[] = []): Resolved => {
    if (byId.has(f.id)) return byId.get(f.id)!;
    if (stack.includes(f.id)) throw new Error(`Regulation cycle: ${[...stack, f.id].join(' → ')}`);
    let r: Resolved;
    if ('showdownMod' in f.base) {
      const dex = MODS[f.base.showdownMod];
      if (!dex) throw new Error(`${f.id}: unknown Showdown mod "${f.base.showdownMod}"`);
      r = {
        meta: f,
        species: new Set(dex.species.all().filter(isLegal).map((s) => s.id)),
        items: new Set(dex.items.all().filter(isLegal).map((i) => i.id)),
        moves: new Set(dex.moves.all().filter((m) => m.exists && !m.isNonstandard).map((m) => m.id)),
      };
    } else {
      const parentId = f.base.extends;
      const parent = files.find((x) => x.id === parentId);
      if (!parent) throw new Error(`${f.id}: extends unknown regulation "${parentId}"`);
      const p = resolveOne(parent, [...stack, f.id]);
      r = { meta: f, species: new Set(p.species), items: new Set(p.items), moves: new Set(p.moves) };
    }
    const apply = (set: Set<string>, add: string[] = [], remove: string[] = [], kind: string, exists: (id: string) => boolean) => {
      for (const id of add.map(toID)) {
        if (!exists(id)) {
          const msg = `${f.id}: ${kind} "${id}" not found in Showdown data`;
          if (STRICT) throw new Error(msg);
          console.warn(`  ! ${msg} — skipped`);
        }
        else set.add(id);
      }
      for (const id of remove.map(toID)) set.delete(id);
    };
    apply(r.species, f.addSpecies, f.removeSpecies, 'species', (id) => base.species.get(id).exists || customSpecies.has(id));
    apply(r.items, f.addItems, f.removeItems, 'item', (id) => base.items.get(id).exists || customItems.has(id));
    apply(r.moves, f.addMoves, f.removeMoves, 'move', (id) => base.moves.get(id).exists);
    byId.set(f.id, r);
    return r;
  };
  return files.map((f) => resolveOne(f));
}

/**
 * A species' own Showdown learnset plus what it inherits from its pre-evolutions: egg moves live on the base
 * form (Rillaboom's Fake Out is Grookey's) and level-up moves a pre-evolution learned stay with the evolution.
 * TMs/tutors don't carry over, and only Generation 9 sources count (older ones are moves Champions dropped).
 */
async function withPrevoMoves(dex: AnyDex, s: ReturnType<AnyDex['species']['get']>, own: string[]): Promise<string[]> {
  if (!own.length) return own;
  const moves = [...own];
  const have = new Set(moves);
  for (let prevo = s.prevo ? dex.species.get(s.prevo) : undefined; prevo?.exists; prevo = prevo.prevo ? dex.species.get(prevo.prevo) : undefined) {
    const ls = (await dex.learnsets.get(prevo.id))?.learnset;
    for (const [m, sources] of Object.entries(ls ?? {})) {
      if (!have.has(m) && sources.some((c) => /^9[LE]/.test(c))) {
        have.add(m);
        moves.push(m);
      }
    }
  }
  return moves;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files = loadRegulations();
  const regs = resolveRegulations(files);
  console.log(`regulations: ${regs.map((r) => `${r.meta.id} (${r.species.size} species)`).join(', ')}`);

  const patches: NonNullable<RegulationFile['speciesPatches']> = {};
  const extraAbilities = new Map<string, { id: string; name: string; shortDesc: string }>();
  for (const r of regs) {
    Object.assign(patches, r.meta.speciesPatches ?? {});
    for (const a of r.meta.newAbilities ?? []) extraAbilities.set(a.id, a);
  }
  const abilityId = (name: string) => {
    const id = toID(name);
    return extraAbilities.has(id) ? id : base.abilities.get(name).id || id;
  };

  const legalMoveAnywhere = new Set<string>();
  regs.forEach((r) => r.moves.forEach((m) => legalMoveAnywhere.add(m)));

  // ---------- Species ----------
  const speciesIds = new Set<string>();
  regs.forEach((r) => r.species.forEach((s) => speciesIds.add(s)));

  const species: Record<string, Record<string, unknown>> = {};
  const learnsets: Record<string, string[]> = {};
  const provisional: string[] = [];

  for (const id of [...speciesIds].sort()) {
    const custom = customSpecies.get(id);
    if (custom && !base.species.get(id).exists) {
      const isMega = /^Mega/.test(custom.forme ?? '');
      const donor = toID(custom.learnsetFrom ?? custom.baseSpecies);
      if (!isMega) {
        const ls = (await base.learnsets.get(donor))?.learnset ?? (await gen9.learnsets.get(donor))?.learnset ?? {};
        learnsets[id] = Object.keys(ls).filter((m) => legalMoveAnywhere.has(m)).sort();
        provisional.push(id);
      }
      species[id] = {
        ...custom,
        weightkg: custom.weightkg ?? 0,
        isMega,
        battleOnly: isMega ? toID(custom.baseSpecies) : undefined,
        requiredItem: custom.requiredItem ? toID(custom.requiredItem) : undefined,
        megaForms: [] as string[],
        legalIn: regs.filter((r) => r.species.has(id)).map((r) => r.meta.id),
        provisionalLearnset: !isMega || undefined,
      };
      continue;
    }
    const s = base.species.get(id);
    const isMega = s.forme.startsWith('Mega');
    const patch = patches[id] ?? {};

    if (!isMega) {
      // Learnset: Champions learnset, falling back to the out-of-battle forme, then to the
      // Scarlet/Violet learnset (flagged provisional) for Pokémon Showdown hasn't covered yet.
      const chain = [s.id, s.changesFrom && toID(s.changesFrom), toID(s.baseSpecies)].filter(Boolean) as string[];
      let moves: string[] = [];
      for (const src of chain) {
        const ls = await base.learnsets.get(src);
        if (ls?.learnset) {
          moves = Object.keys(ls.learnset);
          break;
        }
      }
      moves = await withPrevoMoves(base, s, moves);
      if (!moves.length) {
        for (const src of chain) {
          const ls = await gen9.learnsets.get(src);
          if (ls?.learnset) {
            moves = await withPrevoMoves(gen9, s, Object.keys(ls.learnset));
            provisional.push(id);
            break;
          }
        }
      }
      learnsets[id] = moves.filter((m) => legalMoveAnywhere.has(m)).sort();
    }

    const abilities = patch.abilities ?? s.abilities;
    species[id] = {
      id,
      num: s.num,
      name: s.name,
      baseSpecies: s.baseSpecies,
      forme: s.forme || undefined,
      gen: s.gen,
      types: patch.types ?? s.types,
      baseStats: patch.baseStats ?? Object.fromEntries(STAT_IDS.map((k) => [k, s.baseStats[k]])),
      abilities,
      weightkg: s.weightkg,
      isMega,
      battleOnly: typeof s.battleOnly === 'string' ? toID(s.battleOnly) : isMega ? toID(s.baseSpecies) : undefined,
      requiredItem: s.requiredItem ? toID(s.requiredItem) : undefined,
      megaForms: [] as string[],
      legalIn: regs.filter((r) => r.species.has(id)).map((r) => r.meta.id),
      provisionalLearnset: provisional.includes(id) || undefined,
    };
  }
  for (const sp of Object.values(species)) {
    const bo = sp.battleOnly as string | undefined;
    if (sp.isMega && bo && species[bo]) (species[bo].megaForms as string[]).push(sp.id as string);
  }

  // ---------- Items ----------
  const items: Record<string, unknown> = {};
  const itemIds = new Set<string>();
  regs.forEach((r) => r.items.forEach((i) => itemIds.add(i)));
  for (const id of [...itemIds].sort()) {
    const custom = customItems.get(id);
    if (custom && !base.items.get(id).exists) {
      items[id] = { ...custom, legalIn: regs.filter((r) => r.items.has(id)).map((r) => r.meta.id) };
      continue;
    }
    const it = base.items.get(id);
    items[id] = {
      id,
      name: it.name,
      shortDesc: it.shortDesc || it.desc,
      megaStone: it.megaStone
        ? Object.fromEntries(Object.entries(it.megaStone).map(([b, m]) => [toID(b), toID(m as string)]))
        : undefined,
      legalIn: regs.filter((r) => r.items.has(id)).map((r) => r.meta.id),
    };
  }

  // ---------- Moves ----------
  const SPREAD_TARGETS = new Set(['allAdjacent', 'allAdjacentFoes', 'all', 'foeSide', 'allySide']);
  const moveIds = new Set<string>();
  Object.values(learnsets).forEach((ms) => ms.forEach((m) => moveIds.add(m)));
  const moves: Record<string, unknown> = {};
  for (const id of [...moveIds].sort()) {
    const m = base.moves.get(id);
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
      legalIn: regs.filter((r) => r.moves.has(id)).map((r) => r.meta.id),
    };
  }

  // ---------- Abilities ----------
  const abilities: Record<string, unknown> = {};
  for (const sp of Object.values(species)) {
    for (const name of Object.values(sp.abilities as Record<string, string>)) {
      const id = abilityId(name);
      if (abilities[id]) continue;
      const extra = extraAbilities.get(id);
      const a = base.abilities.get(name);
      abilities[id] = extra ?? { id, name: a.name || name, shortDesc: a.shortDesc || a.desc || '' };
    }
  }

  // ---------- Types & natures ----------
  const typeChart: Record<string, Record<string, number>> = {};
  const codes: Record<number, number> = { 0: 1, 1: 2, 2: 0.5, 3: 0 }; // Showdown damageTaken codes
  for (const t of base.types.all()) {
    if (t.name === 'Stellar') continue;
    typeChart[t.name] = Object.fromEntries(
      Object.entries(t.damageTaken)
        .filter(([k]) => /^[A-Z]/.test(k) && k !== 'Stellar')
        .map(([atk, code]) => [atk, codes[code as number]]),
    );
  }
  const natures = base.natures.all().map((n) => ({ name: n.name, plus: n.plus, minus: n.minus }));

  const regulations = regs.map(({ meta, species: sp, items: it }) => ({
    id: meta.id,
    name: meta.name,
    shortName: meta.shortName,
    game: meta.game,
    start: meta.start,
    end: meta.end,
    speciesCount: [...sp].filter((id) => !species[id]?.isMega).length,
    megaCount: [...sp].filter((id) => species[id]?.isMega).length,
    itemCount: it.size,
    sources: meta.sources ?? [],
    updatedAt: meta.updatedAt,
  }));

  const generatedAt = new Date().toISOString();
  const dataset = {
    id: 'champions',
    generatedAt,
    source: '@pkmn/dex + @pkmn/mods (Pokémon Showdown) + src/data/regulations',
    regulations,
    species,
    learnsets,
    moves,
    abilities,
    items,
    natures,
    typeChart,
  };
  writeFileSync(resolve(OUT, 'champions.json'), JSON.stringify(dataset));

  const schedule = JSON.parse(readFileSync(resolve(REG_DIR, 'schedule.json'), 'utf8'));
  writeFileSync(
    resolve(OUT, 'regulations.json'),
    JSON.stringify({ generatedAt, regulations, upcoming: schedule.upcoming ?? [], lastChecked: schedule.lastChecked }, null, 2),
  );

  // What each regulation's species patches change, with the value before (Showdown's, or an earlier
  // patch's) so the app can show "before → after" in the regulation diff.
  type Snap = { types: string[]; abilities: Record<string, string>; baseStats: Record<string, number> };
  const running = new Map<string, Snap>();
  const changes: Record<string, { unconfirmed?: { species?: string[]; note?: string }; patches: Record<string, { name: string; types?: { before: string[]; after: string[] }; abilities?: Record<string, { before?: string; after?: string }>; baseStats?: Record<string, { before: number; after: number }> }> }> = {};
  for (const r of [...regs].sort((a, b) => a.meta.start.localeCompare(b.meta.start))) {
    const out: (typeof changes)[string]['patches'] = {};
    for (const [id, p] of Object.entries(r.meta.speciesPatches ?? {})) {
      const s = base.species.get(id);
      const custom = customSpecies.get(id);
      const before: Snap | undefined =
        running.get(id) ??
        (s.exists
          ? { types: [...s.types], abilities: { ...s.abilities } as Record<string, string>, baseStats: Object.fromEntries(STAT_IDS.map((k) => [k, s.baseStats[k]])) }
          : custom
            ? { types: [...(custom.types ?? [])], abilities: { ...(custom.abilities ?? {}) } as Record<string, string>, baseStats: { ...(custom.baseStats ?? {}) } as Record<string, number> }
            : undefined);
      const entry: (typeof out)[string] = { name: s.exists ? s.name : (custom?.name ?? id) };
      const after: Snap = { types: p.types ?? before?.types ?? [], abilities: p.abilities ?? before?.abilities ?? {}, baseStats: { ...(before?.baseStats ?? {}), ...(p.baseStats ?? {}) } };
      if (p.types && JSON.stringify(p.types) !== JSON.stringify(before?.types)) entry.types = { before: before?.types ?? [], after: p.types };
      if (p.abilities) {
        const ab: NonNullable<typeof entry.abilities> = {};
        for (const slot of new Set([...Object.keys(before?.abilities ?? {}), ...Object.keys(p.abilities)])) {
          const b = before?.abilities?.[slot];
          const a = p.abilities[slot];
          if (b !== a) ab[slot] = { before: b, after: a };
        }
        if (Object.keys(ab).length) entry.abilities = ab;
      }
      if (p.baseStats) {
        const bs: NonNullable<typeof entry.baseStats> = {};
        for (const [k, v] of Object.entries(p.baseStats)) if (before?.baseStats?.[k] !== v) bs[k] = { before: before?.baseStats?.[k] ?? 0, after: v };
        if (Object.keys(bs).length) entry.baseStats = bs;
      }
      running.set(id, after);
      if (entry.types || entry.abilities || entry.baseStats) out[id] = entry;
    }
    changes[r.meta.id] = { patches: out, ...(r.meta.unconfirmed ? { unconfirmed: r.meta.unconfirmed } : {}) };
  }
  writeFileSync(resolve(OUT, 'regulation-changes.json'), JSON.stringify({ version: 1, regulations: changes }, null, 2));

  console.log(
    `wrote champions.json: ${Object.keys(species).length} species, ${Object.keys(moves).length} moves, ` +
      `${Object.keys(items).length} items, ${Object.keys(abilities).length} abilities` +
      (provisional.length ? ` · provisional learnsets: ${provisional.join(', ')}` : ''),
  );

  await buildGenerations(OUT);
  await buildGames(OUT);
}

main();
