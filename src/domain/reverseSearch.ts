/**
 * Reverse search: "which Pokémon one-shots X, survives Y and resists Z?" Pure and React-free.
 *
 * Candidates are every species the format allows, each built as its most-used competitive set (meta
 * data, via metaSets.ts) or, for species the meta doesn't cover, a computed default build. A
 * condition is checked with the same engine as the Threat report (`computeCell`), so the answers can
 * never disagree with the Damage Calc. "Resists" is a pure type check.
 */
import type { Dex } from '@/data/dex';
import type { FieldConditions, MegaMode } from './battle/conditions';
import type { MetaSnapshot } from './meta';
import { metaSet } from './metaSets';
import { createSet } from './team';
import { computeCell, type ThreatCell } from './threats';
import type { FormatRules, Move, Pokemon, PokemonSet, TypeName } from './types';

export type ConditionKind = 'ohko' | 'survive' | 'resist' | 'outspeed';

export interface SearchTarget {
  speciesId: string;
  set: PokemonSet;
  megaMode: MegaMode;
}

export interface Condition {
  /** Stable React key. */
  id: string;
  kind: ConditionKind;
  target: SearchTarget;
  /** survive: how many hits it must take (1 or 2). Default 1. */
  hits?: 1 | 2;
  /** ohko: also accept "possible OHKO" (a damage roll can do it). Default: guaranteed only. */
  allowPossible?: boolean;
}

export interface Candidate {
  speciesId: string;
  set: PokemonSet;
  megaMode: MegaMode;
  /** 'meta': the most-used set; 'default': a computed attacker build (no item). */
  build: 'meta' | 'default';
  usagePct: number;
}

export const CONDITION_LABEL: Record<ConditionKind, string> = {
  ohko: 'One-shots',
  survive: 'Survives',
  resist: 'Resists',
  outspeed: 'Outspeeds',
};

// ---------------------------------------------------------------------------
// Default build
// ---------------------------------------------------------------------------

/**
 * Moves not worth a default slot: they need a recharge or charge turn, lock the user in, fail in plain
 * conditions (Belch, Sucker Punch, Steel Roller), cost the user its life, or miss too often. Recoil and
 * self stat drops (Flare Blitz, Close Combat, Draco Meteor) are normal costs and stay.
 */
const UNRELIABLE_TEXT = /cannot move next turn|faints|loses 50%|charges|hits turn|lasts 2-3 turns|fails (unless|if)|first turn out|flies up|hits two turns|stat lowered|last move failed|steals|goes first|underground|underwater|vanishes|on the first turn|turn 1|turn 2|disappears/i;
const unreliable = (m: Move) => (m.accuracy !== true && m.accuracy < 80) || UNRELIABLE_TEXT.test(m.shortDesc);

/** Four damaging moves for a species, best first, preferring a different type per slot. */
export function defaultMoves(dex: Dex, species: Pokemon, regulationId: string | undefined, physical: boolean): string[] {
  const want = physical ? 'Physical' : 'Special';
  const pool = dex
    .learnset(species.id, regulationId)
    .filter((m) => m.category === want && m.basePower >= 55 && !unreliable(m));
  const power = (m: Move) => m.basePower * (species.types.includes(m.type as TypeName) ? 1.5 : 1)
  pool.sort((a, b) => power(b) - power(a) || a.id.localeCompare(b.id));
  const picked: Move[] = [];
  const seen = new Set<string>();
  for (const m of pool) {
    if (picked.length === 4) break;
    if (seen.has(m.type)) continue;
    seen.add(m.type);
    picked.push(m);
  }
  return picked.map((m) => m.id);
}

/** A generic attacker: its stronger attacking side maxed, Speed maxed, no item. */
export function defaultSet(dex: Dex, speciesId: string, format: FormatRules): PokemonSet {
  const species = dex.species(speciesId)!;
  const physical = species.baseStats.atk >= species.baseStats.spa;
  const base = createSet(dex, speciesId, format);
  const moves = defaultMoves(dex, species, format.regulationId, physical);
  return {
    ...base,
    nature: physical ? 'Adamant' : 'Modest',
    sp: { hp: 2, atk: physical ? 32 : 0, def: 0, spa: physical ? 0 : 32, spd: 0, spe: 32 },
    moves: [...moves, '', '', '', ''].slice(0, 4) as PokemonSet['moves'],
  };
}

/** A target (an opponent) for a species: its meta set when there is one, else the default build. */
export function targetFor(dex: Dex, format: FormatRules, speciesId: string, snapshot?: MetaSnapshot): SearchTarget {
  const entry = snapshot?.entries.find((e) => e.speciesId === speciesId);
  const m = entry && metaSet(entry, dex, format);
  if (m) return { speciesId, set: m.set, megaMode: m.megaMode };
  const set = defaultSet(dex, speciesId, format);
  return { speciesId, set, megaMode: format.capabilities.mega && dex.megaFor(speciesId, set.itemId) ? 'both' : 'base' };
}

/** Every species the format allows as a candidate, meta-backed ones first (by usage). */
export function buildCandidates(dex: Dex, format: FormatRules, snapshot?: MetaSnapshot): Candidate[] {
  const out: Candidate[] = [];
  for (const species of dex.selectableSpecies(format.regulationId)) {
    const entry = snapshot?.entries.find((e) => e.speciesId === species.id);
    const m = entry && metaSet(entry, dex, format);
    if (m) {
      out.push({ speciesId: species.id, set: m.set, megaMode: m.megaMode, build: 'meta', usagePct: m.usagePct });
      continue;
    }
    const set = defaultSet(dex, species.id, format);
    if (!set.moves[0]) continue; // nothing worth attacking with: not a sensible answer to "one-shots"
    out.push({ speciesId: species.id, set, megaMode: 'base', build: 'default', usagePct: 0 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checking conditions
// ---------------------------------------------------------------------------

export interface ConditionResult {
  conditionId: string;
  pass: boolean;
  /** One line of evidence: "Close Combat 112–132%", "takes at most 38% from Flare Blitz". */
  detail: string;
}

export interface Match {
  candidate: Candidate;
  results: ConditionResult[];
  /** Sum of the margins (bigger = more comfortable); the tie-break after usage. */
  score: number;
}

const pct = ([lo, hi]: [number, number]) => (lo === hi ? `${Math.round(lo)}%` : `${Math.round(lo)}–${Math.round(hi)}%`);

/** The types a target attacks with: its damaging moves, else its own types (STAB). */
export function attackingTypes(dex: Dex, t: SearchTarget): TypeName[] {
  const fromMoves = t.set.moves.flatMap((id) => {
    const m = dex.move(id);
    return m && m.category !== 'Status' ? [m.type as TypeName] : [];
  });
  const types = fromMoves.length ? fromMoves : (dex.species(t.speciesId)?.types ?? []);
  return [...new Set(types)];
}

/** Does the candidate resist (take ≤ ½ from) every type the target attacks with? */
export function resistCheck(dex: Dex, cand: Candidate, target: SearchTarget): { pass: boolean; detail: string } {
  const attacks = attackingTypes(dex, target);
  if (!attacks.length) return { pass: false, detail: 'target has no attacking types' };
  const forms = [dex.species(cand.speciesId)];
  if (cand.megaMode !== 'base') {
    const mega = dex.megaFor(cand.speciesId, cand.set.itemId);
    if (mega) forms.push(mega);
  }
  const worst = new Map<string, number>();
  for (const f of forms) {
    if (!f) continue;
    for (const t of attacks) worst.set(t, Math.max(worst.get(t) ?? 0, dex.effectiveness(t, f.types)));
  }
  const bad = [...worst].filter(([, e]) => e > 0.5);
  const fmt = (e: number) => (e === 0 ? 'immune' : `${e}×`);
  return {
    pass: bad.length === 0,
    detail: bad.length ? bad.map(([t, e]) => `${t} ${fmt(e)}`).join(', ') : [...worst].map(([t, e]) => `${t} ${fmt(e)}`).join(', '),
  };
}

function checkCell(cond: Condition, cell: ThreatCell): { pass: boolean; detail: string; margin: number } {
  switch (cond.kind) {
    case 'ohko': {
      const m = cell.mine;
      const pass = !!m && (m.kill === 'ohko' || (!!cond.allowPossible && m.kill === 'pohko'));
      return { pass, detail: m ? `${m.move} ${pct(m.percent)}` : 'no damaging move', margin: m ? m.percent[0] - 100 : -100 };
    }
    case 'survive': {
      const hits = cond.hits ?? 1;
      const t = cell.theirs;
      const pass = !t || (hits === 1 ? t.kill !== 'ohko' && t.kill !== 'pohko' : t.kill === '3hko' || t.kill === 'none');
      const dmg = t ? t.percent[1] : 0;
      return { pass, detail: t ? `takes up to ${Math.round(dmg * hits)}% from ${t.move}${hits === 2 ? ' ×2' : ''}` : 'takes nothing', margin: 100 - dmg * hits };
    }
    case 'outspeed':
      return { pass: cell.first === 'me', detail: `${cell.mySpeed} vs ${cell.theirSpeed}`, margin: cell.mySpeed - cell.theirSpeed };
    default:
      return { pass: false, detail: '', margin: 0 };
  }
}

/**
 * All conditions for one candidate, or undefined as soon as one fails (a search only keeps full
 * matches). Calc cells are computed once per target and shared by the conditions on that target.
 */
export function evaluateCandidate(dex: Dex, cand: Candidate, conditions: Condition[], field: FieldConditions): Match | undefined {
  const cells = new Map<string, ThreatCell>();
  const results: ConditionResult[] = [];
  let score = 0;
  for (const cond of conditions) {
    let r: { pass: boolean; detail: string; margin?: number };
    if (cond.kind === 'resist') r = resistCheck(dex, cand, cond.target);
    else {
      let cell = cells.get(cond.target.set.uid);
      if (!cell) {
        cell = computeCell(dex, cand.set, cond.target, field);
        cells.set(cond.target.set.uid, cell);
      }
      r = checkCell(cond, cell);
    }
    if (!r.pass) return undefined;
    results.push({ conditionId: cond.id, pass: true, detail: r.detail });
    score += Math.max(-100, Math.min(100, r.margin ?? 0));
  }
  return { candidate: cand, results, score };
}

/** Meta-backed answers first (by usage), then default builds; ties by comfort, then name. */
export function rankMatches(matches: Match[]): Match[] {
  return [...matches].sort(
    (a, b) =>
      Number(b.candidate.build === 'meta') - Number(a.candidate.build === 'meta') ||
      b.candidate.usagePct - a.candidate.usagePct ||
      b.score - a.score ||
      a.candidate.speciesId.localeCompare(b.candidate.speciesId),
  );
}

/** Plain-language sentence for a condition ("survives Rillaboom's best move"). */
export function describeCondition(dex: Dex, c: Condition): string {
  const name = dex.species(c.target.speciesId)?.name ?? c.target.speciesId;
  switch (c.kind) {
    case 'ohko':
      return `${c.allowPossible ? 'Can one-shot' : 'One-shots'} ${name}`;
    case 'survive':
      return `Survives ${(c.hits ?? 1) === 2 ? 'two hits from' : 'a hit from'} ${name}`;
    case 'resist':
      return `Resists ${name}'s attacking types`;
    case 'outspeed':
      return `Outspeeds ${name}`;
  }
}
