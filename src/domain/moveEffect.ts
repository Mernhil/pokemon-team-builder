import type { Move, MoveBoosts, MoveSecondaryEffect, StatusId } from './types';

/**
 * Champions-style move effect text, generated from structured move data so it always reflects
 * this game's numbers (e.g. Iron Head's flinch chance is 20% here, not the standard 30%).
 * Falls back to Showdown's shortDesc when the effect can't be expressed this way (field moves,
 * recharge/trap volatiles, self-only utility with no stat change, …).
 */
export function formatMoveEffect(move: Move): string {
  const sentences: string[] = [];

  if (move.boosts) sentences.push(...formatGuaranteedBoosts(move.boosts, move.target === 'self' ? 'user' : 'target'));
  if (move.self?.boosts) sentences.push(...formatGuaranteedBoosts(move.self.boosts, 'user'));

  if (move.status) {
    const phrase = STATUS_VERB[move.status];
    if (phrase) sentences.push(`${phrase.declarative} the target.`);
  }
  if (move.volatileStatus) {
    const phrase = VOLATILE_VERB[move.volatileStatus];
    if (phrase) sentences.push(`${phrase.declarative} the target.`);
  }

  for (const secondary of move.secondaries ?? []) {
    const text = formatSecondary(secondary);
    if (text) sentences.push(text);
  }

  return sentences.length ? sentences.join(' ') : move.shortDesc;
}

// ---------------------------------------------------------------------------
// Stat boosts
// ---------------------------------------------------------------------------

const STAT_NAME: Record<keyof MoveBoosts, string> = {
  atk: 'Attack',
  def: 'Defense',
  spa: 'Sp. Atk',
  spd: 'Sp. Def',
  spe: 'Speed',
  accuracy: 'accuracy',
  evasion: 'evasiveness',
};

function joinStatChanges(entries: [string, number][]): string {
  return entries
    .map(([stat, v]) => `${STAT_NAME[stat as keyof MoveBoosts]} by ${Math.abs(v)}`)
    .reduce((acc, part, i) => (i === 0 ? part : i === entries.length - 1 ? `${acc} and ${part}` : `${acc}, ${part}`), '');
}

function splitBoosts(boosts: MoveBoosts): { raises: [string, number][]; lowers: [string, number][] } {
  const entries = Object.entries(boosts).filter(([, v]) => v) as [string, number][];
  return { raises: entries.filter(([, v]) => v > 0), lowers: entries.filter(([, v]) => v < 0) };
}

/** Declarative sentences, e.g. "Raises the user's Speed by 2 and Attack by 1." */
function formatGuaranteedBoosts(boosts: MoveBoosts, subject: 'user' | 'target'): string[] {
  const { raises, lowers } = splitBoosts(boosts);
  const out: string[] = [];
  if (raises.length) out.push(`Raises the ${subject}'s ${joinStatChanges(raises)}.`);
  if (lowers.length) out.push(`Lowers the ${subject}'s ${joinStatChanges(lowers)}.`);
  return out;
}

/** Infinitive phrase for embedding after "chance to …", e.g. "lower the target's Speed by 1". */
function boostInfinitive(boosts: MoveBoosts, subject: 'user' | 'target'): string | undefined {
  const { raises, lowers } = splitBoosts(boosts);
  const parts: string[] = [];
  if (raises.length) parts.push(`raise the ${subject}'s ${joinStatChanges(raises)}`);
  if (lowers.length) parts.push(`lower the ${subject}'s ${joinStatChanges(lowers)}`);
  return parts.length ? parts.join(' and ') : undefined;
}

// ---------------------------------------------------------------------------
// Status / volatile conditions
// ---------------------------------------------------------------------------

const STATUS_VERB: Record<StatusId, { infinitive: string; declarative: string }> = {
  brn: { infinitive: 'burn', declarative: 'Burns' },
  par: { infinitive: 'paralyze', declarative: 'Paralyzes' },
  psn: { infinitive: 'poison', declarative: 'Poisons' },
  tox: { infinitive: 'badly poison', declarative: 'Badly poisons' },
  frz: { infinitive: 'freeze', declarative: 'Freezes' },
  slp: { infinitive: 'put to sleep', declarative: 'Puts the target to sleep' },
};

/** Volatile conditions common enough to word out; anything else falls back to shortDesc. */
const VOLATILE_VERB: Record<string, { infinitive: string; declarative: string }> = {
  flinch: { infinitive: 'make the target flinch', declarative: 'Makes the target flinch' },
  confusion: { infinitive: 'confuse the target', declarative: 'Confuses the target' },
  attract: { infinitive: 'infatuate the target', declarative: 'Infatuates the target' },
};

function statusPhrase(id: StatusId, guaranteed: boolean): string {
  const v = STATUS_VERB[id];
  if (guaranteed) return id === 'slp' ? `${v.declarative}.` : `${v.declarative} the target.`;
  return id === 'slp' ? v.infinitive : `${v.infinitive} the target`;
}

// ---------------------------------------------------------------------------
// Secondary (chance-based) effects
// ---------------------------------------------------------------------------

function formatSecondary(secondary: MoveSecondaryEffect): string | undefined {
  const { chance } = secondary;
  const guaranteed = chance >= 100;
  const clauses: string[] = [];

  if (secondary.status) clauses.push(statusPhrase(secondary.status, guaranteed));
  if (secondary.volatileStatus) {
    const v = VOLATILE_VERB[secondary.volatileStatus];
    if (v) clauses.push(guaranteed ? `${v.declarative}.` : v.infinitive);
  }
  if (secondary.boosts) {
    const b = boostInfinitive(secondary.boosts, 'target');
    if (b) clauses.push(guaranteed ? `${capitalize(b)}.` : b);
  }
  if (secondary.self?.boosts) {
    const b = boostInfinitive(secondary.self.boosts, 'user');
    if (b) clauses.push(guaranteed ? `${capitalize(b)}.` : b);
  }

  if (!clauses.length) return undefined;
  if (guaranteed) return clauses.join(' ');
  return `${chance}% chance to ${clauses.join(' and ')}.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
