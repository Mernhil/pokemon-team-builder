/**
 * What every meta source needs: the Champions regulations and dataset (species names, legality,
 * base stats), Showdown's format ids for a regulation, and the on-disk cache (.cache/meta/, kept
 * between runs by the GitHub Action so replays and tournaments aren't fetched twice).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Legality } from '../../src/domain/metaSources.ts';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = resolve(ROOT, '.cache/meta');

export interface Regulation {
  id: string;
  game: string;
  shortName: string;
  start: string;
  end?: string;
}

interface DatasetSpecies {
  id: string;
  name: string;
  baseSpecies: string;
  isMega: boolean;
  battleOnly?: string;
  legalIn?: string[];
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
}
interface Dataset {
  species: Record<string, DatasetSpecies>;
  items: Record<string, { id: string; legalIn?: string[]; megaStone?: Record<string, string> }>;
  moves: Record<string, { id: string; legalIn?: string[] }>;
}

const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

export class Context {
  readonly regulations: Regulation[];
  private readonly dataset: Dataset;
  /** Species names a source used that the Champions dataset doesn't know (dropped, reported at the end). */
  readonly unknown = new Set<string>();

  constructor() {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'src/data/generated/regulations.json'), 'utf8')) as { regulations: Regulation[] };
    this.regulations = manifest.regulations.filter((r) => r.game === 'champions').sort((a, b) => a.start.localeCompare(b.start));
    this.dataset = JSON.parse(readFileSync(resolve(ROOT, 'src/data/generated/champions.json'), 'utf8')) as Dataset;
  }

  /** Showdown species name → this app's Champions species id (Megas count as their base forme). */
  speciesId(name: string): string | undefined {
    const id = this.lookupSpecies(name);
    if (!id && name.trim()) this.unknown.add(name);
    return id;
  }

  /** Same as speciesId, without reporting unknown names (for sources that mix in other games' formats). */
  lookupSpecies(name: string): string | undefined {
    const sp = this.dataset.species[toID(name)];
    return sp && (sp.isMega && sp.battleOnly ? sp.battleOnly : sp.id);
  }

  baseStats(id: string) {
    return this.dataset.species[id]?.baseStats;
  }

  isMegaStone(itemId: string | undefined): boolean {
    return !!itemId && !!this.dataset.items[itemId]?.megaStone;
  }

  legality(regulationId: string): Legality {
    const ok = (x: { legalIn?: string[] } | undefined) => !!x?.legalIn?.includes(regulationId);
    return {
      species: (id) => ok(this.dataset.species[id]),
      item: (id) => ok(this.dataset.items[id]),
      move: (id) => ok(this.dataset.moves[id]),
    };
  }

  /** Showdown format ids for a Champions regulation id (champions-reg-mc → …vgc2026regmc, then …bo3). */
  formatIds(reg: Regulation): string[] {
    const letters = reg.id.replace(/^champions-reg-/, '');
    const year = '2026'; // TODO: take the season from the regulation once a Champions regulation spans another VGC year.
    const base = `gen9championsvgc${year}reg${letters}`;
    return [base, `${base}bo3`];
  }

  readCache<T>(name: string, fallback: T): T {
    const file = resolve(CACHE, name);
    try {
      return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  writeCache(name: string, value: unknown) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(resolve(CACHE, name), JSON.stringify(value));
  }
}
