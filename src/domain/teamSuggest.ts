/**
 * "Complete my team": given 1–5 Pokémon, who fills the empty slots, and why. Pure and React-free.
 *
 * Candidates are the regulation's Pokémon with meta data, each on its most-used set (or, optionally,
 * every legal Pokémon on the generic build Reverse search uses). Every candidate is scored on five
 * components, each shown in the UI with a reason, and weighted by WEIGHTS (the one place to tune):
 *
 *  - synergy:   how often it's on teams with the team's members (metaPartners);
 *  - defense:   resists or is immune to the types the team is weak to, abilities included;
 *  - offense:   hits super-effectively the types the team can't;
 *  - roles:     what the team lacks: speed control, Fake Out, Intimidate, redirection, Wide Guard;
 *  - threats:   OHKOs, or outspeeds and 2HKOs, the top threats that currently beat several members.
 *
 * The first four are cheap and rank everyone at once (`suggestCheap`); the last needs the damage
 * engine, so only a shortlist (`SHORTLIST_CAP`) goes through it, in the threat worker (see
 * `threatJobFor` / `applyThreatAnswers`). Rules: a species already on the team, an item already
 * held (when the format has the item clause) and anything illegal in the format are never suggested;
 * a second Mega Stone holder is allowed but noted: only one Pokémon can Mega Evolve per battle.
 */
import type { Dex } from '@/data/dex';
import { defaultField } from './battle/conditions';
import { defensiveCoverage, offensiveCoverage } from './coverage';
import type { MetaEntry, MetaSnapshot } from './meta';
import { metaPartners } from './meta';
import type { MetaSet } from './metaSets';
import { buildCandidates, type Candidate } from './reverseSearch';
import { controlOf, supportOf, type ControlKind, type SupportKind } from './roles';
import { createTeam } from './team';
import type { ThreatCell, ThreatJob } from './threats';
import type { FormatRules, PokemonSet, Team } from './types';

/** How much each component counts in the total (all in 0–1 before weighting). */
export const WEIGHTS = { synergy: 3, defense: 3, offense: 2, roles: 2, threats: 3 } as const;
export type ComponentId = keyof typeof WEIGHTS;
/** A second Mega Stone holder is allowed but worth a little less (only one Mega Evolves per battle). */
export const SECOND_MEGA_PENALTY = 0.4;
/** How many of the cheap ranking go through the damage engine. */
export const SHORTLIST_CAP = 12;
/** Suggestions shown. */
export const TOP_N = 10;
/** Reasons shown on a card. */
export const MAX_REASONS = 3;
/** The threats checked: the ones that beat at least this many of the team's members, at most this many of them. */
export const MIN_BEATEN = 2;
export const MAX_THREATS = 5;

/** What one extra role is worth, 0–1 (summed and capped at 1). */
const ROLE_WEIGHT: Record<ControlKind | SupportKind | 'speed control', number> = {
  'speed control': 1,
  Tailwind: 1,
  'Trick Room': 1,
  'Icy Wind': 1,
  Electroweb: 1,
  'Fake Out': 0.8,
  Intimidate: 0.7,
  redirection: 0.7,
  'Wide Guard': 0.3,
};
const ROLES = ['speed control', 'Fake Out', 'Intimidate', 'redirection', 'Wide Guard'] as const;
type Role = (typeof ROLES)[number];

const rolesOf = (s: Pick<PokemonSet, 'moves' | 'abilityId'>): Role[] => {
  const out = new Set<Role>();
  if (controlOf(s).length) out.add('speed control');
  for (const k of supportOf(s)) out.add(k);
  return [...out];
};

export interface Reason {
  component: ComponentId;
  text: string;
}

export interface Suggestion {
  speciesId: string;
  /** The set it would be added with: its most-used set (or the generic build). */
  set: PokemonSet;
  build: 'meta' | 'default';
  /** Score of each component, 0–1. */
  parts: Record<ComponentId, number>;
  /** Weighted total (higher is better). */
  total: number;
  /** Why, strongest first (every component that contributed has one). */
  reasons: Reason[];
  /** Plain notes: a second Mega Stone, an item changed for the item clause. */
  notes: string[];
}

export interface SuggestInput {
  dex: Dex;
  format: FormatRules;
  team: Team;
  snapshot?: MetaSnapshot;
  /** Every legal Pokémon, not just those with meta data. */
  includeAll?: boolean;
}

const nameOf = (dex: Dex, id: string) => dex.species(id)?.name ?? id;
const listJoin = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

const filled = (team: Team) => team.slots.flatMap((s) => (s ? [s] : []));
const asTeam = (format: FormatRules, set: PokemonSet): Team => ({ ...createTeam(format), slots: [set, null, null, null, null, null] });

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface TeamCandidate {
  speciesId: string;
  set: PokemonSet;
  build: 'meta' | 'default';
  notes: string[];
}

/**
 * The legal Pokémon that could join: not already on the team (species clause), on their most-used
 * set with an item the team doesn't already hold (item clause: the next most-used legal item, or
 * none), and flagged when they'd be a second Mega. Sorted by species id, so everything after is deterministic.
 */
export function teamCandidates({ dex, format, team, snapshot, includeAll }: SuggestInput): TeamCandidate[] {
  const members = filled(team);
  const onTeam = new Set(members.map((m) => m.speciesId));
  const heldItems = new Set(members.flatMap((m) => (m.itemId ? [m.itemId] : [])));
  const hasMega = format.capabilities.mega && members.some((m) => !!dex.megaFor(m.speciesId, m.itemId));
  const all: Candidate[] = buildCandidates(dex, format, snapshot).filter((c) => includeAll || c.build === 'meta');
  const out: TeamCandidate[] = [];
  for (const c of all) {
    if (format.clauses.species && onTeam.has(c.speciesId)) continue;
    const notes: string[] = [];
    let set = c.set;
    if (format.clauses.item && set.itemId && heldItems.has(set.itemId)) {
      const entry = snapshot?.entries.find((e) => e.speciesId === c.speciesId);
      const alt = entry && freeItem(dex, format, c.speciesId, entry, heldItems);
      const was = dex.item(set.itemId)?.name ?? set.itemId;
      set = { ...set, itemId: alt };
      notes.push(alt ? `${was} is already on your team (item clause), so ${dex.item(alt)?.name ?? alt} instead.` : `${was} is already on your team (item clause), so no item.`);
    }
    if (hasMega && format.capabilities.mega && dex.megaFor(c.speciesId, set.itemId)) notes.push('Holds a Mega Stone: only one can Mega Evolve per battle.');
    out.push({ speciesId: c.speciesId, set, build: c.build, notes });
  }
  return out.sort((a, b) => a.speciesId.localeCompare(b.speciesId));
}

/** The most-used legal item of an entry that the team doesn't hold. */
function freeItem(dex: Dex, format: FormatRules, speciesId: string, entry: MetaEntry, taken: Set<string>): string | undefined {
  const reg = format.regulationId;
  for (const i of entry.items) {
    const item = dex.item(i.id);
    if (!item || taken.has(item.id) || (reg && !item.legalIn.includes(reg))) continue;
    if (item.megaStone && !dex.megaFor(speciesId, item.id)) continue;
    return item.id;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The cheap components
// ---------------------------------------------------------------------------

interface TeamNeeds {
  /** Types the team is weak to, with how many members are (shared weaknesses weigh more). */
  weak: { type: string; weight: number }[];
  /** Types none of the team's moves hit super-effectively. */
  gaps: string[];
  /** Roles nobody on the team fills. */
  missing: Role[];
}

/** What the team needs, from its type matrices and its roles. */
export function teamNeeds(team: Team, dex: Dex, format: FormatRules): TeamNeeds {
  const members = filled(team);
  const weak = defensiveCoverage(team, dex, format.capabilities.mega)
    .filter((r) => r.weak >= 2 || (r.weak >= 1 && r.resist === 0))
    .map((r) => ({ type: r.atkType as string, weight: r.weak - r.resist * 0.5 }))
    .filter((w) => w.weight > 0);
  const gaps = offensiveCoverage(team, dex, format.capabilities.mega)
    .filter((r) => r.superEffective === 0)
    .map((r) => r.defType as string);
  const have = new Set(members.flatMap((m) => rolesOf(m)));
  return { weak, gaps, missing: ROLES.filter((r) => !have.has(r)) };
}

interface Part {
  score: number;
  reason?: string;
}

function defenseOf(c: TeamCandidate, needs: TeamNeeds, dex: Dex, format: FormatRules): Part {
  if (!needs.weak.length) return { score: 0 };
  const row = defensiveCoverage(asTeam(format, c.set), dex, format.capabilities.mega);
  const total = needs.weak.reduce((a, w) => a + w.weight, 0);
  const covered: { type: string; immune: boolean; weight: number }[] = [];
  for (const w of needs.weak) {
    const m = row.find((r) => r.atkType === w.type)?.mults[0]?.mult;
    if (m !== undefined && m < 1) covered.push({ type: w.type, immune: m === 0, weight: w.weight });
  }
  if (!covered.length) return { score: 0 };
  const score = covered.reduce((a, x) => a + x.weight * (x.immune ? 1 : 0.8), 0) / total;
  const names = covered.map((x) => x.type);
  const immune = covered.filter((x) => x.immune).map((x) => x.type);
  const text = `Resists ${covered.length} of your ${needs.weak.length} weak ${needs.weak.length === 1 ? 'type' : 'types'} (${listJoin(names)})${immune.length ? `, immune to ${listJoin(immune)}` : ''}`;
  return { score: Math.min(1, score), reason: text };
}

function offenseOf(c: TeamCandidate, needs: TeamNeeds, dex: Dex, format: FormatRules): Part {
  if (!needs.gaps.length) return { score: 0 };
  const rows = offensiveCoverage(asTeam(format, c.set), dex, format.capabilities.mega);
  const hit = needs.gaps.filter((g) => (rows.find((r) => r.defType === g)?.hits[0]?.mult ?? 0) > 1);
  if (!hit.length) return { score: 0 };
  return { score: hit.length / needs.gaps.length, reason: `Hits ${listJoin(hit)} super-effectively, which your team can’t` };
}

function rolesScore(c: TeamCandidate, needs: TeamNeeds): Part {
  const provided = rolesOf(c.set).filter((r) => needs.missing.includes(r));
  if (!provided.length) return { score: 0 };
  const score = Math.min(1, provided.reduce((a, r) => a + ROLE_WEIGHT[r], 0));
  return { score, reason: `Adds ${listJoin(provided.map((r) => (r === 'speed control' ? controlOf(c.set).join('/') || 'speed control' : r)))}, which your team lacks` };
}

/**
 * Ranks every candidate on the four cheap components (the threat component is 0 until
 * `applyThreatAnswers`). Deterministic: ties break on the species id.
 */
export function suggestCheap(input: SuggestInput): Suggestion[] {
  const { dex, format, team, snapshot } = input;
  const members = filled(team);
  if (members.length === 0) return [];
  const needs = teamNeeds(team, dex, format);
  const partners = snapshot ? metaPartners(snapshot, members.map((m) => m.speciesId), 400) : [];
  const best = partners.reduce((a, p) => Math.max(a, p.score), 0);
  const partnerOf = new Map(partners.map((p) => [p.speciesId, p]));

  const out = teamCandidates(input).map((c): Suggestion => {
    const p = partnerOf.get(c.speciesId);
    const top = p?.with[0];
    const synergy: Part = p && best > 0
      ? {
          score: p.score / best,
          reason: top
            ? top.pct !== undefined
              ? `Paired with ${nameOf(dex, top.speciesId)} on ${Math.round(top.pct)}% of teams`
              : `A top-${top.rank} teammate of ${nameOf(dex, top.speciesId)}`
            : undefined,
        }
      : { score: 0 };
    const defense = defenseOf(c, needs, dex, format);
    const offense = offenseOf(c, needs, dex, format);
    const roles = rolesScore(c, needs);
    const parts: Suggestion['parts'] = { synergy: synergy.score, defense: defense.score, offense: offense.score, roles: roles.score, threats: 0 };
    const reasons: Reason[] = ([['synergy', synergy], ['defense', defense], ['offense', offense], ['roles', roles]] as const)
      .filter(([, x]) => x.score > 0 && x.reason)
      .map(([component, x]) => ({ component, text: x.reason! }));
    return finish({ speciesId: c.speciesId, set: c.set, build: c.build, parts, total: 0, reasons, notes: c.notes });
  });
  return out.sort(byTotal);
}

const secondMega = (s: Suggestion) => s.notes.some((n) => n.includes('Mega Stone'));

/** Recomputes the total and orders the reasons by what they contributed. */
function finish(s: Suggestion): Suggestion {
  const total = (Object.keys(WEIGHTS) as ComponentId[]).reduce((a, k) => a + WEIGHTS[k] * s.parts[k], 0) - (secondMega(s) ? SECOND_MEGA_PENALTY : 0);
  const reasons = s.reasons.slice().sort((a, b) => WEIGHTS[b.component] * s.parts[b.component] - WEIGHTS[a.component] * s.parts[a.component] || a.component.localeCompare(b.component));
  return { ...s, total: Math.round(total * 1000) / 1000, reasons };
}

const byTotal = (a: Suggestion, b: Suggestion) => b.total - a.total || a.speciesId.localeCompare(b.speciesId);

/** The ones worth the damage engine: the best of the cheap ranking, at most SHORTLIST_CAP. */
export const shortlist = (ranked: Suggestion[], cap = SHORTLIST_CAP): Suggestion[] => ranked.slice(0, Math.max(0, cap));

/** The chips for a card: its strongest reasons (2–3 when it has that many), then notes are shown apart. */
export const reasonChips = (s: Suggestion, max = MAX_REASONS): string[] => s.reasons.slice(0, max).map((r) => r.text);

// ---------------------------------------------------------------------------
// Threat answers (the expensive component, run on a shortlist in the worker)
// ---------------------------------------------------------------------------

export interface ProblemThreat {
  speciesId: string;
  /** How many of the team's members come off worse against it. */
  beats: number;
}

/**
 * The threats that beat several of the team's members: `rows[i]` are the cells of `threatIds[i]`
 * against each member (verdict ≤ −1.5 = bad for me). Worst first; at most MAX_THREATS.
 */
export function problemThreats(threatIds: string[], rows: (Pick<ThreatCell, 'verdict'>[] | undefined)[], minBeaten = MIN_BEATEN, max = MAX_THREATS): ProblemThreat[] {
  const out: ProblemThreat[] = [];
  threatIds.forEach((speciesId, i) => {
    const cells = rows[i];
    if (!cells) return;
    const beats = cells.filter((c) => c.verdict <= -1.5).length;
    if (beats >= Math.min(minBeaten, cells.length)) out.push({ speciesId, beats });
  });
  return out.sort((a, b) => b.beats - a.beats || a.speciesId.localeCompare(b.speciesId)).slice(0, max);
}

/**
 * The job that checks the shortlist against the problem threats: the shortlist as "members", the
 * problem threats as the threats (same engine and worker as the Threat report).
 */
export function threatJobFor(format: FormatRules, list: Suggestion[], threats: MetaSet[]): ThreatJob | undefined {
  if (!list.length || !threats.length) return undefined;
  return {
    datasetId: format.datasetId,
    formatId: format.id,
    members: list.map((s, slot) => ({ slot, set: s.set })),
    threats: threats.map((t) => ({ key: t.speciesId, speciesId: t.speciesId, usagePct: t.usagePct, usageRank: t.usageRank, set: t.set, megaMode: t.megaMode })),
    field: defaultField(),
  };
}

export type Answer = 'ohko' | 'outspeed2hko';

/** How a candidate fares against a threat, from the cell with it as "me": null when it doesn't answer it. */
export function answerOf(cell: Pick<ThreatCell, 'mine' | 'first'>): Answer | null {
  const kill = cell.mine?.kill;
  if (kill === 'ohko' || kill === 'pohko') return 'ohko';
  if (cell.first === 'me' && kill === '2hko') return 'outspeed2hko';
  return null;
}

/**
 * Adds the threat component. `threats[t]` is a problem threat, `rows[t][c]` the cell of shortlist
 * member `c` against it (undefined while that row is still being calculated). A candidate's score is
 * what share of the problem threats it answers (an OHKO counts fully, outspeeding and 2HKOing 0.7),
 * and the reason names the biggest one: "OHKOs Kingambit, which beats 4 of yours".
 */
export function applyThreatAnswers(dex: Dex, ranked: Suggestion[], list: Suggestion[], threats: ProblemThreat[], rows: (Pick<ThreatCell, 'mine' | 'first'>[] | undefined)[]): Suggestion[] {
  const done = threats.map((_, t) => rows[t]);
  const bySpecies = new Map<string, Suggestion>();
  list.forEach((s, c) => {
    const answers = threats.flatMap((th, t) => {
      const cell = done[t]?.[c];
      const a = cell && answerOf(cell);
      return a ? [{ threat: th, answer: a }] : [];
    });
    const possible = threats.filter((_, t) => !!done[t]).length;
    if (!possible) return;
    const score = answers.reduce((a, x) => a + (x.answer === 'ohko' ? 1 : 0.7), 0) / possible;
    const top = answers.slice().sort((a, b) => b.threat.beats - a.threat.beats || a.threat.speciesId.localeCompare(b.threat.speciesId))[0];
    const reasons = s.reasons.filter((r) => r.component !== 'threats');
    if (top) {
      const verb = top.answer === 'ohko' ? 'OHKOs' : 'Outspeeds and 2HKOs';
      reasons.push({ component: 'threats', text: `${verb} ${nameOf(dex, top.threat.speciesId)}, which beats ${top.threat.beats} of yours${answers.length > 1 ? ` (${answers.length} of ${possible} problem threats answered)` : ''}` });
    }
    bySpecies.set(s.speciesId, finish({ ...s, parts: { ...s.parts, threats: Math.min(1, score) }, reasons }));
  });
  return ranked.map((s) => bySpecies.get(s.speciesId) ?? s).sort(byTotal);
}
