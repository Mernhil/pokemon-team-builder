import { ago } from '@/domain/sharing';
import type { SyncStats } from './engine';
import type { SyncErrorKind } from './http';

export interface DiagnosticsInput {
  appVersion: string;
  cursor: number;
  knownDocs: number;
  lastAttemptAt?: number;
  lastSyncAt?: number;
  lastError?: string;
  lastErrorKind?: SyncErrorKind;
  lastErrorStatus?: number;
  lastStats?: SyncStats;
  /** The line from /api/health, when it was fetched. */
  server?: string;
  online?: boolean;
}

/** E-mail addresses and device tokens, in case an error message ever carries one. */
export const scrub = (text: string): string => text.replace(/[^\s@()<>,;:'"]+@[^\s@()<>,;:'"]+/g, '[e-mail]').replace(/ptbd_[A-Za-z0-9_-]+/g, '[token]');

const at = (t: number | undefined, now: number) => (t === undefined ? 'never' : `${new Date(t).toISOString()} (${ago(t, now)})`);
export const statusText = (status: number | undefined): string => (status === undefined ? 'no answer' : status === 0 ? 'redirected to the sign-in page' : `HTTP ${status}`);

/** The text "Copy diagnostics" puts on the clipboard: counts, times and the last error. No tokens, no e-mail addresses, no documents. */
export function diagnosticsText(d: DiagnosticsInput, now = Date.now()): string {
  const lines = [
    `Pokémon Team Builder ${d.appVersion} · sync diagnostics`,
    `Cursor: ${d.cursor}`,
    `Known documents: ${d.knownDocs}`,
    `Last attempt: ${at(d.lastAttemptAt, now)}`,
    `Last successful sync: ${at(d.lastSyncAt, now)}`,
    d.lastStats ? `Last successful run: pulled ${d.lastStats.pulled}, applied ${d.lastStats.updated}, deleted ${d.lastStats.deleted}, pushed ${d.lastStats.pushed}, conflict copies ${d.lastStats.conflicts}` : 'Last successful run: none since this app started',
    d.lastError ? `Last error: ${scrub(d.lastError)} (${d.lastErrorKind ?? 'other'}, ${statusText(d.lastErrorStatus)})` : 'Last error: none',
    `Server: ${d.server ?? 'not checked'}`,
    `Network: ${d.online === undefined ? 'unknown' : d.online ? 'online' : 'offline'}`,
  ];
  return lines.join('\n');
}
