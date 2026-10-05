/**
 * The comparison half of `npm run data:audit` (scripts/audit-data.ts): pure functions that diff our
 * generated Champions data against Showdown's, and match the differences with the allowlist of
 * known, intentional ones (scripts/audit-allowlist.json). No file or network access here.
 */
import { z } from 'zod';

/** One difference. `id` is stable (the allowlist names it); `area` groups the report. */
export interface Difference {
  id: string;
  area: DiffArea;
  /** Human-readable, one line. */
  detail: string;
}

export const DIFF_AREAS = ['species', 'items', 'moves', 'learnsets', 'stats', 'abilities', 'types', 'megastones'] as const;
export type DiffArea = (typeof DIFF_AREAS)[number];

/** Items present on one side only (both sorted). */
export function diffSets(ours: Iterable<string>, theirs: Iterable<string>): { onlyOurs: string[]; onlyTheirs: string[] } {
  const a = new Set(ours);
  const b = new Set(theirs);
  return { onlyOurs: [...a].filter((x) => !b.has(x)).sort(), onlyTheirs: [...b].filter((x) => !a.has(x)).sort() };
}

/** `legal` differences of one kind for one regulation, as Difference rows. */
export function legalityDiffs(kind: 'species' | 'items' | 'moves', regulationId: string, ours: Iterable<string>, theirs: Iterable<string>): Difference[] {
  const { onlyOurs, onlyTheirs } = diffSets(ours, theirs);
  const noun = kind === 'species' ? 'species' : kind === 'items' ? 'item' : 'move';
  return [
    ...onlyOurs.map((x) => ({ id: `${noun}-only-ours:${regulationId}:${x}`, area: kind, detail: `${x} is legal in ${regulationId} here but not upstream` })),
    ...onlyTheirs.map((x) => ({ id: `${noun}-only-upstream:${regulationId}:${x}`, area: kind, detail: `${x} is legal in ${regulationId} upstream but not here` })),
  ];
}

export interface SpeciesView {
  types: string[];
  /** Ability names by slot (0, 1, H, S). */
  abilities: Record<string, string>;
  baseStats: Record<string, number>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Type, ability and base-stat differences for one species present on both sides. */
export function diffSpecies(id: string, ours: SpeciesView, theirs: SpeciesView): Difference[] {
  const out: Difference[] = [];
  if (ours.types.join('/') !== theirs.types.join('/')) {
    out.push({ id: `types:${id}`, area: 'types', detail: `${id}: types ${ours.types.join('/')} here, ${theirs.types.join('/')} upstream` });
  }
  const slots = [...new Set([...Object.keys(ours.abilities), ...Object.keys(theirs.abilities)])].sort();
  for (const slot of slots) {
    const a = ours.abilities[slot];
    const b = theirs.abilities[slot];
    if ((a ? norm(a) : '') !== (b ? norm(b) : '')) {
      out.push({ id: `abilities:${id}:${slot}`, area: 'abilities', detail: `${id}: ability ${slot} is ${a ?? '(none)'} here, ${b ?? '(none)'} upstream` });
    }
  }
  for (const stat of [...new Set([...Object.keys(ours.baseStats), ...Object.keys(theirs.baseStats)])].sort()) {
    if (ours.baseStats[stat] !== theirs.baseStats[stat]) {
      out.push({ id: `stats:${id}:${stat}`, area: 'stats', detail: `${id}: base ${stat} is ${ours.baseStats[stat]} here, ${theirs.baseStats[stat]} upstream` });
    }
  }
  return out;
}

/** Moves one species lacks / has extra compared with upstream. */
export function diffLearnset(id: string, ours: string[], theirs: string[]): Difference[] {
  const { onlyOurs, onlyTheirs } = diffSets(ours, theirs);
  return [
    ...onlyTheirs.map((m) => ({ id: `learnset-missing:${id}:${m}`, area: 'learnsets' as const, detail: `${id} can learn ${m} upstream, not here` })),
    ...onlyOurs.map((m) => ({ id: `learnset-extra:${id}:${m}`, area: 'learnsets' as const, detail: `${id} can learn ${m} here, not upstream` })),
  ];
}

/** Mega Stone → Mega mappings (base species id → Mega id) that differ for one stone. */
export function diffMegaStone(item: string, ours: Record<string, string> | undefined, theirs: Record<string, string> | undefined): Difference[] {
  const a = ours ?? {};
  const b = theirs ?? {};
  const out: Difference[] = [];
  for (const base of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (a[base] !== b[base]) {
      out.push({ id: `megastone:${item}:${base}`, area: 'megastones', detail: `${item} on ${base}: ${a[base] ?? '(no Mega)'} here, ${b[base] ?? '(no Mega)'} upstream` });
    }
  }
  return out;
}

// ---- the allowlist -------------------------------------------------------------------------

/** One known, intentional difference. `id` may end in `*` to cover a family (e.g. `learnset-extra:foo:*`). */
export const AllowlistEntrySchema = z.object({
  id: z.string().min(3).max(200).regex(/^[a-z-]+:[A-Za-z0-9:*-]*$/, 'id looks like area:regulation-or-species[:thing] (an ability slot may be H or S), optional trailing *'),
  reason: z.string().trim().min(10).max(400),
});
export const AllowlistSchema = z.object({
  note: z.string().optional(),
  entries: z.array(AllowlistEntrySchema),
});
export type Allowlist = z.infer<typeof AllowlistSchema>;

const matches = (pattern: string, id: string) => (pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : pattern === id);

export interface AuditResult {
  unexplained: Difference[];
  explained: (Difference & { reason: string })[];
  /** Allowlist entries that matched nothing: the upstream data or ours has moved on, delete them. */
  stale: string[];
}

export function applyAllowlist(diffs: Difference[], allowlist: Allowlist): AuditResult {
  const used = new Set<string>();
  const unexplained: Difference[] = [];
  const explained: AuditResult['explained'] = [];
  for (const d of diffs) {
    const entry = allowlist.entries.find((e) => matches(e.id, d.id));
    if (entry) {
      used.add(entry.id);
      explained.push({ ...d, reason: entry.reason });
    } else unexplained.push(d);
  }
  return { unexplained, explained, stale: allowlist.entries.filter((e) => !used.has(e.id)).map((e) => e.id) };
}
