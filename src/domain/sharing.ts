/**
 * Pure helpers for sharing teams and match logs between two players: who a copy belongs to, which
 * matches count in which source, and the wording of "X updated Y" notices.
 */
import type { Match } from './matches';
import type { Team } from './types';

/** A team someone else shared read-only: it can be opened and copied, never changed. */
export const isReadOnly = (t: Pick<Team, 'shared'> | undefined): boolean => !!t?.shared && t.shared.role !== 'edit';

/** Whose matches a view or the meta fallback counts. */
export type MatchSource = 'mine' | 'theirs' | 'both';
export const MATCH_SOURCE_LABEL: Record<MatchSource, string> = { mine: 'Mine', theirs: 'Theirs', both: 'Both of us' };

/** A friend's match, tagged with whose it is. */
export type SharedMatch = Match & { owner: string };

export function matchesForSource<T extends Match>(mine: T[], theirs: T[], source: MatchSource): T[] {
  if (source === 'mine') return mine;
  if (source === 'theirs') return theirs;
  return [...mine, ...theirs];
}

/** A display name, falling back to the e-mail address. */
export const nameOf = (email: string, names: Record<string, string>): string => names[email] || email;

/** "just now", "5 min ago", "2 h ago", "3 days ago". */
export function ago(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 90) return 'just now';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

export interface SharedChange {
  kind: 'team' | 'match';
  /** The document's name, for a team. */
  name?: string;
  owner: string;
  updatedAt: number;
  /** Was it already on this device (an update), or is it new to me? */
  existed: boolean;
}

/** Changes older than this are not news (a new device's first sync would otherwise announce everything). */
export const NEWS_WINDOW_MS = 7 * 24 * 3600 * 1000;
export const MAX_NOTICES = 3;

/**
 * The toasts for what the other person changed: one line per changed team (newest first, at most
 * three, then "and N more"). Match logs are not announced one by one.
 */
export function sharedNotices(changes: SharedChange[], names: Record<string, string>, now: number): string[] {
  const news = changes.filter((c) => c.kind === 'team' && now - c.updatedAt <= NEWS_WINDOW_MS).sort((a, b) => b.updatedAt - a.updatedAt);
  // A folder and its variations share a name: say it once.
  const seen = new Set<string>();
  const distinct = news.filter((c) => {
    const k = `${c.owner}|${c.name}|${c.existed}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const lines = distinct.slice(0, MAX_NOTICES).map((c) => {
    const who = nameOf(c.owner, names);
    const what = c.name ? `“${c.name}”` : 'a team';
    return c.existed ? `${who} updated ${what} ${ago(c.updatedAt, now)}.` : `${who} shared ${what} with you.`;
  });
  if (distinct.length > MAX_NOTICES) lines.push(`…and ${distinct.length - MAX_NOTICES} more shared ${distinct.length - MAX_NOTICES === 1 ? 'team' : 'teams'} changed.`);
  return lines;
}

/** The folders of a team list that are someone else's, grouped for "Shared with me": top-level teams with their variations. */
export function sharedFolders(teams: Record<string, Team>): { root: Team; variations: Team[] }[] {
  const shared = Object.values(teams).filter((t) => t.shared);
  const roots = shared.filter((t) => !t.groupId || !teams[t.groupId]?.shared);
  return roots
    .map((root) => ({ root, variations: shared.filter((t) => t.groupId === root.id).sort((a, b) => b.updatedAt - a.updatedAt) }))
    .sort((a, b) => b.root.updatedAt - a.root.updatedAt);
}
