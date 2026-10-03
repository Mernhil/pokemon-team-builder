import type { DocKind, RemoteDocument } from '../src/domain/syncProtocol';
import type { D1Like } from './types';

interface Row {
  id: string;
  kind: DocKind;
  json: string | null;
  updated_at: number;
  deleted: number;
  server_seq: number;
}

const toDoc = (r: Row): RemoteDocument => ({
  id: r.id,
  kind: r.kind,
  updatedAt: r.updated_at,
  deleted: r.deleted === 1,
  json: r.json === null ? undefined : JSON.parse(r.json),
  seq: r.server_seq,
});

/** One page of an account's documents after `since`, in sequence order. */
export async function pullDocs(db: D1Like, owner: string, since: number, pageSize: number): Promise<{ docs: RemoteDocument[]; cursor: number; more: boolean }> {
  const { results } = await db
    .prepare('SELECT id, kind, json, updated_at, deleted, server_seq FROM documents WHERE owner = ?1 AND server_seq > ?2 ORDER BY server_seq LIMIT ?3')
    .bind(owner, since, pageSize + 1)
    .all<Row>();
  const page = results.slice(0, pageSize);
  return { docs: page.map(toDoc), cursor: page.length ? page[page.length - 1].server_seq : since, more: results.length > pageSize };
}

export interface StoredDoc {
  id: string;
  kind: DocKind;
  updatedAt: number;
  deleted: boolean;
  /** Already-sanitised JSON text; null for a tombstone. */
  json: string | null;
  /** A team's folder (its own id, or its groupId); undefined for matches and tombstones, which keep the row's. */
  groupId?: string;
}

/**
 * Stores a version if it is newer than what the account has (last write wins by `updatedAt`, a
 * tombstone being just another version). The sequence number and the write happen in one batch.
 * Returns the stored document's sequence number, or the server's newer version when this one is stale.
 */
export async function pushDoc(db: D1Like, owner: string, d: StoredDoc): Promise<{ status: 'applied'; seq: number } | { status: 'stale'; doc: RemoteDocument }> {
  const [, written] = await db.batch<{ server_seq: number }>([
    db.prepare('INSERT INTO sync_seq (owner, value) VALUES (?1, 1) ON CONFLICT (owner) DO UPDATE SET value = value + 1').bind(owner),
    db
      .prepare(
        `INSERT INTO documents (owner, kind, id, json, updated_at, deleted, server_seq, group_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT value FROM sync_seq WHERE owner = ?1), ?7)
         ON CONFLICT (owner, kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, deleted = excluded.deleted, server_seq = excluded.server_seq,
           group_id = COALESCE(excluded.group_id, documents.group_id)
         WHERE excluded.updated_at > documents.updated_at
         RETURNING server_seq`,
      )
      .bind(owner, d.kind, d.id, d.json, d.updatedAt, d.deleted ? 1 : 0, d.groupId ?? null),
  ]);
  const seq = written?.results?.[0]?.server_seq;
  if (typeof seq === 'number') return { status: 'applied', seq };
  const row = await db
    .prepare('SELECT id, kind, json, updated_at, deleted, server_seq FROM documents WHERE owner = ?1 AND kind = ?2 AND id = ?3')
    .bind(owner, d.kind, d.id)
    .first<Row>();
  return { status: 'stale', doc: toDoc(row!) };
}
