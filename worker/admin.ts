/**
 * Admin actions (docs/ACCOUNTS_PLAN.md section 4): invites, the users list, disable/enable, a password reset
 * code, promote/demote. The routes in authApi.ts check `role = 'admin'` on every call (from the session's own
 * D1 lookup, so a demoted admin loses it on the next request) and parse the bodies; these functions hold the rules.
 * Each action writes an `events` row (who, what, on whom; never a code). The last admin can never be removed.
 */
import { INVITE_LENGTH, RECOVERY_LENGTH, RESET_TTL_MS, formatCode, generateCode, type AdminUserInfo, type InviteInfo } from '../src/domain/accounts';
import { sha256Hex } from './crypto';
import type { D1Like } from './types';

/** An audit row. `target` is a user id, an invite handle or nothing; never a secret. */
export async function logEvent(db: D1Like, actor: string, kind: string, target: string | null, now: number): Promise<void> {
  await db.prepare('INSERT INTO events (at, actor, kind, target) VALUES (?, ?, ?, ?)').bind(now, actor, kind, target).run();
}

/** The handle an invite is revoked by: the first 16 hex digits of its hash (the code itself is never stored). */
const inviteId = (codeHash: string) => codeHash.slice(0, 16);

interface InviteRow {
  code_hash: string;
  note: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  revoked_at: number | null;
  used_by_name: string | null;
}

export async function listInvites(db: D1Like, now: number): Promise<InviteInfo[]> {
  const { results } = await db
    .prepare('SELECT i.code_hash, i.note, i.created_at, i.expires_at, i.used_at, i.revoked_at, u.username AS used_by_name FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.created_at DESC LIMIT 200')
    .all<InviteRow>();
  return results.map((r) => ({
    id: inviteId(r.code_hash),
    ...(r.note ? { note: r.note } : {}),
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: r.used_at ? 'used' : r.revoked_at ? 'revoked' : r.expires_at <= now ? 'expired' : 'open',
    ...(r.used_by_name ? { usedBy: r.used_by_name } : {}),
    ...(r.used_at ? { usedAt: r.used_at } : {}),
  }));
}

/** A new invite; the code is returned once and only its hash is kept. */
export async function makeInvite(db: D1Like, actor: string, note: string | undefined, ttlMs: number, now: number): Promise<{ code: string; expiresAt: number }> {
  const code = generateCode(INVITE_LENGTH);
  const hash = await sha256Hex(code);
  const expiresAt = now + ttlMs;
  await db.batch([
    db.prepare('INSERT INTO invites (code_hash, created_by, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash, actor, note || null, now, expiresAt),
    db.prepare('INSERT INTO events (at, actor, kind, target) VALUES (?, ?, ?, ?)').bind(now, actor, 'invite.create', inviteId(hash)),
  ]);
  return { code: formatCode(code), expiresAt };
}

/** Revokes an unused invite. False when there is no such open invite. */
export async function revokeInvite(db: D1Like, actor: string, id: string, now: number): Promise<boolean> {
  if (!/^[0-9a-f]{16}$/.test(id)) return false;
  const row = await db.prepare("UPDATE invites SET revoked_at = ?1 WHERE substr(code_hash, 1, 16) = ?2 AND used_at IS NULL AND revoked_at IS NULL RETURNING code_hash").bind(now, id).first<{ code_hash: string }>();
  if (!row) return false;
  await logEvent(db, actor, 'invite.revoke', id, now);
  return true;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: 'user' | 'admin';
  disabled: number;
  created_at: number;
  invited_by_name: string | null;
  devices: number;
  last_seen_at: number | null;
}

export async function listUsers(db: D1Like): Promise<AdminUserInfo[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.disabled, u.created_at, i.username AS invited_by_name,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS devices,
              (SELECT MAX(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen_at
       FROM users u LEFT JOIN users i ON i.id = u.invited_by ORDER BY u.created_at`,
    )
    .all<UserRow>();
  return results.map((r) => ({
    id: r.id,
    username: r.username,
    ...(r.display_name ? { displayName: r.display_name } : {}),
    role: r.role,
    disabled: r.disabled === 1,
    createdAt: r.created_at,
    ...(r.invited_by_name ? { invitedBy: r.invited_by_name } : {}),
    devices: r.devices,
    ...(r.last_seen_at ? { lastSeenAt: r.last_seen_at } : {}),
  }));
}

export type AdminRefusal = 'not-found' | 'self' | 'last-admin' | 'disabled';
export const REFUSAL_TEXT: Record<AdminRefusal, string> = {
  'not-found': 'There is no such account.',
  self: 'You can’t do that to your own account. Ask another admin.',
  'last-admin': 'That is the last admin: make someone else an admin first.',
  disabled: 'That account is disabled: enable it first.',
};

/** Live admins other than `id` (disabled admins don't count: they can't sign in). */
const otherAdmins = async (db: D1Like, id: string) => (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?").bind(id).first<{ n: number }>())?.n ?? 0;
const userRow = (db: D1Like, id: string) => db.prepare('SELECT id, role, disabled FROM users WHERE id = ?').bind(id).first<{ id: string; role: 'user' | 'admin'; disabled: number }>();

/** Disables (and signs out everywhere) or enables an account. Never yourself, never the last admin. */
export async function setDisabled(db: D1Like, actor: string, id: string, disabled: boolean, now: number): Promise<AdminRefusal | null> {
  const u = await userRow(db, id);
  if (!u) return 'not-found';
  if (id === actor) return 'self';
  if (disabled && u.role === 'admin' && (await otherAdmins(db, id)) === 0) return 'last-admin';
  await db.batch([
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').bind(disabled ? 1 : 0, id),
    ...(disabled ? [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id), db.prepare('DELETE FROM reset_codes WHERE user_id = ?').bind(id)] : []),
    db.prepare('INSERT INTO events (at, actor, kind, target) VALUES (?, ?, ?, ?)').bind(now, actor, disabled ? 'user.disable' : 'user.enable', id),
  ]);
  return null;
}

/** Promotes or demotes. Demoting yourself is allowed only while another admin remains; the last admin stays. */
export async function setRole(db: D1Like, actor: string, id: string, role: 'user' | 'admin', now: number): Promise<AdminRefusal | null> {
  const u = await userRow(db, id);
  if (!u) return 'not-found';
  if (u.role === role) return null;
  if (role === 'user' && (await otherAdmins(db, id)) === 0) return 'last-admin';
  if (role === 'admin' && u.disabled === 1) return 'disabled';
  await db.batch([db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, id), db.prepare('INSERT INTO events (at, actor, kind, target) VALUES (?, ?, ?, ?)').bind(now, actor, role === 'admin' ? 'user.promote' : 'user.demote', id)]);
  return null;
}

/**
 * A one-time reset code for a user who lost both the password and the recovery code: 20 symbols, 24 hours, only
 * its hash kept. The user enters it under "Forgot password?" (POST /api/auth/recover), which signs every device out.
 * A newer code replaces an older one. The admin never sees or sets the password.
 */
export async function makeResetCode(db: D1Like, actor: string, id: string, now: number): Promise<{ code: string; expiresAt: number } | AdminRefusal> {
  const u = await userRow(db, id);
  if (!u) return 'not-found';
  if (u.disabled === 1) return 'disabled';
  const code = generateCode(RECOVERY_LENGTH);
  const expiresAt = now + RESET_TTL_MS;
  await db.batch([
    db.prepare('DELETE FROM reset_codes WHERE user_id = ? OR expires_at <= ?').bind(id, now),
    db.prepare('INSERT INTO reset_codes (code_hash, user_id, created_by, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(code), id, actor, expiresAt),
    db.prepare('INSERT INTO events (at, actor, kind, target) VALUES (?, ?, ?, ?)').bind(now, actor, 'user.reset', id),
  ]);
  return { code: formatCode(code), expiresAt };
}
