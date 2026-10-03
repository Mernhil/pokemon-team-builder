import type { Role, Share, ShareKind } from './access';
import type { ShareInput, SharedDocument } from '../src/domain/syncProtocol';
import type { D1Like } from './types';

export async function sharesOf(db: D1Like, email: string): Promise<{ granted: Share[]; received: Share[] }> {
  const { results } = await db.prepare('SELECT owner, grantee, kind, ref, role FROM shares WHERE owner = ?1 OR grantee = ?1 ORDER BY created_at, ref').bind(email).all<Share>();
  return { granted: results.filter((s) => s.owner === email), received: results.filter((s) => s.grantee === email) };
}

/** Shares between two people, either way round (what the access check needs). */
export async function sharesBetween(db: D1Like, owner: string, grantee: string): Promise<Share[]> {
  const { results } = await db.prepare('SELECT owner, grantee, kind, ref, role FROM shares WHERE owner = ?1 AND grantee = ?2').bind(owner, grantee).all<Share>();
  return results;
}

export async function putShare(db: D1Like, owner: string, s: ShareInput, now: number): Promise<void> {
  await db
    .prepare('INSERT INTO shares (owner, grantee, kind, ref, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (owner, grantee, kind, ref) DO UPDATE SET role = excluded.role')
    .bind(owner, s.grantee, s.kind, s.ref, s.role, now)
    .run();
}

export async function deleteShare(db: D1Like, owner: string, grantee: string, kind: ShareKind, ref: string): Promise<void> {
  await db.prepare('DELETE FROM shares WHERE owner = ?1 AND grantee = ?2 AND kind = ?3 AND ref = ?4').bind(owner, grantee, kind, ref).run();
}

export async function namesFor(db: D1Like, emails: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of new Set(emails)) {
    const row = await db.prepare('SELECT display_name FROM profiles WHERE email = ?1').bind(e).first<{ display_name: string }>();
    if (row?.display_name) out[e] = row.display_name;
  }
  return out;
}

export async function setDisplayName(db: D1Like, email: string, name: string): Promise<void> {
  if (!name) await db.prepare('DELETE FROM profiles WHERE email = ?1').bind(email).run();
  else await db.prepare('INSERT INTO profiles (email, display_name) VALUES (?1, ?2) ON CONFLICT (email) DO UPDATE SET display_name = excluded.display_name').bind(email, name).run();
}

/** Is `id` a live top-level team of `owner`'s (the only thing a folder share can point at)? */
export async function isLiveRootTeam(db: D1Like, owner: string, id: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS ok FROM documents WHERE owner = ?1 AND kind = 'team' AND id = ?2 AND deleted = 0 AND group_id = ?2").bind(owner, id).first();
  return !!row;
}

/** The folder an existing team row belongs to (null: no such row). */
export async function groupOfTeam(db: D1Like, owner: string, id: string): Promise<string | null> {
  const row = await db.prepare("SELECT group_id FROM documents WHERE owner = ?1 AND kind = 'team' AND id = ?2").bind(owner, id).first<{ group_id: string | null }>();
  return row?.group_id ?? null;
}

interface SharedRow {
  owner: string;
  id: string;
  kind: 'team' | 'match';
  json: string | null;
  updated_at: number;
  deleted: number;
  server_seq: number;
  role: Role;
}

/** Everything shared with `grantee` that currently exists (tombstones too, so deletions reach them). */
export async function sharedDocs(db: D1Like, grantee: string, limit: number): Promise<SharedDocument[]> {
  const { results } = await db
    .prepare(
      `SELECT d.owner, d.id, d.kind, d.json, d.updated_at, d.deleted, d.server_seq, s.role
       FROM shares s JOIN documents d ON d.owner = s.owner
       WHERE s.grantee = ?1 AND ((s.kind = 'team-group' AND d.kind = 'team' AND d.group_id = s.ref) OR (s.kind = 'matches' AND d.kind = 'match'))
       ORDER BY d.owner, d.server_seq LIMIT ?2`,
    )
    .bind(grantee, limit)
    .all<SharedRow>();
  return results.map((r) => ({
    id: r.id,
    kind: r.kind,
    updatedAt: r.updated_at,
    deleted: r.deleted === 1,
    json: r.json === null ? undefined : JSON.parse(r.json),
    seq: r.server_seq,
    owner: r.owner,
    role: r.role,
  }));
}
