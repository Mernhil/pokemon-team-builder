/**
 * Manual match tracker: win/loss log with an opponent Team Preview encounter log.
 *
 * There is no API for real Champions battle logs, so entry is deliberately low-friction and
 * fully manual — every field beyond date/result is optional and editable later. Persisted the
 * same way as teams (see store/matchStore.ts): plain objects, sanitized on load.
 */

import { currentRegulation, regulationInfo } from './formats';
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
  return /[",\n]/.test(escaped) ? `"${escaped.replace(/"/g, '""')}"` : escaped;
}

const monLabel = (m: LoggedMon, speciesName: (id: string) => string) =>
  [speciesName(m.speciesId), m.itemId, m.abilityId, m.teraType, ...(m.moves ?? [])].filter(Boolean).join(' | ');

export function matchesToCSV(matches: Match[], speciesName: (id: string) => string, teamName: (id: string) => string): string {
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
    m.opponentTeam.map((x) => monLabel(x, speciesName)).join(' / '),
    m.notes ?? '',
  ]);
  return [header, ...rows].map((r) => r.map((c) => csvCell(String(c))).join(',')).join('\n');
}
