/**
 * Sync merge rules, pure and heavily tested (src/domain/__tests__/sync.test.ts).
 *
 * Teams and matches are documents. A document is "last write wins" by `updatedAt`, a delete is a
 * tombstone that is just another version, and nothing is ever silently lost:
 *  - when both sides changed a team since the last sync, the losing version is kept as a variation
 *    labelled "Conflict copy (<device>, <date>)";
 *  - an edit beats a delete unless the delete is clearly later (more than SKEW_MS), so clock drift
 *    between two devices can't throw an edit away;
 *  - matches follow the same rule without conflict copies.
 */
import { cloneTeam } from './team';
import type { DocKind, RemoteDocument } from './syncProtocol';
import type { Team } from './types';

/** Two clocks this close are treated as the same moment: neither device's time is trusted over the other's. */
export const SKEW_MS = 5000;

export interface LocalDoc {
  id: string;
  kind: DocKind;
  updatedAt: number;
  json: unknown;
}

/** What was last synced for a document: its version's `updatedAt`. */
export interface Known {
  updatedAt: number;
}

export type Resolution =
  /** Nothing to do. */
  | { action: 'noop' }
  /** The server's version replaces (or creates) the local one. */
  | { action: 'apply-remote' }
  /** The server's version is a delete: remove the local document. */
  | { action: 'delete-local' }
  /** The local version stands and is pushed (a local edit, or a local delete). */
  | { action: 'push-local' }
  /**
   * Both changed. `winner` stays as the document; the other one is kept as a conflict copy (teams)
   * or dropped (matches, `copy: false`). A winning local version is pushed with a newer `updatedAt`.
   */
  | { action: 'conflict'; winner: 'local' | 'remote'; copy: boolean };

/** JSON compared by value, ignoring key order and `updatedAt` (so a re-save with nothing changed is the same document). */
export function sameContent(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => k !== 'updatedAt')
          .sort(([x], [y]) => x.localeCompare(y))
          .map(([k, x]) => [k, norm(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * What to do with one document the server has a (changed) version of. `local` is undefined when the
 * document isn't here: never seen (`base` undefined too, so a first sync or a document made elsewhere)
 * or deleted here since the last sync (`base` set; the delete counts as happening at `now`).
 */
export function resolveDocument(input: { local?: LocalDoc; remote: RemoteDocument; base?: Known; now: number; skewMs?: number }): Resolution {
  const { local, remote, base, now } = input;
  const skew = input.skewMs ?? SKEW_MS;
  const copy = remote.kind === 'team';

  // The server's version is one we already have (our own push coming back, or a re-pull).
  const remoteChanged = !base || remote.updatedAt > base.updatedAt;
  if (!remoteChanged) return { action: 'noop' };

  // ---- Not here ----
  if (!local) {
    if (!base) return remote.deleted ? { action: 'noop' } : { action: 'apply-remote' };
    // Deleted here since the last sync, changed there.
    if (remote.deleted) return { action: 'noop' }; // deleted on both sides
    return now > remote.updatedAt + skew ? { action: 'push-local' } : { action: 'apply-remote' }; // a clearly later delete wins; otherwise the edit does
  }

  const localChanged = !base || local.updatedAt > base.updatedAt;

  // ---- Deleted there ----
  if (remote.deleted) {
    if (!localChanged) return { action: 'delete-local' };
    // Edited here, deleted there: the edit survives unless the delete is clearly later.
    return remote.updatedAt > local.updatedAt + skew ? { action: 'delete-local' } : { action: 'push-local' };
  }

  // ---- Live on both sides ----
  if (!localChanged) return { action: 'apply-remote' };
  if (sameContent(local.json, remote.json)) return { action: 'apply-remote' }; // identical: just adopt the server's version stamp
  // Both changed since the last sync: the later one is the document, the other is kept as a copy.
  // Inside the skew window the server's version wins (neither clock is trusted).
  const localWins = local.updatedAt > remote.updatedAt + skew;
  return { action: 'conflict', winner: localWins ? 'local' : 'remote', copy };
}

/** "Conflict copy (this device, 2026-10-03)". */
export const conflictLabel = (deviceName: string, now: number) => `Conflict copy (${deviceName}, ${new Date(now).toISOString().slice(0, 10)})`;

/**
 * The losing version of a team as a new variation of the winner's folder, so it is never lost:
 * a fresh id (and Pokémon ids), the same name, labelled as a conflict copy.
 */
export function conflictCopy(loser: Team, winner: Team, deviceName: string, now: number): Team {
  // Stamped with the sync's clock (not Date.now), like everything else the sync writes.
  return { ...cloneTeam(loser, loser.name, { groupId: winner.groupId ?? winner.id, variationLabel: conflictLabel(deviceName, now) }), createdAt: now, updatedAt: now };
}

// ---------------------------------------------------------------------------
// What changed here
// ---------------------------------------------------------------------------

export interface LocalChange {
  id: string;
  kind: DocKind;
  updatedAt: number;
  deleted: boolean;
  json?: unknown;
}

const keyOf = (kind: DocKind, id: string) => `${kind}:${id}`;
export { keyOf as docKey };

/**
 * The documents to push: new or edited since the last sync, plus tombstones for documents that were
 * synced before and are gone now (a delete happens "now", since the stores keep no deletion time).
 */
export function localChanges(local: LocalDoc[], known: Record<string, Known>, now: number): LocalChange[] {
  const out: LocalChange[] = [];
  const present = new Set<string>();
  for (const d of local) {
    const k = keyOf(d.kind, d.id);
    present.add(k);
    const base = known[k];
    if (!base || d.updatedAt > base.updatedAt) out.push({ id: d.id, kind: d.kind, updatedAt: d.updatedAt, deleted: false, json: d.json });
  }
  for (const k of Object.keys(known)) {
    if (present.has(k)) continue;
    const [kind, ...rest] = k.split(':');
    // A tombstone must be newer than the version it replaces, whatever the clock says.
    out.push({ id: rest.join(':'), kind: kind as DocKind, updatedAt: Math.max(now, known[k].updatedAt + 1), deleted: true });
  }
  return out;
}
