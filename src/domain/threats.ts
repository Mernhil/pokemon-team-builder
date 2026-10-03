/**
 * Threat engine: your team against the most-used sets of a Champions regulation, both directions.
 *
 * Pure and React-free, and every cell is a plain serialisable object, so the same code runs in a Web
 * Worker (src/workers/threats.worker.ts) and on the main thread with identical results. Damage and
 * Speed come from calcMoves / calcSpeed, so they can never disagree with the Damage Calc.
 *
 * Mega Stone holders are calculated in both formes (MegaMode 'both') and then read pessimistically
 * for you and optimistically for the threat: your damage and Speed use your worse forme, theirs the
 * better one, so a threat is never understated.
 */
import type { Dex } from '@/data/dex';
import { calcMoves, calcSpeed, type FormResult, type MoveResult } from './battle/damage';
import { defaultSide, type FieldConditions } from './battle/conditions';
import type { MegaMode } from './battle/conditions';
import type { PokemonSet } from './types';
import { byUsage } from './usage.ts';

export type Kill = 'ohko' | 'pohko' | '2hko' | '3hko' | 'none';
const RANK: Record<Kill, number> = { ohko: 4, pohko: 3, '2hko': 2, '3hko': 1, none: 0 };
export const killRank = (k: Kill) => RANK[k];
export const KILL_LABEL: Record<Kill, string> = { ohko: 'OHKO', pohko: 'Possible OHKO', '2hko': '2HKO', '3hko': '3HKO+', none: 'No damage' };
/** Compact label for a grid cell. */
export const KILL_SHORT: Record<Kill, string> = { ohko: 'OHKO', pohko: 'OHKO?', '2hko': '2HKO', '3hko': '3HKO+', none: '—' };

/** The Threat report's usual sizes. */
export const THREAT_COUNTS = [10, 20, 30] as const;

/**
 * Kill class from the calculator's own KO text ("guaranteed OHKO", "56.2% chance to 2HKO",
 * "possible 3HKO"), falling back to the damage range when there is none.
 */
export function classifyKill(koText: string, percent: [number, number]): Kill {
  if (percent[1] <= 0) return 'none';
  const t = koText.match(/(guaranteed|possible|[\d.]+% chance to)?\s*(O|\d)HKO/i);
  if (t) {
    const hits = t[2].toUpperCase() === 'O' ? 1 : Number(t[2]);
    const sure = /guaranteed/i.test(t[0]);
    if (hits === 1) return sure ? 'ohko' : 'pohko';
    if (hits === 2) return '2hko';
    return '3hko';
  }
  if (percent[0] >= 100) return 'ohko';
  if (percent[1] >= 100) return 'pohko';
  if (percent[1] * 2 >= 100) return '2hko';
  return '3hko';
}

export interface MoveSummary {
  move: string;
  moveId: string;
  /** Damage as % of the defender's max HP. */
  percent: [number, number];
  kill: Kill;
  /** The calculator's KO sentence. */
  text: string;
}

export interface ThreatCell {
  /** My best move against the threat (null: no damaging move). */
  mine: MoveSummary | null;
  /** Its best move against me. */
  theirs: MoveSummary | null;
  first: 'me' | 'them' | 'tie';
  mySpeed: number;
  theirSpeed: number;
  /** Positive: good for me; negative: bad. About −4.5 to +4.5; see `bucket`. */
  verdict: number;
}

export type Bucket = 'good' | 'even' | 'bad';
export const bucket = (verdict: number): Bucket => (verdict >= 1.5 ? 'good' : verdict <= -1.5 ? 'bad' : 'even');

function representative(forms: FormResult[], pessimistic: boolean): FormResult {
  return forms.reduce((a, b) => ((pessimistic ? b.percent[1] < a.percent[1] : b.percent[1] > a.percent[1]) ? b : a));
}

/** The strongest move of a result set: kill class first, then damage. */
function best(results: MoveResult[], pessimistic: boolean): MoveSummary | null {
  let top: (MoveSummary & { rank: number }) | null = null;
  for (const m of results) {
    if (m.category === 'Status' || m.forms.length === 0) continue;
    const f = representative(m.forms, pessimistic);
    const kill = classifyKill(f.koText, f.percent);
    const rank = RANK[kill];
    if (!top || rank > top.rank || (rank === top.rank && f.percent[1] > top.percent[1])) {
      top = { move: m.name, moveId: m.moveId, percent: f.percent, kill, text: f.koText || f.desc, rank };
    }
  }
  if (!top || top.kill === 'none') return null;
  const { rank: _rank, ...summary } = top;
  return summary;
}

/** One of my Pokémon against one threat, under a field. */
export function computeCell(
  dex: Dex,
  mine: PokemonSet,
  threat: { set: PokemonSet; megaMode: MegaMode },
  field: FieldConditions,
  /** Force my Mega holder to one forme (the bring planner: only one Pokémon can Mega per battle). Default: both, read pessimistically. */
  mineMega?: 'base' | 'mega',
): ThreatCell {
  const myHasMega = !!dex.megaFor(mine.speciesId, mine.itemId);
  const mySide = { set: mine, cond: { ...defaultSide(myHasMega), ...(mineMega ? { megaMode: mineMega } : {}) } };
  const theirSide = { set: threat.set, cond: { ...defaultSide(threat.megaMode !== 'base'), megaMode: threat.megaMode } };

  const myMoves = best(calcMoves(dex, mySide, theirSide, field), true);
  const theirMoves = best(calcMoves(dex, theirSide, mySide, field), false);

  const mySpeed = Math.min(...calcSpeed(dex, mySide, field).map((r) => r.speed));
  const theirSpeed = Math.max(...calcSpeed(dex, theirSide, field).map((r) => r.speed));
  let first: ThreatCell['first'] = mySpeed === theirSpeed ? 'tie' : mySpeed > theirSpeed ? 'me' : 'them';
  if (field.trickRoom && first !== 'tie') first = first === 'me' ? 'them' : 'me';

  const verdict = RANK[myMoves?.kill ?? 'none'] - RANK[theirMoves?.kill ?? 'none'] + (first === 'me' ? 0.5 : first === 'them' ? -0.5 : 0);
  return { mine: myMoves, theirs: theirMoves, first, mySpeed, theirSpeed, verdict };
}

// ---------------------------------------------------------------------------
// Jobs (serialisable, so a worker can run them)
// ---------------------------------------------------------------------------

export interface ThreatJob {
  datasetId: string;
  formatId: string;
  members: { slot: number; set: PokemonSet }[];
  threats: { key: string; speciesId: string; usagePct?: number; usageRank?: number; set: PokemonSet; megaMode: MegaMode }[];
  field: FieldConditions;
}

/** What goes into a cell's result: everything that changes the numbers. */
const setHash = (s: PokemonSet) => JSON.stringify([s.speciesId, s.abilityId, s.itemId, s.nature, s.level, s.sp, s.evs, s.ivs, s.moves]);
export const fieldHash = (f: FieldConditions) => `${f.gameType}|${f.weather}|${f.terrain}|${f.trickRoom}|${f.gravity}`;

/** Memoised cells keyed by (my set, threat set, field). Lives as long as its owner (a worker, a hook). */
export type ThreatCache = Map<string, ThreatCell>;

/** One threat's row: a cell per member, in member order. */
export function runThreatRow(dex: Dex, job: ThreatJob, threatIndex: number, cache?: ThreatCache): ThreatCell[] {
  const t = job.threats[threatIndex];
  const f = fieldHash(job.field);
  return job.members.map((m) => {
    const key = `${setHash(m.set)}#${t.key}#${setHash(t.set)}#${t.megaMode}#${f}`;
    let cell = cache?.get(key);
    if (!cell) {
      cell = computeCell(dex, m.set, t, job.field);
      cache?.set(key, cell);
    }
    return cell;
  });
}

/** Runs the whole job, handing each finished row to `onRow` (progressive results). */
export function runThreatJob(dex: Dex, job: ThreatJob, onRow: (index: number, cells: ThreatCell[]) => void, cache?: ThreatCache): ThreatCell[][] {
  return job.threats.map((_, i) => {
    const cells = runThreatRow(dex, job, i, cache);
    onRow(i, cells);
    return cells;
  });
}

// ---------------------------------------------------------------------------
// Plain-language summaries
// ---------------------------------------------------------------------------

export interface ThreatSummary {
  speciesId: string;
  /** Usage: a %, or (in-game data) a rank. */
  usagePct?: number;
  usageRank?: number;
  /** Higher = worse for me; the sort key (then usage, then species id, so the order is stable). */
  danger: number;
  tone: 'bad' | 'warn' | 'good';
  lines: string[];
}

const nameOf = (dex: Dex, id: string) => dex.species(id)?.name ?? id;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** One summary per threat, worst first. `rows[i]` are the cells of `job.threats[i]`. */
export function summarize(dex: Dex, job: ThreatJob, rows: ThreatCell[][]): ThreatSummary[] {
  const out: ThreatSummary[] = [];
  job.threats.forEach((t, i) => {
    const cells = rows[i];
    if (!cells || cells.length === 0) return;
    const name = nameOf(dex, t.speciesId);
    const danger = cells.reduce((a, c) => a + Math.max(0, -c.verdict), 0);
    const theirOhko = cells.filter((c) => c.theirs?.kill === 'ohko').length;
    const myOhko = cells.filter((c) => c.mine?.kill === 'ohko').length;
    const fastKo = cells.filter((c) => c.first === 'me' && RANK[c.mine?.kill ?? 'none'] >= RANK['2hko']);
    const lines: string[] = [];

    if (theirOhko > 0) {
      const mine = myOhko === 0 ? ' and none of yours OHKO it back' : `, while ${myOhko} of yours OHKO it back`;
      lines.push(`${name} OHKOs ${theirOhko} of your Pokémon${mine}.`);
    }
    if (fastKo.length === 0) lines.push(`Nothing on your team outspeeds and 2HKOs ${name}.`);
    else if (theirOhko === 0) {
      const names = fastKo.map((c) => nameOf(dex, job.members[cells.indexOf(c)].set.speciesId));
      lines.push(`${names.join(' and ')} ${plural(names.length, 'outspeeds', 'outspeed')} and 2HKO${names.length === 1 ? 's' : ''} ${name}.`);
    }
    if (lines.length === 0) lines.push(`No clear problem: ${name} doesn't OHKO anything of yours.`);

    const tone = theirOhko > 0 && myOhko === 0 ? 'bad' : theirOhko > 0 || fastKo.length === 0 ? 'warn' : 'good';
    out.push({ speciesId: t.speciesId, usagePct: t.usagePct, usageRank: t.usageRank, danger, tone, lines });
  });
  return out.sort((a, b) => b.danger - a.danger || byUsage(a, b) || a.speciesId.localeCompare(b.speciesId));
}
