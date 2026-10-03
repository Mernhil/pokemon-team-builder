/**
 * Sharing, server side: which accounts may see or edit which folders, the opt-in match-log shares
 * and display names. Every read and write of another account's documents goes through `roleFor` /
 * the queries here, so the access rules live in one place (and one test matrix).
 */
import type { RemoteDocument, ShareRole, SharedResponse, SharesResponse } from '../src/domain/syncProtocol';
import { MAX_SHARES, SHARED_LIMITS } from '../src/domain/syncProtocol';
import type { D1Like } from './types';

interface DocRow {
  id: string;
  kind: 'team' | 'match';
  json: string | null;
  updated_at: number;
  deleted: number;
  server_seq: number;
  by: string | null;
}
const toDoc = (r: DocRow): RemoteDocument => ({
  id: r.id,
  kind: r.kind,
  updatedAt: r.updated_at,
  deleted: r.deleted === 1,
  json: r.json === null ? undefined : JSON.parse(r.json),
  seq: r.server_seq,
  ...(r.by ? { by: r.by } : {}),
});
const COLS = 'd.id, d.kind, d.json, d.updated_at, d.deleted, d.server_seq, COALESCE(p.display_name, d.editor) AS by';
const FROM = 'documents d LEFT JOIN profiles p ON p.email = d.editor';

/** The role `grantee` has on `owner`'s folder, or null (a stranger, or the owner themselves: owners don't need a share). */
export async function roleFor(db: D1Like, owner: string, folderId: string, grantee: string): Promise<ShareRole | null> {
  const row = await db.prepare('SELECT role FROM shares WHERE owner = ?1 AND folder_id = ?2 AND grantee = ?3').bind(owner, folderId, grantee).first<{ role: ShareRole }>();
  return row?.role ?? null;
}

export async function displayNames(db: D1Like, emails: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const e of new Set(emails)) {
    const r = await db.prepare('SELECT display_name FROM profiles WHERE email = ?1').bind(e).first<{ display_name: string }>();
    if (r) out.set(e, r.display_name);
  }
  return out;
}

/** Everything other accounts have shared with `me`. */
export async function sharedWith(db: D1Like, me: string): Promise<SharedResponse> {
  const grants = (await db.prepare('SELECT owner, folder_id, role FROM shares WHERE grantee = ?1 ORDER BY owner, folder_id').bind(me).all<{ owner: string; folder_id: string; role: ShareRole }>()).results;
  const friends = (await db.prepare('SELECT owner FROM match_shares WHERE grantee = ?1 ORDER BY owner').bind(me).all<{ owner: string }>()).results;
  const names = await displayNames(db, [...grants.map((g) => g.owner), ...friends.map((f) => f.owner)]);

  const folders: SharedResponse['folders'] = [];
  for (const g of grants) {
    const { results } = await db
      .prepare(`SELECT ${COLS} FROM ${FROM} WHERE d.owner = ?1 AND d.kind = 'team' AND d.folder = ?2 ORDER BY d.server_seq LIMIT ?3`)
      .bind(g.owner, g.folder_id, SHARED_LIMITS.teamsPerFolder)
      .all<DocRow>();
    folders.push({ owner: g.owner, ownerName: names.get(g.owner), folderId: g.folder_id, role: g.role, docs: results.map(toDoc) });
  }
  const matches: SharedResponse['matches'] = [];
  for (const f of friends) {
    const { results } = await db
      .prepare(`SELECT ${COLS} FROM ${FROM} WHERE d.owner = ?1 AND d.kind = 'match' AND d.deleted = 0 ORDER BY d.updated_at DESC LIMIT ?2`)
      .bind(f.owner, SHARED_LIMITS.matchesPerOwner)
      .all<DocRow>();
    matches.push({ owner: f.owner, ownerName: names.get(f.owner), docs: results.map(toDoc) });
  }
  return { you: { email: me, displayName: names.get(me) ?? (await displayNames(db, [me])).get(me) ?? '' }, folders, matches };
}

export async function mySharing(db: D1Like, me: string): Promise<SharesResponse> {
  const outgoing = (await db.prepare('SELECT folder_id, grantee, role FROM shares WHERE owner = ?1 ORDER BY folder_id, grantee').bind(me).all<{ folder_id: string; grantee: string; role: ShareRole }>()).results;
  const matchGrantees = (await db.prepare('SELECT grantee FROM match_shares WHERE owner = ?1 ORDER BY grantee').bind(me).all<{ grantee: string }>()).results;
  const profile = await db.prepare('SELECT display_name FROM profiles WHERE email = ?1').bind(me).first<{ display_name: string }>();
  return {
    email: me,
    displayName: profile?.display_name ?? '',
    outgoing: outgoing.map((o) => ({ folderId: o.folder_id, grantee: o.grantee, role: o.role })),
    matchGrantees: matchGrantees.map((g) => g.grantee),
  };
}

export type ShareResult = { ok: true } | { ok: false; status: number; error: string };
const bad = (status: number, error: string): ShareResult => ({ ok: false, status, error });

export async function shareFolder(db: D1Like, owner: string, folderId: string, grantee: string, role: ShareRole, now: number): Promise<ShareResult> {
  if (grantee === owner) return bad(400, "You can't share with yourself.");
  const root = await db.prepare("SELECT 1 AS x FROM documents WHERE owner = ?1 AND kind = 'team' AND id = ?2 AND folder = ?2 AND deleted = 0").bind(owner, folderId).first();
  if (!root) return bad(404, 'That team folder is not synced to your account yet (turn sync on, then share).');
  const existing = await roleFor(db, owner, folderId, grantee);
  if (!existing) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM shares WHERE owner = ?1').bind(owner).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_SHARES) return bad(400, `You can share with at most ${MAX_SHARES} people and folders at once.`);
  }
  await db
    .prepare('INSERT INTO shares (owner, folder_id, grantee, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (owner, folder_id, grantee) DO UPDATE SET role = excluded.role')
    .bind(owner, folderId, grantee, role, now)
    .run();
  return { ok: true };
}

export async function unshareFolder(db: D1Like, owner: string, folderId: string, grantee: string): Promise<ShareResult> {
  await db.prepare('DELETE FROM shares WHERE owner = ?1 AND folder_id = ?2 AND grantee = ?3').bind(owner, folderId, grantee).run();
  return { ok: true };
}

export async function shareMatches(db: D1Like, owner: string, grantee: string, enabled: boolean, now: number): Promise<ShareResult> {
  if (!enabled) {
    await db.prepare('DELETE FROM match_shares WHERE owner = ?1 AND grantee = ?2').bind(owner, grantee).run();
    return { ok: true };
  }
  if (grantee === owner) return bad(400, "You can't share with yourself.");
  const n = await db.prepare('SELECT COUNT(*) AS n FROM match_shares WHERE owner = ?1').bind(owner).first<{ n: number }>();
  const already = await db.prepare('SELECT 1 AS x FROM match_shares WHERE owner = ?1 AND grantee = ?2').bind(owner, grantee).first();
  if (!already && (n?.n ?? 0) >= MAX_SHARES) return bad(400, `You can share your matches with at most ${MAX_SHARES} people.`);
  await db.prepare('INSERT INTO match_shares (owner, grantee, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (owner, grantee) DO NOTHING').bind(owner, grantee, now).run();
  return { ok: true };
}

export async function setDisplayName(db: D1Like, email: string, name: string): Promise<ShareResult> {
  if (!name) await db.prepare('DELETE FROM profiles WHERE email = ?1').bind(email).run();
  else await db.prepare('INSERT INTO profiles (email, display_name) VALUES (?1, ?2) ON CONFLICT (email) DO UPDATE SET display_name = excluded.display_name').bind(email, name).run();
  return { ok: true };
}
