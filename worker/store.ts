import type { DocKind, RemoteDocument } from '../src/domain/syncProtocol';
import type { D1Like } from './types';

interface Row {
  id: string;
  kind: DocKind;
  json: string | null;
  updated_at: number;
  deleted: number;
  server_seq: number;
  by?: string | null;
}

const COLS = `d.id, d.kind, d.json, d.updated_at, d.deleted, d.server_seq, COALESCE(p.display_name, d.editor) AS by`;
const FROM = `documents d LEFT JOIN profiles p ON p.email = d.editor`;

const toDoc = (r: Row): RemoteDocument => ({
  id: r.id,
  kind: r.kind,
  updatedAt: r.updated_at,
  deleted: r.deleted === 1,
  json: r.json === null ? undefined : JSON.parse(r.json),
  seq: r.server_seq,
  ...(r.by ? { by: r.by } : {}),
});

/** One page of an account's documents after `since`, in sequence order. */
export async function pullDocs(db: D1Like, owner: string, since: number, pageSize: number): Promise<{ docs: RemoteDocument[]; cursor: number; more: boolean }> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM ${FROM} WHERE d.owner = ?1 AND d.server_seq > ?2 ORDER BY d.server_seq LIMIT ?3`)
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
  /** A team's folder (its groupId, or its own id); null for matches and for tombstones, which keep the old one. */
  folder?: string | null;
  /** The e-mail of a shared-folder editor who wrote this version; null when the owner did. */
  editor?: string | null;
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
        `INSERT INTO documents (owner, kind, id, json, updated_at, deleted, server_seq, folder, editor)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT value FROM sync_seq WHERE owner = ?1), ?7, ?8)
         ON CONFLICT (owner, kind, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at, deleted = excluded.deleted, server_seq = excluded.server_seq,
           folder = COALESCE(excluded.folder, documents.folder), editor = excluded.editor
         WHERE excluded.updated_at > documents.updated_at
         RETURNING server_seq`,
      )
      .bind(owner, d.kind, d.id, d.json, d.updatedAt, d.deleted ? 1 : 0, d.folder ?? null, d.editor ?? null),
  ]);
  const seq = written?.results?.[0]?.server_seq;
  if (typeof seq === 'number') return { status: 'applied', seq };
  const row = await db
    .prepare(`SELECT ${COLS} FROM ${FROM} WHERE d.owner = ?1 AND d.kind = ?2 AND d.id = ?3`)
    .bind(owner, d.kind, d.id)
    .first<Row>();
  return { status: 'stale', doc: toDoc(row!) };
}

/** What the account has stored for one document, without its JSON: enough for access checks. */
export async function docMeta(db: D1Like, owner: string, kind: DocKind, id: string): Promise<{ folder: string | null; deleted: boolean } | null> {
  const row = await db.prepare('SELECT folder, deleted FROM documents WHERE owner = ?1 AND kind = ?2 AND id = ?3').bind(owner, kind, id).first<{ folder: string | null; deleted: number }>();
  return row ? { folder: row.folder, deleted: row.deleted === 1 } : null;
}
