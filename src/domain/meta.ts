/**
 * Meta (usage) data: one internal schema for every source, validated wherever data enters the app.
 *
 * Sources, in the order the app prefers them per regulation:
 *  1. Smogon's monthly usage statistics ("chaos" JSON from https://www.smogon.com/stats/), built by
 *     `npm run meta` (scripts/build-meta.ts) into src/data/generated/meta.json and baked into the
 *     app. A scheduled GitHub Action (.github/workflows/meta.yml) regenerates it.
 *  2. A hand-maintained file, src/data/meta/manual.json (same schema; docs/UPDATING_META.md), for
 *     regulations Smogon doesn't cover yet.
 *  3. The player's own logged matches (localMetaFromMatches) — shown when there's nothing else.
 *
 * Nothing here reaches the network; the Meta tab's optional refresh (store/metaStore.ts) fetches the
 * deployed copy of the same file and runs it through the same validation.
 */
import { z } from 'zod';

const id = z.string().regex(/^[a-z0-9]{1,64}$/);
const pct = z.number().min(0).max(100);
const share = z.object({ id, pct });

export const MetaEntrySchema = z.object({
  speciesId: id,
  /** % of teams running this species, 0–100 (Smogon's weighted usage). */
  usagePct: pct,
  abilities: z.array(share).default([]),
  items: z.array(share).default([]),
  moves: z.array(share).default([]),
  /** Other species most often on the same team. */
  teammates: z.array(share).default([]),
  /** Most common spreads: nature + the six stat investments (Stat Points in Champions). */
  spreads: z
    .array(
      z.object({
        nature: z.string().max(16),
        values: z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]),
        pct,
      }),
    )
    .default([]),
});
export type MetaEntry = z.infer<typeof MetaEntrySchema>;

export const MetaSourceSchema = z.object({
  /** Shown in the UI, e.g. "Smogon usage statistics (Pokémon Showdown ladder)". */
  name: z.string().min(1).max(120),
  url: z.string().url().optional(),
  /** Showdown format id the numbers come from, e.g. "gen9championsvgc2026regmc". */
  format: z.string().max(80).optional(),
  /** Stats month (YYYY-MM) for monthly sources. */
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  /** Rating cutoff (Smogon: 0, 1500, 1630, 1760). */
  cutoff: z.number().int().min(0).optional(),
  battles: z.number().int().min(0).optional(),
});
export type MetaSource = z.infer<typeof MetaSourceSchema>;

export const MetaSnapshotSchema = z.object({
  regulationId: z.string().min(1).max(64),
  /** When the data was produced or last checked (ISO date or date-time). */
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  source: MetaSourceSchema,
  entries: z.array(MetaEntrySchema).min(1),
});
export type MetaSnapshot = z.infer<typeof MetaSnapshotSchema>;

export const MetaFileSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  /** Keyed by regulation id (champions-reg-mc, …). */
  regulations: z.record(z.string(), MetaSnapshotSchema),
});
export type MetaFile = z.infer<typeof MetaFileSchema>;

/** Validates untrusted meta JSON; throws an Error naming the first problem. */
export function parseMetaFile(json: unknown): MetaFile {
  const r = MetaFileSchema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new Error(`Meta data failed validation at ${first.path.join('.') || '(root)'}: ${first.message}`);
  }
  return r.data;
}

/** Days after which a snapshot is flagged as stale in the UI (Smogon publishes monthly). */
export const META_STALE_DAYS = 45;

/**
 * The date the numbers describe up to: the last day of the stats month for monthly sources (a
 * snapshot built today from August's stats is still August's data), else `updatedAt`.
 */
export function metaDataDate(snap: Pick<MetaSnapshot, 'updatedAt' | 'source'>): string {
  const m = snap.source.month?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return snap.updatedAt.slice(0, 10);
  const lastDay = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0));
  return lastDay.toISOString().slice(0, 10);
}

export const metaAgeDays = (snap: Pick<MetaSnapshot, 'updatedAt' | 'source'>, now = Date.now()) =>
  Math.max(0, Math.floor((now - Date.parse(metaDataDate(snap))) / 86_400_000));

/**
 * Picks the snapshot for a regulation: the automated one if present, else the hand-maintained one.
 * A refreshed copy (newer `updatedAt`) wins over the baked one.
 */
export function pickSnapshot(regulationId: string, ...files: (MetaFile | undefined)[]): MetaSnapshot | undefined {
  return files
    .map((f) => f?.regulations[regulationId])
    .filter((s): s is MetaSnapshot => !!s)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

// ---------------------------------------------------------------------------
// Smogon "chaos" JSON → MetaSnapshot (used by scripts/build-meta.ts; pure, so it's unit-tested)
// ---------------------------------------------------------------------------

const weights = z.record(z.string(), z.number());
/** The parts of Smogon's chaos format this app reads (it carries more; extra keys are ignored). */
export const ChaosSchema = z.object({
  info: z.object({
    metagame: z.string(),
    cutoff: z.number(),
    'number of battles': z.number(),
  }),
  data: z.record(
    z.string(),
    z.object({
      usage: z.number(),
      Abilities: weights.default({}),
      Items: weights.default({}),
      Moves: weights.default({}),
      Teammates: weights.default({}),
      Spreads: weights.default({}),
    }),
  ),
});

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Top `n` entries of a weight table as % of `total`, skipping Showdown's placeholders. */
function top(table: Record<string, number>, total: number, n: number, minPct = 1): { id: string; pct: number }[] {
  return Object.entries(table)
    .map(([k, w]) => ({ id: toId(k), pct: total > 0 ? round1((w / total) * 100) : 0 }))
    .filter((x) => x.id && x.id !== 'nothing' && x.id !== 'empty' && x.id !== 'other' && x.pct >= minPct)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, n);
}

export interface ChaosOptions {
  regulationId: string;
  format: string;
  month: string;
  url: string;
  /** Species kept (by usage). */
  maxSpecies?: number;
  /** Species under this usage % are dropped. */
  minUsagePct?: number;
  /** Maps a Showdown species name to this app's species id (undefined = unknown species, dropped). */
  speciesId?: (name: string) => string | undefined;
}

/**
 * Normalises one Smogon chaos file. Per-species shares use the species' total weight (the sum of its
 * ability weights — every team member has exactly one ability), which is how Smogon's own moveset
 * pages compute their percentages. Teammate shares are the same co-occurrence weights over that total.
 */
export function chaosToSnapshot(raw: unknown, o: ChaosOptions): MetaSnapshot {
  const chaos = ChaosSchema.parse(raw);
  const mapId = o.speciesId ?? toId;
  const entries = Object.entries(chaos.data)
    .map(([name, d]) => {
      const speciesId = mapId(name);
      if (!speciesId) return null;
      const total = Object.values(d.Abilities).reduce((a, b) => a + b, 0) || Object.values(d.Items).reduce((a, b) => a + b, 0);
      const spreads = Object.entries(d.Spreads)
        .map(([key, w]) => {
          const [nature, stats] = key.split(':');
          const values = (stats ?? '').split('/').map(Number);
          return values.length === 6 && values.every((v) => Number.isFinite(v)) && nature
            ? { nature, values: values as [number, number, number, number, number, number], pct: total > 0 ? round1((w / total) * 100) : 0 }
            : null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x && x.pct >= 1)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 5);
      return {
        speciesId,
        usagePct: round1(Math.min(100, d.usage * 100)),
        abilities: top(d.Abilities, total, 3),
        items: top(d.Items, total, 6),
        moves: top(d.Moves, total, 8),
        teammates: top(Object.fromEntries(Object.entries(d.Teammates).map(([k, w]) => [k, Math.max(0, w)])), total, 6)
          .map((t) => ({ id: mapId(t.id) ?? t.id, pct: t.pct })),
        spreads,
      };
    })
    .filter((e): e is NonNullable<typeof e> => !!e && e.usagePct >= (o.minUsagePct ?? 1))
    .sort((a, b) => b.usagePct - a.usagePct)
    .slice(0, o.maxSpecies ?? 60);
  return MetaSnapshotSchema.parse({
    regulationId: o.regulationId,
    updatedAt: new Date().toISOString().slice(0, 10),
    source: {
      name: 'Smogon usage statistics (Pokémon Showdown ladder)',
      url: o.url,
      format: o.format,
      month: o.month,
      cutoff: chaos.info.cutoff,
      battles: chaos.info['number of battles'],
    },
    entries,
  });
}

// ---------------------------------------------------------------------------
// Personal fallback and cross-references
// ---------------------------------------------------------------------------

/**
 * Meta built only from the player's own logged matches (domain/matches.ts) — no network needed.
 * Shown when no published usage data covers a regulation, and clearly labelled as such.
 */
export function localMetaFromMatches(
  matches: { regulationId?: string; opponentTeam: { speciesId: string; itemId?: string; abilityId?: string; moves?: string[] }[] }[],
  regulationId: string,
  today = new Date().toISOString().slice(0, 10),
  /** What the matches are called in the source label (default: "Your logged matches"); "Both of us" passes its own. */
  sourceLabel = 'Your logged matches',
): MetaSnapshot | null {
  const relevant = matches.filter((m) => m.regulationId === regulationId);
  if (!relevant.length) return null;

  const bySpecies = new Map<string, { seen: number; items: Map<string, number>; moves: Map<string, number>; abilities: Map<string, number> }>();
  for (const m of relevant) {
    for (const mon of m.opponentTeam) {
      if (!/^[a-z0-9]{1,64}$/.test(mon.speciesId)) continue;
      const rec = bySpecies.get(mon.speciesId) ?? { seen: 0, items: new Map(), moves: new Map(), abilities: new Map() };
      rec.seen++;
      if (mon.itemId) rec.items.set(mon.itemId, (rec.items.get(mon.itemId) ?? 0) + 1);
      if (mon.abilityId) rec.abilities.set(mon.abilityId, (rec.abilities.get(mon.abilityId) ?? 0) + 1);
      for (const mv of mon.moves ?? []) rec.moves.set(mv, (rec.moves.get(mv) ?? 0) + 1);
      bySpecies.set(mon.speciesId, rec);
    }
  }
  if (!bySpecies.size) return null;

  const share = (counts: Map<string, number>, denom: number) =>
    [...counts.entries()].map(([id, n]) => ({ id, pct: round1((n / denom) * 100) })).sort((a, b) => b.pct - a.pct);

  return {
    regulationId,
    updatedAt: today,
    source: { name: `${sourceLabel} (${relevant.length})`, battles: relevant.length },
    entries: [...bySpecies.entries()]
      .map(([speciesId, rec]) => ({
        speciesId,
        usagePct: round1((rec.seen / relevant.length) * 100),
        abilities: share(rec.abilities, rec.seen),
        items: share(rec.items, rec.seen),
        moves: share(rec.moves, rec.seen),
        teammates: [],
        spreads: [],
      }))
      .sort((a, b) => b.usagePct - a.usagePct),
  };
}

/**
 * Cheap cross-reference: how much a logged opponent's Team Preview overlaps a popular core
 * (shared species / core size, 0–1). An optional hint, not a hard dependency.
 */
export function coreOverlapScore(loggedSpecies: string[], metaEntry: Pick<MetaEntry, 'speciesId' | 'teammates'>): number {
  const core = new Set([metaEntry.speciesId, ...metaEntry.teammates.map((t) => t.id)]);
  if (core.size < 2) return 0;
  const logged = new Set(loggedSpecies);
  let shared = 0;
  for (const s of core) if (logged.has(s)) shared++;
  return shared / core.size;
}

export interface MetaPartner {
  speciesId: string;
  /** Sum of "% of teams with X that also have this" over the team's members that have usage data. */
  score: number;
  /** The team members it's commonly paired with, strongest first. */
  with: { speciesId: string; pct: number }[];
}

/**
 * Teammate suggestions from published usage data: species most often paired with the team's
 * members, excluding ones already on it. Empty when no member has usage data.
 */
export function metaPartners(snapshot: MetaSnapshot, teamSpecies: string[], limit = 4): MetaPartner[] {
  const onTeam = new Set(teamSpecies);
  const byId = new Map(snapshot.entries.map((e) => [e.speciesId, e]));
  const partners = new Map<string, MetaPartner>();
  for (const member of onTeam) {
    for (const t of byId.get(member)?.teammates ?? []) {
      if (onTeam.has(t.id)) continue;
      const p = partners.get(t.id) ?? { speciesId: t.id, score: 0, with: [] };
      p.score += t.pct;
      p.with.push({ speciesId: member, pct: t.pct });
      partners.set(t.id, p);
    }
  }
  return [...partners.values()]
    .map((p) => ({ ...p, score: Math.round(p.score * 10) / 10, with: p.with.sort((a, b) => b.pct - a.pct) }))
    .sort((a, b) => b.score - a.score || a.speciesId.localeCompare(b.speciesId))
    .slice(0, limit);
}
