/**
 * Set-by-set comparison of two teams (the Compare view): which Pokémon are the same, which changed
 * and how (species, item, ability, nature, moves, spreads), and which exist on one side only.
 * Pure and React-free.
 */
import { STAT_IDS, type PokemonSet, type StatId, type StatTable, type Team } from './types';

export type FieldKey = 'species' | 'item' | 'ability' | 'nature' | 'teraType' | 'level' | 'sp' | 'evs' | 'ivs';

export interface FieldChange {
  field: FieldKey;
  /** The raw value on each side (an id, a level, or a compact spread like "HP 32 · Spe 32"). */
  a: string;
  b: string;
  /** For spreads: which stats differ. */
  stats?: StatId[];
}

export type PairStatus = 'same' | 'changed' | 'only-a' | 'only-b';

export interface SetDiff {
  a: PokemonSet | null;
  b: PokemonSet | null;
  status: PairStatus;
  changes: FieldChange[];
  /** Moves one side has and the other doesn't (order doesn't matter). */
  moves: { onlyA: string[]; onlyB: string[] };
}

export interface TeamDiff {
  pairs: SetDiff[];
  counts: Record<PairStatus, number>;
  /** Both are the same team folder (a team and its variations, or two variations): their differences are edits, not different teams. */
  sameFamily: boolean;
  /** The two teams are for different formats, so the comparison is only roughly meaningful. */
  differentFormat: boolean;
}

/** The folder a team belongs to: its own id for a top-level team, else its group. */
export const familyOf = (t: Pick<Team, 'id' | 'groupId'>): string => t.groupId ?? t.id;
export const sameFamily = (a: Pick<Team, 'id' | 'groupId'>, b: Pick<Team, 'id' | 'groupId'>): boolean => a.id !== b.id && familyOf(a) === familyOf(b);

const LABEL: Record<StatId, string> = { hp: 'HP', atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe' };
/** "HP 32 · Spe 32", or "none" for an empty spread. */
export const spreadText = (t: StatTable): string => {
  const parts = STAT_IDS.filter((s) => t[s] > 0).map((s) => `${LABEL[s]} ${t[s]}`);
  return parts.length ? parts.join(' · ') : 'none';
};

const moveSet = (s: PokemonSet) => new Set(s.moves.filter(Boolean));

/** What differs between two sets, field by field (the species field only when they are different species). */
export function diffSets(a: PokemonSet, b: PokemonSet): { changes: FieldChange[]; moves: SetDiff['moves'] } {
  const changes: FieldChange[] = [];
  const scalar = (field: FieldKey, x: string | number | undefined, y: string | number | undefined) => {
    const xs = x === undefined ? '' : String(x);
    const ys = y === undefined ? '' : String(y);
    if (xs !== ys) changes.push({ field, a: xs, b: ys });
  };
  scalar('species', a.speciesId, b.speciesId);
  scalar('item', a.itemId, b.itemId);
  scalar('ability', a.abilityId, b.abilityId);
  scalar('nature', a.nature, b.nature);
  scalar('teraType', a.teraType, b.teraType);
  scalar('level', a.level, b.level);
  for (const kind of ['sp', 'evs', 'ivs'] as const) {
    const stats = STAT_IDS.filter((s) => a[kind][s] !== b[kind][s]);
    if (stats.length) changes.push({ field: kind, a: spreadText(a[kind]), b: spreadText(b[kind]), stats });
  }
  const ma = moveSet(a);
  const mb = moveSet(b);
  return { changes, moves: { onlyA: [...ma].filter((m) => !mb.has(m)), onlyB: [...mb].filter((m) => !ma.has(m)) } };
}

/**
 * Pairs the two rosters up: the same species first (the common case: one team is a tweak of the
 * other), then what is left over in order (a Pokémon swapped for another shows as a species change),
 * then whatever remains is on one side only.
 */
export function diffTeams(a: Team, b: Team): TeamDiff {
  const as = a.slots.filter((s): s is PokemonSet => !!s);
  const bs = b.slots.filter((s): s is PokemonSet => !!s);
  const usedB = new Set<number>();
  const paired: { a: PokemonSet | null; b: PokemonSet | null }[] = [];
  const leftoverA: PokemonSet[] = [];
  for (const x of as) {
    const j = bs.findIndex((y, i) => !usedB.has(i) && y.speciesId === x.speciesId);
    if (j === -1) leftoverA.push(x);
    else {
      usedB.add(j);
      paired.push({ a: x, b: bs[j] });
    }
  }
  const leftoverB = bs.filter((_, i) => !usedB.has(i));
  const n = Math.max(leftoverA.length, leftoverB.length);
  for (let i = 0; i < n; i++) paired.push({ a: leftoverA[i] ?? null, b: leftoverB[i] ?? null });

  const pairs = paired.map(({ a: x, b: y }): SetDiff => {
    if (x && y) {
      const d = diffSets(x, y);
      return { a: x, b: y, status: d.changes.length || d.moves.onlyA.length || d.moves.onlyB.length ? 'changed' : 'same', ...d };
    }
    return { a: x, b: y, status: x ? 'only-a' : 'only-b', changes: [], moves: { onlyA: x ? x.moves.filter(Boolean) : [], onlyB: y ? y.moves.filter(Boolean) : [] } };
  });
  const counts: Record<PairStatus, number> = { same: 0, changed: 0, 'only-a': 0, 'only-b': 0 };
  for (const p of pairs) counts[p.status]++;
  return { pairs, counts, sameFamily: sameFamily(a, b), differentFormat: a.formatId !== b.formatId };
}
