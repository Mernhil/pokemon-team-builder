/**
 * Popular teams / stat spreads: usage data from a static JSON snapshot checked into
 * src/data/meta/<regulationId>.json, one file per regulation/season, updated by hand when new
 * usage data is available. This is baked into the build like the rest of the game data — no
 * runtime fetch to any third-party API, so there's nothing to fail at runtime; a missing or
 * malformed snapshot just means that regulation has no data yet.
 */

const metaFiles = import.meta.glob<{ default: unknown }>('../data/meta/*.json', { eager: true });

export interface MetaMoveUsage {
  moveId: string;
  pct: number;
}
export interface MetaItemUsage {
  itemId: string;
  pct: number;
}
export interface MetaSpreadUsage {
  /** Nature name, if reported. */
  nature?: string;
  /** Stat Points, when the snapshot breaks a spread out per stat. */
  sp?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  pct: number;
}

export interface MetaEntry {
  speciesId: string;
  /** % of teams running this species, 0–100. */
  usagePct: number;
  items: MetaItemUsage[];
  moves: MetaMoveUsage[];
  spreads: MetaSpreadUsage[];
  /** Other species most often teamed with this one (a "core"), if the snapshot reports it. */
  teammates?: { speciesId: string; pct: number }[];
}

export interface MetaSnapshot {
  regulationId: string;
  /** Date (or free-form text) the checked-in snapshot was last refreshed, from the JSON itself. */
  lastUpdated: string;
  /** Where this snapshot came from, shown alongside `lastUpdated` in the UI. */
  source: string;
  entries: MetaEntry[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pct = (v: unknown): number => Math.max(0, Math.min(100, num(v) ?? 0));
const idOf = (v: unknown): string | undefined => (typeof v === 'string' && v ? v.toLowerCase().replace(/[^a-z0-9]+/g, '') : undefined);

/** Tolerates the handful of reasonable shapes a hand-written usage entry might use. */
function parseEntry(raw: unknown): MetaEntry | null {
  if (!isObj(raw)) return null;
  const speciesId = idOf(raw.speciesId ?? raw.species ?? raw.pokemon ?? raw.name);
  if (!speciesId) return null;
  const usagePct = pct(raw.usagePct ?? raw.usage_pct ?? raw.usage ?? raw.pct);
  const items: MetaItemUsage[] = Array.isArray(raw.items)
    ? raw.items
        .map((it): MetaItemUsage | null => {
          if (typeof it === 'string') return { itemId: idOf(it) ?? '', pct: 0 };
          if (!isObj(it)) return null;
          const itemId = idOf(it.itemId ?? it.item ?? it.name);
          return itemId ? { itemId, pct: pct(it.pct ?? it.usage ?? it.usage_pct) } : null;
        })
        .filter((x): x is MetaItemUsage => !!x)
    : [];
  const moves: MetaMoveUsage[] = Array.isArray(raw.moves)
    ? raw.moves
        .map((mv): MetaMoveUsage | null => {
          if (typeof mv === 'string') return { moveId: idOf(mv) ?? '', pct: 0 };
          if (!isObj(mv)) return null;
          const moveId = idOf(mv.moveId ?? mv.move ?? mv.name);
          return moveId ? { moveId, pct: pct(mv.pct ?? mv.usage ?? mv.usage_pct) } : null;
        })
        .filter((x): x is MetaMoveUsage => !!x)
    : [];
  const spreadsRaw = raw.spreads ?? raw.commonSpreads ?? raw.common_spreads;
  const spreads: MetaSpreadUsage[] = Array.isArray(spreadsRaw)
    ? spreadsRaw
        .map((sp): MetaSpreadUsage | null => {
          if (!isObj(sp)) return null;
          const statsSrc = isObj(sp.sp) ? sp.sp : isObj(sp.stats) ? sp.stats : sp;
          const sTable: MetaSpreadUsage['sp'] = {};
          for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const) {
            const v = num((statsSrc as Record<string, unknown>)[k]);
            if (v !== undefined) sTable[k] = v;
          }
          return {
            nature: typeof sp.nature === 'string' ? sp.nature : undefined,
            sp: Object.keys(sTable).length ? sTable : undefined,
            pct: pct(sp.pct ?? sp.usage ?? sp.usage_pct),
          };
        })
        .filter((x): x is MetaSpreadUsage => !!x)
    : [];
  const teammatesRaw = raw.teammates ?? raw.commonCores ?? raw.common_cores;
  const teammates = Array.isArray(teammatesRaw)
    ? teammatesRaw
        .map((t) => {
          if (!isObj(t)) return null;
          const id = idOf(t.speciesId ?? t.species ?? t.pokemon ?? t.name);
          return id ? { speciesId: id, pct: pct(t.pct ?? t.usage ?? t.usage_pct) } : null;
        })
        .filter((x): x is { speciesId: string; pct: number } => !!x)
    : undefined;
  return { speciesId, usagePct, items, moves, spreads, teammates };
}

export class MetaDataError extends Error {}

function fileForRegulation(regulationId: string): unknown {
  const match = Object.entries(metaFiles).find(([path]) => path.endsWith(`/${regulationId}.json`));
  return match?.[1]?.default;
}

/** Load and normalise the checked-in usage snapshot for a regulation. Throws MetaDataError if none exists or it doesn't parse. */
export function loadMetaSnapshot(regulationId: string): MetaSnapshot {
  const raw = fileForRegulation(regulationId);
  if (raw === undefined) throw new MetaDataError(`No usage data checked in yet for this regulation.`);
  if (!isObj(raw)) throw new MetaDataError(`Usage data for this regulation is malformed.`);
  const lastUpdated = typeof raw.lastUpdated === 'string' && raw.lastUpdated ? raw.lastUpdated : undefined;
  if (!lastUpdated) throw new MetaDataError(`Usage data for this regulation is missing "lastUpdated".`);
  const list = Array.isArray(raw.entries) ? raw.entries : null;
  if (!list) throw new MetaDataError(`Usage data for this regulation has no "entries" array.`);
  const entries = list.map(parseEntry).filter((e): e is MetaEntry => !!e).sort((a, b) => b.usagePct - a.usagePct);
  if (!entries.length) throw new MetaDataError(`Usage data for this regulation has no valid entries.`);
  return { regulationId, lastUpdated, source: typeof raw.source === 'string' && raw.source ? raw.source : 'In-repo snapshot', entries };
}

/**
 * Fallback meta snapshot built entirely from the player's own logged matches (see domain/matches.ts)
 * — used when no static snapshot is checked in yet for a regulation, so the Meta tab still shows
 * something real instead of just an empty state. Clearly attributed via `source` so the UI can
 * distinguish it from a checked-in snapshot.
 */
export function localMetaFromMatches(
  matches: { regulationId?: string; opponentTeam: { speciesId: string; itemId?: string; abilityId?: string; moves?: string[] }[] }[],
  regulationId: string,
): MetaSnapshot | null {
  const relevant = matches.filter((m) => m.regulationId === regulationId);
  if (!relevant.length) return null;

  const totalMatches = relevant.length;
  const bySpecies = new Map<string, { seen: number; items: Map<string, number>; moves: Map<string, number> }>();
  for (const m of relevant) {
    for (const mon of m.opponentTeam) {
      const rec = bySpecies.get(mon.speciesId) ?? { seen: 0, items: new Map(), moves: new Map() };
      rec.seen++;
      if (mon.itemId) rec.items.set(mon.itemId, (rec.items.get(mon.itemId) ?? 0) + 1);
      for (const mv of mon.moves ?? []) rec.moves.set(mv, (rec.moves.get(mv) ?? 0) + 1);
      bySpecies.set(mon.speciesId, rec);
    }
  }
  if (!bySpecies.size) return null;

  const toShare = (counts: Map<string, number>, denom: number) =>
    [...counts.entries()].map(([id, n]) => ({ id, pct: (n / denom) * 100 })).sort((a, b) => b.pct - a.pct);

  const entries: MetaEntry[] = [...bySpecies.entries()]
    .map(([speciesId, rec]) => ({
      speciesId,
      usagePct: (rec.seen / totalMatches) * 100,
      items: toShare(rec.items, rec.seen).map((x) => ({ itemId: x.id, pct: x.pct })),
      moves: toShare(rec.moves, rec.seen).map((x) => ({ moveId: x.id, pct: x.pct })),
      spreads: [],
    }))
    .sort((a, b) => b.usagePct - a.usagePct);

  return { regulationId, lastUpdated: new Date().toISOString().slice(0, 10), source: `${totalMatches} of your logged matches`, entries };
}

/**
 * Cheap cross-reference: how much a logged opponent's Team Preview overlaps a known popular core
 * (shared species / total, 0–1). Kept as a simple set-overlap score rather than a full match so the
 * two features stay independent — this is an optional hint, not a hard dependency.
 */
export function coreOverlapScore(loggedSpecies: string[], metaEntry: MetaEntry): number {
  const teammates = new Set([metaEntry.speciesId, ...(metaEntry.teammates ?? []).map((t) => t.speciesId)]);
  if (teammates.size < 2) return 0;
  const logged = new Set(loggedSpecies);
  let shared = 0;
  for (const s of teammates) if (logged.has(s)) shared++;
  return shared / teammates.size;
}
