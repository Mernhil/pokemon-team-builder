/**
 * One sync run: pull what changed on the server, merge it with what is here by the rules in
 * src/domain/sync.ts, write the result to the stores, then push what changed here. It knows nothing
 * about React, zustand or fetch: the stores and the server arrive as small interfaces, so the same
 * code is tested with two in-memory devices against the real Worker handler.
 */
import { conflictCopy, docKey, localChanges, resolveDocument, type Known, type LocalDoc } from '@/domain/sync';
import { LIMITS, type DocKind, type PullResponse, type PushDoc, type PushResponse, type RemoteDocument } from '@/domain/syncProtocol';
import type { Team } from '@/domain/types';

export interface LocalStore {
  list(): LocalDoc[];
  /** Writes merged documents (without bumping their `updatedAt`) and removes deleted ones. */
  apply(change: { upserts: LocalDoc[]; deletes: { kind: DocKind; id: string }[] }): void;
}

export interface SyncApi {
  pull(since: number): Promise<PullResponse>;
  /** `keepalive`: the request must be able to finish while the app is being suspended. */
  push(docs: PushDoc[], opts?: { keepalive?: boolean }): Promise<PushResponse>;
}

/** Thrown when a run was abandoned (a newer one replaced it): nothing of it may be written any more. */
export class RunAbandoned extends Error {
  constructor() {
    super('This sync run was replaced by a newer one.');
  }
}

/** A keepalive request body may not pass ~64 KB; stay clear of it. */
export const KEEPALIVE_MAX_BYTES = 60_000;
const bytes = (text: string) => new TextEncoder().encode(text).length;

export interface SyncState {
  /** The server sequence number the last pull reached. */
  cursor: number;
  /** For each document last synced, the `updatedAt` of that version. */
  known: Record<string, Known>;
}

export interface SyncStats {
  pulled: number;
  pushed: number;
  /** Documents the server's version replaced here. */
  updated: number;
  deleted: number;
  /** Conflict copies made (teams). */
  conflicts: number;
  /** The documents the server's version replaced or created here, for "X updated Y" notices. */
  changed: { kind: DocKind; id: string; updatedAt: number; existed: boolean }[];
}

export interface SyncDeps {
  store: LocalStore;
  api: SyncApi;
  state: SyncState;
  /** Called with the new state as soon as it is safe to remember it. */
  save: (state: SyncState) => void;
  deviceName: string;
  now?: () => number;
  /** False once this run was abandoned (src/sync/runControl.ts): checked after every await, before anything is written. */
  isCurrent?: () => boolean;
  /**
   * Send what changed here right now and stop (the app is going to the background): no pull first, the most recently
   * edited documents first, one request of at most `maxBytes` with keepalive. What does not fit goes on the next run.
   */
  flush?: { maxBytes: number };
  /** How a losing team version is kept; by default a variation of the winner's folder. */
  copyFor?: (loser: Team, winner: Team, deviceName: string, now: number) => Team;
}

const MAX_PASSES = 3;

export async function syncOnce(deps: SyncDeps): Promise<{ state: SyncState; stats: SyncStats }> {
  const now = deps.now ?? Date.now;
  const stats: SyncStats = { pulled: 0, pushed: 0, updated: 0, deleted: 0, conflicts: 0, changed: [] };
  let state: SyncState = { cursor: deps.state.cursor, known: { ...deps.state.known } };
  let stale: RemoteDocument[] = [];
  const guard = () => {
    if (deps.isCurrent && !deps.isCurrent()) throw new RunAbandoned();
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    // ---- pull ----
    const remote: RemoteDocument[] = [...stale];
    stale = [];
    let cursor = state.cursor;
    for (;;) {
      if (deps.flush) break;
      const page = await deps.api.pull(cursor);
      guard();
      remote.push(...page.docs);
      cursor = Math.max(cursor, page.cursor);
      if (!page.more) break;
    }
    stats.pulled += remote.length;

    // ---- merge ----
    const local = new Map(deps.store.list().map((d) => [docKey(d.kind, d.id), d]));
    const known = { ...state.known };
    const upserts: LocalDoc[] = [];
    const deletes: { kind: DocKind; id: string }[] = [];
    for (const r of remote.sort((a, b) => a.seq - b.seq)) {
      const k = docKey(r.kind, r.id);
      const mine = local.get(k);
      const res = resolveDocument({ local: mine, remote: r, base: known[k], now: now() });
      const take = () => {
        const doc: LocalDoc = { id: r.id, kind: r.kind, updatedAt: r.updatedAt, json: r.json };
        upserts.push(doc);
        local.set(k, doc);
        known[k] = { updatedAt: r.updatedAt };
        stats.updated++;
        stats.changed.push({ kind: r.kind, id: r.id, updatedAt: r.updatedAt, existed: !!mine });
      };
      if (res.action === 'apply-remote') take();
      else if (res.action === 'delete-local') {
        deletes.push({ kind: r.kind, id: r.id });
        local.delete(k);
        delete known[k];
        stats.deleted++;
      } else if (res.action === 'conflict' && mine) {
        const loser = res.winner === 'remote' ? mine.json : r.json;
        const winnerJson = res.winner === 'remote' ? r.json : mine.json;
        if (res.copy) {
          const copy = (deps.copyFor ?? conflictCopy)(loser as Team, winnerJson as Team, deps.deviceName, now());
          const doc: LocalDoc = { id: copy.id, kind: 'team', updatedAt: copy.updatedAt, json: copy };
          upserts.push(doc);
          local.set(docKey('team', copy.id), doc);
          stats.conflicts++;
        }
        if (res.winner === 'remote') take();
        else {
          // The local version stays, newer than the server's, so the push is accepted.
          const updatedAt = Math.max(mine.updatedAt, r.updatedAt) + 1;
          const doc: LocalDoc = { ...mine, updatedAt, json: { ...(mine.json as object), updatedAt } };
          upserts.push(doc);
          local.set(k, doc);
        }
      }
      else if (res.action === 'push-local' && mine && r.deleted && mine.updatedAt <= r.updatedAt) {
        // An edit that survives a delete stamped later by another clock (within the margin): restamp it past the delete,
        // or the server would refuse it as stale again.
        const updatedAt = r.updatedAt + 1;
        const doc: LocalDoc = { ...mine, updatedAt, json: { ...(mine.json as object), updatedAt } };
        upserts.push(doc);
        local.set(k, doc);
      }
      // 'noop' and the other 'push-local': nothing to write.
    }
    guard();
    if (upserts.length || deletes.length) deps.store.apply({ upserts, deletes });
    state = { cursor, known };
    deps.save(state);

    // ---- push ----
    let changes = localChanges(deps.store.list(), state.known, now());
    let keepalive: boolean | undefined;
    if (deps.flush) {
      // Most recently edited first, as many as fit one keepalive request; the rest waits for the next run.
      const sorted = [...changes].sort((a, b) => b.updatedAt - a.updatedAt);
      const take: typeof changes = [];
      let size = bytes('{"docs":[]}');
      for (const c of sorted) {
        const n = bytes(JSON.stringify({ id: c.id, kind: c.kind, updatedAt: c.updatedAt, deleted: c.deleted, json: c.json })) + 1;
        if (take.length >= LIMITS.maxDocsPerRequest || (take.length > 0 && size + n > deps.flush.maxBytes)) continue;
        take.push(c);
        size += n;
      }
      keepalive = size <= deps.flush.maxBytes; // one document that alone is too big is sent as an ordinary request
      changes = take;
    }
    for (let i = 0; i < changes.length; i += LIMITS.maxDocsPerRequest) {
      const chunk = changes.slice(i, i + LIMITS.maxDocsPerRequest);
      const res = await deps.api.push(chunk.map((c): PushDoc => ({ id: c.id, kind: c.kind, updatedAt: c.updatedAt, deleted: c.deleted, json: c.json })), keepalive ? { keepalive } : undefined);
      guard();
      const byId = new Map(chunk.map((c) => [docKey(c.kind, c.id), c]));
      for (const r of res.results) {
        const c = byId.get(docKey(r.kind, r.id));
        if (!c) continue;
        const k = docKey(c.kind, c.id);
        if (r.status === 'applied') {
          stats.pushed++;
          if (c.deleted) delete state.known[k];
          else state.known[k] = { updatedAt: c.updatedAt };
        } else if (r.status === 'denied') {
          // Not allowed to write this one (access was taken away): stop trying to send it.
          delete state.known[k];
        } else if (r.doc) stale.push(r.doc);
      }
      // A later chunk failing must not make this one be sent again.
      deps.save(state);
    }
    guard();
    deps.save(state);
    if (stale.length === 0 || deps.flush) break;
  }
  return { state, stats };
}
