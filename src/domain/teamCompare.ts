/**
 * Set-by-set comparison of two teams (mine, shared, or two variations of the same folder), pure so
 * the Compare view only draws it. Pokémon are paired by species; anything unpaired is only on one side.
 */
import { getFormat } from './formats';
import { STAT_IDS, STAT_LABELS, type PokemonSet, type StatTable, type Team } from './types';

export type SetField = 'item' | 'ability' | 'nature' | 'tera' | 'moves' | 'spread' | 'ivs' | 'level';

export interface SetChange {
  field: SetField;
  /** Values as ids/text for the two sides ('' when empty). Moves: comma-separated, in slot order. */
  a: string;
  b: string;
  /** Moves only: ids only on side A / only on side B. */
  movesOnlyA?: string[];
  movesOnlyB?: string[];
}

export interface SetDiff {
  speciesId: string;
  a: PokemonSet | null;
  b: PokemonSet | null;
  status: 'same' | 'changed' | 'only-a' | 'only-b';
  changes: SetChange[];
}

export interface TeamDiff {
  /** Both teams are the same folder: the top-level team and a variation of it, or two variations. */
  sameFolder: boolean;
  sameFormat: boolean;
  sets: SetDiff[];
  identical: boolean;
  counts: { same: number; changed: number; onlyA: number; onlyB: number };
}

/** The folder a team belongs to: itself when top-level, else the team it is a variation of. */
export const folderOf = (t: Pick<Team, 'id' | 'groupId'>): string => t.groupId ?? t.id;

const spreadText = (table: StatTable, labels = STAT_LABELS) =>
  STAT_IDS.filter((s) => table[s] > 0)
    .map((s) => `${table[s]} ${labels[s]}`)
    .join(' / ');

const sameTable = (a: StatTable, b: StatTable) => STAT_IDS.every((s) => a[s] === b[s]);

/** What differs between two sets of the same species. */
export function diffSets(a: PokemonSet, b: PokemonSet, statKind: 'champions-sp' | 'other' = 'champions-sp'): SetChange[] {
  const out: SetChange[] = [];
  const text = (field: SetField, x: string | number | undefined, y: string | number | undefined) => {
    const xs = x === undefined ? '' : String(x);
    const ys = y === undefined ? '' : String(y);
    if (xs !== ys) out.push({ field, a: xs, b: ys });
  };
  text('item', a.itemId, b.itemId);
  text('ability', a.abilityId, b.abilityId);
  text('nature', a.nature, b.nature);
  text('tera', a.teraType, b.teraType);
  text('level', a.level, b.level);
  const ma = a.moves.filter(Boolean);
  const mb = b.moves.filter(Boolean);
  const onlyA = ma.filter((m) => !mb.includes(m));
  const onlyB = mb.filter((m) => !ma.includes(m));
  if (onlyA.length || onlyB.length) out.push({ field: 'moves', a: ma.join(','), b: mb.join(','), movesOnlyA: onlyA, movesOnlyB: onlyB });
  const key = statKind === 'champions-sp' ? 'sp' : 'evs';
  if (!sameTable(a[key], b[key])) out.push({ field: 'spread', a: spreadText(a[key]), b: spreadText(b[key]) });
  if (statKind !== 'champions-sp' && !sameTable(a.ivs, b.ivs)) out.push({ field: 'ivs', a: spreadText(a.ivs), b: spreadText(b.ivs) });
  return out;
}

export function compareTeams(a: Team, b: Team): TeamDiff {
  const statKind = getFormat(a.formatId).statSystem.kind === 'champions-sp' ? 'champions-sp' : 'other';
  const left = a.slots.filter((s): s is PokemonSet => !!s);
  const right = [...b.slots.filter((s): s is PokemonSet => !!s)];
  const sets: SetDiff[] = [];
  for (const sa of left) {
    const i = right.findIndex((sb) => sb.speciesId === sa.speciesId);
    if (i < 0) {
      sets.push({ speciesId: sa.speciesId, a: sa, b: null, status: 'only-a', changes: [] });
      continue;
    }
    const [sb] = right.splice(i, 1);
    const changes = diffSets(sa, sb, statKind);
    sets.push({ speciesId: sa.speciesId, a: sa, b: sb, status: changes.length ? 'changed' : 'same', changes });
  }
  for (const sb of right) sets.push({ speciesId: sb.speciesId, a: null, b: sb, status: 'only-b', changes: [] });
  const counts = {
    same: sets.filter((s) => s.status === 'same').length,
    changed: sets.filter((s) => s.status === 'changed').length,
    onlyA: sets.filter((s) => s.status === 'only-a').length,
    onlyB: sets.filter((s) => s.status === 'only-b').length,
  };
  return {
    sameFolder: folderOf(a) === folderOf(b) && a.id !== b.id,
    sameFormat: a.formatId === b.formatId,
    sets,
    identical: sets.length > 0 && counts.changed + counts.onlyA + counts.onlyB === 0,
    counts,
  };
}

/** One option of a team picker: a top-level team or one of its variations, labelled. */
export interface TeamChoice {
  id: string;
  label: string;
  group: 'mine' | 'shared';
}

/** Every team (mine first, then shared with me) as a flat, labelled list for a picker; a variation reads "Team · label". */
export function teamChoices(teams: Record<string, Team>, order: string[]): TeamChoice[] {
  const label = (t: Team) => (t.groupId && teams[t.groupId] ? `${teams[t.groupId].name} · ${t.variationLabel ?? 'variation'}` : t.name);
  const out: TeamChoice[] = [];
  const seen = new Set<string>();
  const push = (t: Team) => {
    if (seen.has(t.id)) return;
    seen.add(t.id);
    out.push({ id: t.id, label: t.shared ? `${label(t)} (shared)` : label(t), group: t.shared ? 'shared' : 'mine' });
  };
  const members = (rootId: string) => Object.values(teams).filter((t) => t.groupId === rootId).sort((x, y) => y.updatedAt - x.updatedAt);
  for (const id of order) {
    const root = teams[id];
    if (!root) continue;
    push(root);
    members(id).forEach(push);
  }
  Object.values(teams).forEach(push); // anything not in `order`
  return [...out.filter((c) => c.group === 'mine'), ...out.filter((c) => c.group === 'shared')];
}
