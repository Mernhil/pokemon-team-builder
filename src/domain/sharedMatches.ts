/**
 * Whose matches a view of the match log shows. A friend's matches (shared by them, read-only) are
 * only ever shown on their own or together with mine when I pick "Both of us": the default is always
 * just my own log, so my stats are never mixed with anyone else's by accident.
 */
import type { Match } from './matches';

/** 'mine', `friend:<e-mail>` (only theirs) or `both:<e-mail>` (mine and theirs). */
export type MatchSource = 'mine' | `friend:${string}` | `both:${string}`;

export interface Friend {
  owner: string;
  name?: string;
}
export const friendLabel = (f: Friend) => f.name || f.owner;

export interface SourceOption {
  value: MatchSource;
  label: string;
}

/** The options to offer: just "My matches" until someone shares theirs. */
export function matchSourceOptions(friends: Friend[]): SourceOption[] {
  const out: SourceOption[] = [{ value: 'mine', label: 'My matches' }];
  for (const f of friends) out.push({ value: `friend:${f.owner}`, label: `${friendLabel(f)}'s matches` });
  for (const f of friends) out.push({ value: `both:${f.owner}`, label: `Both of us (me + ${friendLabel(f)})` });
  return out;
}

/** Falls back to 'mine' for a source whose friend has stopped sharing, so a stale choice can't show nothing. */
export function validSource(source: MatchSource, friends: Friend[]): MatchSource {
  if (source === 'mine') return source;
  const owner = source.slice(source.indexOf(':') + 1);
  return friends.some((f) => f.owner === owner) ? source : 'mine';
}

export function selectMatches(source: MatchSource, mine: Match[], friends: Record<string, Match[]>): Match[] {
  if (source === 'mine') return mine;
  const owner = source.slice(source.indexOf(':') + 1);
  const theirs = Object.hasOwn(friends, owner) ? friends[owner] : [];
  return source.startsWith('friend:') ? theirs : [...mine, ...theirs];
}

/** Matches that belong to someone else are read-only. */
export const isFriendMatch = (source: MatchSource) => source.startsWith('friend:');
