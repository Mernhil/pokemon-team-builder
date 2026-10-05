/**
 * Linked devices (the desktop app): pairing codes and device tokens. Only SHA-256 hashes are
 * stored. A code is single-use and expires; redeeming it turns it into a long-lived bearer token
 * that the Worker maps to the account that created the code.
 */
import { CODE_TTL_MS, MAX_DEVICES, MAX_LIVE_CODES, generateCode, type DeviceInfo } from '../src/domain/pairing';
import type { D1Like } from './types';

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = () => `ptbd_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
const randomId = () => b64url(crypto.getRandomValues(new Uint8Array(9)));

/** A new code for `owner`; the oldest live codes beyond the limit and every expired one are dropped. */
export async function createPairCode(db: D1Like, owner: string, now: number): Promise<{ code: string; expiresAt: number }> {
  await db.prepare('DELETE FROM pair_codes WHERE expires_at <= ?').bind(now).run();
  await db
    .prepare('DELETE FROM pair_codes WHERE owner = ? AND code_hash NOT IN (SELECT code_hash FROM pair_codes WHERE owner = ? ORDER BY expires_at DESC LIMIT ?)')
    .bind(owner, owner, MAX_LIVE_CODES - 1)
    .run();
  const code = generateCode();
  const expiresAt = now + CODE_TTL_MS;
  await db.prepare('INSERT INTO pair_codes (code_hash, owner, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(code), owner, expiresAt).run();
  return { code, expiresAt };
}

export type RedeemResult = { token: string; owner: string } | { error: 'invalid' | 'too-many-devices' };

/** Trades a code for a device token. The code is consumed whether or not the device limit stops it. */
export async function redeemPairCode(db: D1Like, code: string, name: string, now: number): Promise<RedeemResult> {
  const hash = await sha256Hex(code);
  // One statement deletes the code and returns it, so two requests can't both redeem it.
  const row = await db.prepare('DELETE FROM pair_codes WHERE code_hash = ? RETURNING owner, expires_at').bind(hash).first<{ owner: string; expires_at: number }>();
  if (!row || row.expires_at <= now) return { error: 'invalid' };
  const count = await db.prepare('SELECT COUNT(*) AS n FROM devices WHERE owner = ?').bind(row.owner).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_DEVICES) return { error: 'too-many-devices' };
  const token = randomToken();
  await db
    .prepare('INSERT INTO devices (id, owner, name, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(randomId(), row.owner, name, await sha256Hex(token), now, now)
    .run();
  return { token, owner: row.owner };
}

/** The device a bearer token belongs to, or null (revoked or never issued). Notes when it was last seen, at most once a minute. */
export async function deviceByToken(db: D1Like, token: string, now: number): Promise<{ id: string; owner: string } | null> {
  const hash = await sha256Hex(token);
  const row = await db.prepare('SELECT id, owner, last_seen_at FROM devices WHERE token_hash = ?').bind(hash).first<{ id: string; owner: string; last_seen_at: number }>();
  if (!row) return null;
  if (now - row.last_seen_at > 60_000) await db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(now, row.id).run();
  return { id: row.id, owner: row.owner };
}

export async function listDevices(db: D1Like, owner: string): Promise<DeviceInfo[]> {
  const { results } = await db.prepare('SELECT id, name, created_at, last_seen_at FROM devices WHERE owner = ? ORDER BY created_at').bind(owner).all<{ id: string; name: string; created_at: number; last_seen_at: number }>();
  return results.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at }));
}

export async function revokeDevice(db: D1Like, owner: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM devices WHERE owner = ? AND id = ?').bind(owner, id).run();
}
