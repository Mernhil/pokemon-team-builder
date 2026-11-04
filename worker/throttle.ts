/**
 * Attempt counters in D1 (migrations/0005_accounts.sql). A fixed window per scope; the key is a hash of the
 * pepper, the scope and the value (a client address, a username), so nothing identifying is stored.
 * D1 counters rather than Cloudflare rate-limit rules because they work from the first deploy and are tested exactly.
 */
import { sha256Hex } from './crypto';
import type { D1Like } from './types';

export interface Rule {
  windowMs: number;
  max: number;
}

const keyOf = (pepper: string, scope: string, value: string) => sha256Hex(`${pepper}\u0000${scope}\u0000${value}`);

/** Attempts so far in the current window. */
export async function count(db: D1Like, pepper: string, scope: string, value: string, rule: Rule, now: number): Promise<number> {
  const row = await db
    .prepare('SELECT n FROM throttles WHERE scope = ? AND key_hash = ? AND bucket = ?')
    .bind(scope, await keyOf(pepper, scope, value), Math.floor(now / rule.windowMs))
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Counts one attempt and returns the new total for the window; older windows of the scope are deleted. */
export async function bump(db: D1Like, pepper: string, scope: string, value: string, rule: Rule, now: number): Promise<number> {
  const bucket = Math.floor(now / rule.windowMs);
  await db.prepare('DELETE FROM throttles WHERE scope = ? AND bucket < ?').bind(scope, bucket).run();
  const row = await db
    .prepare('INSERT INTO throttles (scope, key_hash, bucket, n) VALUES (?, ?, ?, 1) ON CONFLICT (scope, key_hash, bucket) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(scope, await keyOf(pepper, scope, value), bucket)
    .first<{ n: number }>();
  return row?.n ?? 1;
}

/** Counts one attempt; false once the window's limit is passed. */
export async function allow(db: D1Like, pepper: string, scope: string, value: string, rule: Rule, now: number): Promise<boolean> {
  return (await bump(db, pepper, scope, value, rule, now)) <= rule.max;
}

/** Seconds until the current window ends (the Retry-After of a 429). */
export const retryAfter = (rule: Rule, now: number): number => Math.max(1, Math.ceil(((Math.floor(now / rule.windowMs) + 1) * rule.windowMs - now) / 1000));

/** The client address from Cloudflare's header; an IPv6 address is reduced to its /64. Without the header (local development) everyone shares one key. */
export function clientAddress(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')?.trim().toLowerCase() ?? 'unknown';
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}
