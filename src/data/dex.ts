import type {
  Ability,
  Dataset,
  Item,
  Move,
  Nature,
  Pokemon,
  TypeName,
} from '@/domain/types';
import { STAT_IDS, TYPE_NAMES } from '@/domain/types';

/** Showdown-style id: lowercase alphanumerics only. */
export const toID = (s: unknown): string =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/**
 * Read-only query layer over a Dataset. One instance per loaded dataset; regulation-aware
 * helpers take the regulation id explicitly so the same Dex serves every regulation.
 */
export class Dex {
  readonly data: Dataset;
  private readonly speciesList: Pokemon[];
  private readonly movesByLearner = new Map<string, Set<string>>();

  constructor(data: Dataset) {
    this.data = data;
    this.speciesList = Object.values(data.species).sort((a, b) => a.num - b.num || a.name.localeCompare(b.name));
    for (const [sid, moves] of Object.entries(data.learnsets)) this.movesByLearner.set(sid, new Set(moves));
  }

  // ---- lookups ---------------------------------------------------------------------------
  species(id: string | undefined): Pokemon | undefined {
    return id ? this.data.species[toID(id)] : undefined;
  }
  move(id: string | undefined): Move | undefined {
    return id ? this.data.moves[toID(id)] : undefined;
  }
  ability(id: string | undefined): Ability | undefined {
    return id ? this.data.abilities[toID(id)] : undefined;
  }
  item(id: string | undefined): Item | undefined {
    return id ? this.data.items[toID(id)] : undefined;
  }
  nature(name: string | undefined): Nature | undefined {
    const id = toID(name);
    return this.data.natures.find((n) => toID(n.name) === id);
  }
  get natures(): Nature[] {
    return this.data.natures;
  }
  /** Generation the dataset describes (Champions counts as 9). */
  get generation(): number {
    return this.data.generation ?? 9;
  }
  /** Types that exist in this dataset's generation. */
  get types(): readonly TypeName[] {
    return this.data.types ?? TYPE_NAMES;
  }

  // ---- lists -----------------------------------------------------------------------------
  /** Out-of-battle species legal in a regulation (Megas are reached through their stone). */
  selectableSpecies(regulationId?: string): Pokemon[] {
    return this.speciesList.filter((s) => !s.isMega && (!regulationId || s.legalIn.includes(regulationId)));
  }
  allSpecies(): Pokemon[] {
    return this.speciesList;
  }
  /** Held items legal in a regulation, minus Mega Stones for Pokémon that aren't in this game. */
  items(regulationId?: string): Item[] {
    return Object.values(this.data.items)
      .filter((i) => !regulationId || i.legalIn.includes(regulationId))
      .filter((i) => this.stoneHolderExists(i))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Moves a species can learn, optionally limited to one regulation (Megas use their base forme). */
  learnset(speciesId: string, regulationId?: string): Move[] {
    const sp = this.species(speciesId);
    if (!sp) return [];
    const src = sp.isMega && sp.battleOnly ? sp.battleOnly : sp.id;
    return (this.data.learnsets[src] ?? [])
      .map((m) => this.data.moves[m])
      .filter((m) => m && (!regulationId || m.legalIn.includes(regulationId)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  canLearn(speciesId: string, moveId: string): boolean {
    const sp = this.species(speciesId);
    if (!sp) return false;
    const src = sp.isMega && sp.battleOnly ? sp.battleOnly : sp.id;
    return this.movesByLearner.get(src)?.has(toID(moveId)) ?? false;
  }
  abilitiesOf(speciesId: string): { slot: string; ability: Ability }[] {
    const sp = this.species(speciesId);
    if (!sp) return [];
    // Slot 1, slot 2, Hidden, then Special (event-only) — never the data's key order.
    const rank = (slot: string) => ['0', '1', 'H', 'S'].indexOf(slot);
    return Object.entries(sp.abilities)
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([slot, name]) => ({ slot, ability: this.ability(name)! }))
      .filter((x) => x.ability);
  }

  // ---- mega ------------------------------------------------------------------------------
  /**
   * Whether a Mega Stone's Pokémon is in this game (always true for other items). The generated
   * data keeps a stone's species → Mega map only for Megas the game has, so Let's Go lists all 47
   * Gen 7 stones but 32 with an empty map (no Garchomp in Kanto). An empty map can also mean the
   * data doesn't define that Mega yet (Legends: Z-A's Meowsticite), so then the holder named by
   * Showdown's description ("If held by a Meowstic, …") decides.
   * TODO: have scripts/build-gens.ts emit Showdown's `itemUser` so this needn't read the text.
   */
  private stoneHolderExists(item: Item): boolean {
    if (!item.megaStone) return true;
    const megas = Object.values(item.megaStone);
    if (megas.length) return megas.some((m) => !!this.data.species[m]);
    const holder = item.shortDesc.match(/^If held by (?:an? )?([^,]+?)(?: in [^,]+)?,/)?.[1];
    return holder === undefined || !!this.data.species[toID(holder)];
  }
  /** Mega forme unlocked by this species holding this item, if any. */
  megaFor(speciesId: string, itemId?: string): Pokemon | undefined {
    const item = this.item(itemId);
    const megaId = item?.megaStone?.[toID(speciesId)];
    return megaId ? this.species(megaId) : undefined;
  }

  /**
   * A battle-only forme with different base stats that this species switches into in battle
   * (Aegislash-Blade via Stance Change, Palafin-Hero), if any. Formes with the same stats (Mimikyu-Busted, Morpeko-Hangry) don't count.
   * Megas are `megaFor`; Castform's formes change typing, not stats, so they don't count.
   */
  statForm(speciesId: string): Pokemon | undefined {
    const base = this.species(speciesId);
    if (!base) return undefined;
    return this.speciesList.find(
      (s) => !s.isMega && s.battleOnly === base.id && STAT_IDS.some((k) => s.baseStats[k] !== base.baseStats[k]),
    );
  }

  // ---- types -----------------------------------------------------------------------------
  /** Damage multiplier of an attacking type against a (dual-)typed defender. */
  effectiveness(attack: TypeName | '???', defender: TypeName[]): number {
    if (attack === '???') return 1;
    return defender.reduce((m, t) => m * (this.data.typeChart[t]?.[attack] ?? 1), 1);
  }

  // ---- search ----------------------------------------------------------------------------
  /**
   * Instant search across species by name, type, ability or learnable move.
   * Name prefix matches rank first, then substring, then attribute matches.
   */
  searchSpecies(query: string, regulationId?: string, limit = 50): Pokemon[] {
    const q = toID(query);
    const pool = this.selectableSpecies(regulationId);
    if (!q) return pool.slice(0, limit);
    const scored: [number, Pokemon][] = [];
    for (const s of pool) {
      const id = s.id;
      let score = -1;
      if (id.startsWith(q)) score = 0;
      else if (id.includes(q)) score = 1;
      else if (s.types.some((t) => toID(t) === q)) score = 2;
      else if (Object.values(s.abilities).some((a) => toID(a).startsWith(q))) score = 3;
      else if (q.length >= 4 && this.movesByLearner.get(id)?.has(q)) score = 4;
      if (score >= 0) scored.push([score, s]);
    }
    return scored
      .sort((a, b) => a[0] - b[0] || a[1].num - b[1].num)
      .slice(0, limit)
      .map(([, s]) => s);
  }
}

// ---------------------------------------------------------------------------
// Dataset loading (lazy, code-split, cached)
// ---------------------------------------------------------------------------

/** Gen datasets store learnsets as indices into `moveIndex` (see scripts/build-gens.ts). */
type PackedDataset = Omit<Dataset, 'learnsets'> & { moveIndex?: string[]; learnsets: Record<string, (string | number)[]> };
/** Expand a dataset as stored in src/data/generated (Gen datasets pack learnsets as indices). */
export function unpackDataset(raw: unknown): Dataset {
  const d = raw as PackedDataset;
  if (!d.moveIndex) return d as Dataset;
  const idx = d.moveIndex;
  const learnsets = Object.fromEntries(Object.entries(d.learnsets).map(([s, ms]) => [s, ms.map((i) => idx[i as number])]));
  return { ...d, learnsets } as Dataset;
}
const unpack = (m: { default: unknown }) => unpackDataset(m.default);

const loaders: Record<string, () => Promise<Dataset>> = {
  champions: () => import('./generated/champions.json').then(unpack),
  gen1: () => import('./generated/gen1.json').then(unpack),
  gen2: () => import('./generated/gen2.json').then(unpack),
  gen3: () => import('./generated/gen3.json').then(unpack),
  gen4: () => import('./generated/gen4.json').then(unpack),
  gen5: () => import('./generated/gen5.json').then(unpack),
  gen6: () => import('./generated/gen6.json').then(unpack),
  gen7: () => import('./generated/gen7.json').then(unpack),
  gen8: () => import('./generated/gen8.json').then(unpack),
  gen9: () => import('./generated/gen9.json').then(unpack),
  lgpe: () => import('./generated/lgpe.json').then(unpack),
  bdsp: () => import('./generated/bdsp.json').then(unpack),
  pla: () => import('./generated/pla.json').then(unpack),
  za: () => import('./generated/za.json').then(unpack),
};

const cache = new Map<string, Promise<Dex>>();

export function loadDex(datasetId: string): Promise<Dex> {
  let p = cache.get(datasetId);
  if (!p) {
    const loader = loaders[datasetId];
    if (!loader) return Promise.reject(new Error(`No dataset "${datasetId}"`));
    p = loader().then((d) => new Dex(d));
    // A failed load (offline, stale chunk after a deploy) must be retried next time, not cached.
    p.catch(() => cache.delete(datasetId));
    cache.set(datasetId, p);
  }
  return p;
}

export const hasDataset = (datasetId: string) => datasetId in loaders;
