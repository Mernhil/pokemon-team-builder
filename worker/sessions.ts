/**
 * Login sessions: one row per device. Only the SHA-256 of the token is stored; every request looks it up in D1
 * (joined with the user), so a revoked session, a disabled user or an expired token fails on the very next request.
 */
import { MAX_SESSIONS, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, SESSION_RENEW_AFTER_MS, type SessionInfo } from '../src/domain/accounts';
import { randomId, randomToken, sha256Hex } from './crypto';
import type { D1Like } from './types';

export interface SessionUser {
  id: string;
  username: string;
  displayName?: string;
  role: 'user' | 'admin';
}
export interface ActiveSession {
  id: string;
  user: SessionUser;
  expiresAt: number;
  /** The expiry was just extended: the cookie must be set again. */
  renewed: boolean;
}

/** A new session; the oldest ones beyond the limit are dropped. The token is returned once and never stored. */
export async function createSession(db: D1Like, userId: string, name: string, kind: 'web' | 'desktop', now: number): Promise<{ token: string; id: string; expiresAt: number }> {
  const token = randomToken();
  const id = randomId();
  const expiresAt = now + SESSION_IDLE_MS;
  await db.prepare('INSERT INTO sessions (id, user_id, name, kind, token_hash, created_at, last_seen_at, renewed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, userId, name, kind, await sha256Hex(token), now, now, now, expiresAt).run();
  await db
    .prepare('DELETE FROM sessions WHERE user_id = ? AND id NOT IN (SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)')
    .bind(userId, userId, MAX_SESSIONS)
    .run();
  return { token, id, expiresAt };
}

interface Row {
  id: string;
  user_id: string;
  created_at: number;
  last_seen_at: number;
  renewed_at: number;
  expires_at: number;
  username: string;
  display_name: string | null;
  role: 'user' | 'admin';
  disabled: number;
}

/** The live session a token belongs to, or null (never issued, revoked, expired, or its user is disabled). Renews a session used after a day. */
export async function sessionByToken(db: D1Like, token: string, now: number): Promise<ActiveSession | null> {
  const row = await db
    .prepare(
      `SELECT s.id, s.user_id, s.created_at, s.last_seen_at, s.renewed_at, s.expires_at, u.username, u.display_name, u.role, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .bind(await sha256Hex(token))
    .first<Row>();
  if (!row || row.disabled === 1) return null;
  if (row.expires_at <= now) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(row.id).run();
    return null;
  }
  let expiresAt = row.expires_at;
  let renewed = false;
  if (now - row.renewed_at > SESSION_RENEW_AFTER_MS) {
    expiresAt = Math.min(now + SESSION_IDLE_MS, row.created_at + SESSION_ABSOLUTE_MS);
    renewed = true;
    await db.prepare('UPDATE sessions SET renewed_at = ?, last_seen_at = ?, expires_at = ? WHERE id = ?').bind(now, now, expiresAt, row.id).run();
  } else if (now - row.last_seen_at > 60_000) {
    await db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(now, row.id).run();
  }
  return { id: row.id, expiresAt, renewed, user: { id: row.user_id, username: row.username, displayName: row.display_name ?? undefined, role: row.role } };
}

export async function listSessions(db: D1Like, userId: string, currentId: string): Promise<SessionInfo[]> {
  const { results } = await db.prepare('SELECT id, name, kind, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY created_at').bind(userId).all<{ id: string; name: string; kind: 'web' | 'desktop'; created_at: number; last_seen_at: number }>();
  return results.map((r) => ({ id: r.id, name: r.name, kind: r.kind, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === currentId }));
}

export async function revokeSession(db: D1Like, userId: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?').bind(userId, id).run();
}

/** Every session of the user, except `keepId` when given. */
export async function revokeAllSessions(db: D1Like, userId: string, keepId?: string): Promise<void> {
  if (keepId) await db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').bind(userId, keepId).run();
  else await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}
