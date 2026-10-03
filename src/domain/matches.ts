/**
 * Manual match tracker: win/loss log with an opponent Team Preview encounter log.
 *
 * There is no API for real Champions battle logs, so entry is deliberately low-friction and
 * fully manual — every field beyond date/result is optional and editable later. Persisted the
 * same way as teams (see store/matchStore.ts): plain objects, sanitized on load.
 */

import { datasetCapabilities, type Capabilities } from './capabilities';
import { FORMATS, currentRegulation, formatForRegulation, regulationInfo } from './formats';
import { uid } from './team';
import type { TeraType } from './types';

export type MatchResult = 'win' | 'loss';

/** A Pokémon seen (mine or the opponent's) — everything but the species is optional. */
export interface LoggedMon {
  speciesId: string;
  itemId?: string;
  abilityId?: string;
  /** Moves seen in battle, in no particular order; not required to be 4. */
  moves?: string[];
  teraType?: TeraType;
}

export const ARCHETYPE_PRESETS = [
  'Trick Room',
  'Rain',
  'Sun',
  'Sand',
  'Hail/Snow',
  'Tailwind',
  'Hyper Offense',
  'Bulky Offense',
  'Balance',
  'Stall',
] as const;

export const CATEGORY_PRESETS = ['Ranked Ladder', 'Regular', 'Tournament'] as const;

export interface Match {
  id: string;
  /** ISO date (yyyy-mm-dd). The only other required field is `result`. */
  date: string;
  result: MatchResult;
  /** Regulation live on `date`, auto-suggested but user-overridable. */
  regulationId?: string;
  /** Freeform tag: ranked ladder / regular / tournament, or anything else — never forced. */
  category?: string;
  /** Opponent/event free text, e.g. "Locals R3" or an opponent's handle. */
  eventName?: string;
  /** Reference to one of my saved teams — mutually exclusive with `myTeam`. */
  myTeamId?: string;
  /** Free-form "run and gun" list of species when this match isn't tied to a saved build. */
  myTeam?: LoggedMon[];
  myArchetype?: string;
  /** Species seen at Team Preview, with whatever else was learned during the game. */
  opponentTeam: LoggedMon[];
  opponentArchetype?: string;
  /**
   * Which of the six each side brought and led (all optional; a match with only a result is valid).
   * Mine are Pokémon uids when `myTeamId` is set, else species ids from `myTeam`; the opponent's
   * are species ids from `opponentTeam`. Leads are a subset of what was brought.
   */
  myBrought?: string[];
  myLeads?: string[];
  oppBrought?: string[];
  oppLeads?: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export function createMatch(date = new Date().toISOString().slice(0, 10)): Match {
  const now = Date.now();
  return {
    id: uid(),
    date,
    result: 'win',
    regulationId: suggestRegulationForDate(date),
    opponentTeam: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Battle gimmicks of a match's regulation; none when it has no (known) regulation. */
export const matchCapabilities = (regulationId?: string): Capabilities =>
  formatForRegulation(regulationId)?.capabilities ?? datasetCapabilities('');

/**
 * Drops what the match's game can't have (a revealed Tera Type outside Scarlet/Violet). Returns the
 * same object when nothing changes.
 */
export function enforceMatchCapabilities(m: Match): Match {
  if (matchCapabilities(m.regulationId).tera) return m;
  const strip = (mons: LoggedMon[]) => (mons.some((x) => x.teraType !== undefined) ? mons.map(({ teraType: _dropped, ...rest }) => rest) : mons);
  const opponentTeam = strip(m.opponentTeam);
  const myTeam = m.myTeam && strip(m.myTeam);
  return opponentTeam === m.opponentTeam && myTeam === m.myTeam ? m : { ...m, opponentTeam, myTeam };
}

/** The regulation live on a given date, for auto-suggesting (and overriding) a match's regulation. */
export function suggestRegulationForDate(date: string): string | undefined {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return currentRegulation(d)?.id;
}

/** "Clone last opponent" / "match against a previous entry": reuse a logged opponent core verbatim. */
export function cloneOpponentTeam(mons: LoggedMon[]): LoggedMon[] {
  return mons.map((m) => ({ ...m, moves: m.moves ? [...m.moves] : undefined }));
}

// ---------------------------------------------------------------------------
// Brought and led
// ---------------------------------------------------------------------------

export interface BringSelection {
  brought: string[];
  leads: string[];
}
export interface BringLimits {
  /** How many of the six are brought, and how many of those lead. */
  bring: number;
  lead: number;
}
export type BringState = 'none' | 'brought' | 'lead';

/** Doubles: bring 4, lead 2. Singles: bring 3, lead 1. Taken from the match's regulation (doubles when unknown). */
export function bringLimits(regulationId?: string): BringLimits {
  const f = FORMATS.find((x) => x.regulationId === regulationId);
  if (f?.gameType === 'singles') return { bring: 3, lead: 1 };
  return { bring: f?.pick ?? 4, lead: 2 };
}

export const bringState = (sel: BringSelection, id: string): BringState => (sel.leads.includes(id) ? 'lead' : sel.brought.includes(id) ? 'brought' : 'none');

/**
 * One tap on a Pokémon: not brought → brought → lead → not brought. A step that would break a limit
 * is skipped (brought with the leads full goes back to not brought; not brought with the roster full stays put).
 */
export function cycleBring(sel: BringSelection, id: string, limits: BringLimits): BringSelection {
  const state = bringState(sel, id);
  if (state === 'none') return sel.brought.length < limits.bring ? { ...sel, brought: [...sel.brought, id] } : sel;
  if (state === 'brought') {
    if (sel.leads.length < limits.lead) return { ...sel, leads: [...sel.leads, id] };
    return { brought: sel.brought.filter((x) => x !== id), leads: sel.leads };
  }
  return { brought: sel.brought.filter((x) => x !== id), leads: sel.leads.filter((x) => x !== id) };
}

/** Drops duplicates, anything not on the roster, and leads that weren't brought; caps to the limits. */
export function normalizeBring(sel: BringSelection, roster: string[], limits: BringLimits): BringSelection {
  const brought = [...new Set(sel.brought)].filter((id) => roster.includes(id)).slice(0, limits.bring);
  const leads = [...new Set(sel.leads)].filter((id) => brought.includes(id)).slice(0, limits.lead);
  return { brought, leads };
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export interface WinRate {
  wins: number;
  losses: number;
  total: number;
  rate: number; // 0–1, NaN-safe (0 when total === 0)
}

function toWinRate(matches: Match[]): WinRate {
  const wins = matches.filter((m) => m.result === 'win').length;
  const losses = matches.length - wins;
  return { wins, losses, total: matches.length, rate: matches.length ? wins / matches.length : 0 };
}

export const overallWinRate = (matches: Match[]): WinRate => toWinRate(matches);

export function winRateByRegulation(matches: Match[]): Map<string, WinRate> {
  const byReg = new Map<string, Match[]>();
  for (const m of matches) {
    const key = m.regulationId ?? '—';
    byReg.set(key, [...(byReg.get(key) ?? []), m]);
  }
  return new Map([...byReg.entries()].map(([k, v]) => [k, toWinRate(v)]));
}

export function winRateByTeam(matches: Match[]): Map<string, WinRate> {
  const byTeam = new Map<string, Match[]>();
  for (const m of matches) {
    if (!m.myTeamId) continue;
    byTeam.set(m.myTeamId, [...(byTeam.get(m.myTeamId) ?? []), m]);
  }
  return new Map([...byTeam.entries()].map(([k, v]) => [k, toWinRate(v)]));
}

export function winRateByArchetype(matches: Match[]): Map<string, WinRate> {
  const byArch = new Map<string, Match[]>();
  for (const m of matches) {
    if (!m.myArchetype) continue;
    byArch.set(m.myArchetype, [...(byArch.get(m.myArchetype) ?? []), m]);
  }
  return new Map([...byArch.entries()].map(([k, v]) => [k, toWinRate(v)]));
}

/** Personal meta snapshot: how often each opponent species has shown up. */
export function opponentSpeciesFrequency(matches: Match[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    for (const mon of m.opponentTeam) counts.set(mon.speciesId, (counts.get(mon.speciesId) ?? 0) + 1);
  }
  return counts;
}

/** Frequency of opponent species *pairs* seen together — a cheap proxy for "cores". */
export function opponentCoreFrequency(matches: Match[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) {
    const species = [...new Set(m.opponentTeam.map((x) => x.speciesId))].sort();
    for (let i = 0; i < species.length; i++) {
      for (let j = i + 1; j < species.length; j++) {
        const key = `${species[i]}+${species[j]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export const lossesOnly = (matches: Match[]): Match[] => matches.filter((m) => m.result === 'loss');

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

function csvCell(v: string): string {
  // Notes/event-name are free text a user could paste from anywhere; a leading =/+/-/@/tab/CR is how
  // spreadsheet apps trigger formula evaluation on open (CSV injection), so neutralise it defensively.
  const escaped = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(escaped) ? `"${escaped.replace(/"/g, '""')}"` : escaped;
}

const monLabel = (m: LoggedMon, speciesName: (id: string) => string, tera: boolean) =>
  [speciesName(m.speciesId), m.itemId, m.abilityId, tera ? m.teraType : undefined, ...(m.moves ?? [])].filter(Boolean).join(' | ');

export function matchesToCSV(
  matches: Match[],
  speciesName: (id: string) => string,
  teamName: (id: string) => string,
  /** Name of one of my Pokémon by the id stored in myBrought/myLeads (a uid for saved teams); defaults to the species name. */
  myMonName: (m: Match, id: string) => string = (_m, id) => speciesName(id),
): string {
  const header = [
    'Date',
    'Result',
    'Regulation',
    'Category',
    'Event/Opponent',
    'My Archetype',
    'My Team',
    'Opponent Archetype',
    'Opponent Team',
    'My Brought',
    'My Leads',
    'Opponent Brought',
    'Opponent Leads',
    'Notes',
  ];
  const rows = matches.map((m) => [
    m.date,
    m.result,
    m.regulationId ? (regulationInfo(m.regulationId)?.shortName ?? m.regulationId) : '',
    m.category ?? '',
    m.eventName ?? '',
    m.myArchetype ?? '',
    m.myTeamId ? teamName(m.myTeamId) : (m.myTeam ?? []).map((x) => speciesName(x.speciesId)).join(' / '),
    m.opponentArchetype ?? '',
    m.opponentTeam.map((x) => monLabel(x, speciesName, matchCapabilities(m.regulationId).tera)).join(' / '),
    (m.myBrought ?? []).map((id) => myMonName(m, id)).join(' / '),
    (m.myLeads ?? []).map((id) => myMonName(m, id)).join(' / '),
    (m.oppBrought ?? []).map(speciesName).join(' / '),
    (m.oppLeads ?? []).map(speciesName).join(' / '),
    m.notes ?? '',
  ]);
  return [header, ...rows].map((r) => r.map((c) => csvCell(String(c))).join(',')).join('\n');
}
