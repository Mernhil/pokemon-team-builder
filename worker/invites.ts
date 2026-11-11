/** Invites: single-use, expiring codes an admin makes. Only the SHA-256 of the normalised code is stored, so a code is shown once. */
import { INVITE_LENGTH, isCode, normalizeCode } from '../src/domain/accounts';
import { sha256Hex } from './crypto';
import type { D1Like } from './types';

/** The hash of what a person typed if it looks like an invite code, else null. */
export async function inviteHash(typed: string): Promise<string | null> {
  const code = normalizeCode(typed);
  return isCode(code, INVITE_LENGTH) ? sha256Hex(code) : null;
}

/** Is there an invite with this hash that is unused, unrevoked and unexpired? */
export async function inviteUsable(db: D1Like, hash: string, now: number): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS ok FROM invites WHERE code_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?').bind(hash, now).first();
  return !!row;
}
