import type { Role, Share, ShareKind } from './access';
import type { ShareInput, SharedDocument } from '../src/domain/syncProtocol';
import type { D1Like } from './types';

/** A share whose other side is a disabled account is hidden everywhere (not deleted: enabling the account brings it back). */
const LIVE = `NOT EXISTS (SELECT 1 FROM users u WHERE (u.id = s.owner OR u.id = s.grantee) AND u.disabled = 1)`;

export async function sharesOf(db: D1Like, email: string): Promise<{ granted: Share[]; received: Share[] }> {
  const { results } = await db.prepare(`SELECT owner, grantee, kind, ref, role FROM shares s WHERE (owner = ?1 OR grantee = ?1) AND ${LIVE} ORDER BY created_at, ref`).bind(email).all<Share>();
  return { granted: results.filter((s) => s.owner === email), received: results.filter((s) => s.grantee === email) };
}

/** Shares between two people, either way round (what the access check needs). */
export async function sharesBetween(db: D1Like, owner: string, grantee: string): Promise<Share[]> {
  const { results } = await db.prepare(`SELECT owner, grantee, kind, ref, role FROM shares s WHERE owner = ?1 AND grantee = ?2 AND ${LIVE}`).bind(owner, grantee).all<Share>();
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

/** What to call each person: an account's display name or username (by id), else the name set for an e-mail. */
export async function namesFor(db: D1Like, who: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of new Set(who)) {
    if (e.includes('@')) {
      const row = await db.prepare('SELECT display_name FROM profiles WHERE email = ?1').bind(e).first<{ display_name: string }>();
      if (row?.display_name) out[e] = row.display_name;
    } else {
      const row = await db.prepare('SELECT username, display_name FROM users WHERE id = ?1').bind(e).first<{ username: string; display_name: string | null }>();
      if (row) out[e] = row.display_name || row.username;
    }
  }
  return out;
}

export async function setDisplayName(db: D1Like, email: string, name: string): Promise<void> {
  // A claimed account (its id): the name lives on the account.
  if (!email.includes('@')) {
    await db.prepare('UPDATE users SET display_name = ?1 WHERE id = ?2').bind(name || null, email).run();
    return;
  }
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
       WHERE s.grantee = ?1 AND ${LIVE} AND ((s.kind = 'team-group' AND d.kind = 'team' AND d.group_id = s.ref) OR (s.kind = 'matches' AND d.kind = 'match'))
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
