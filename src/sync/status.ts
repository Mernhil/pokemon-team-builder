import type { SyncErrorKind } from './http';

/** Newer than this counts as "recent" (green); the app syncs about every 3 minutes while it is visible. */
export const RECENT_MS = 10 * 60_000;

export type SyncDot = 'good' | 'warn' | 'bad';

/**
 * The header dot: green = synced recently, amber = old (or never, or just offline: nothing is wrong with the
 * account, the device is only out of reach), red = an error that needs a look (sign-in, setup, the server).
 */
export function syncDot(s: { lastSyncAt?: number; lastErrorKind?: SyncErrorKind }, now: number): SyncDot {
  if (s.lastErrorKind && s.lastErrorKind !== 'offline') return 'bad';
  if (s.lastErrorKind === 'offline') return 'warn';
  return s.lastSyncAt !== undefined && now - s.lastSyncAt <= RECENT_MS ? 'good' : 'warn';
}

export const DOT_LABEL: Record<SyncDot, string> = { good: 'Synced recently', warn: 'Not synced recently', bad: 'Sync problem' };
