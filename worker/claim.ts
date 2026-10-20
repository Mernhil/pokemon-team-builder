/**
 * "Bring my teams from before" (docs/ACCOUNTS_PLAN.md section 9): one batch moves everything a Cloudflare Access
 * e-mail owns to an account's id. Only `owner`/`grantee` are rewritten, so document ids, `updated_at`, tombstones,
 * folders and **`server_seq` stay as they are**, and `sync_seq` moves with them: every device's cursor and `known` map
 * stay valid, nothing is pulled again and nothing turns into a conflict copy.
 *
 * The statements are plain SQL with numbered parameters, shared by the Worker (`POST /api/claim`) and
 * `npm run admin -- claim/unclaim` (scripts/admin.ts), so both do exactly the same thing. The first statement
 * claims the e-mail only if the account is fresh (no documents, no sync sequence, no shares, never claimed); every
 * later one runs only if that one did (it checks `users.legacy_email`), so a refused claim changes nothing.
 * `legacy_email` is UNIQUE: one e-mail can be claimed by one account.
 */
import type { D1Like } from './types.ts';

export interface Sql {
  sql: string;
  values: (string | number | null)[];
}

const isOurs = '(SELECT legacy_email FROM users WHERE id = ?2) = ?1';
const fresh = `NOT EXISTS (SELECT 1 FROM documents WHERE owner = ?2) AND NOT EXISTS (SELECT 1 FROM sync_seq WHERE owner = ?2)
  AND NOT EXISTS (SELECT 1 FROM shares WHERE owner = ?2 OR grantee = ?2)`;

/** ?1 = the e-mail (lower case), ?2 = the user id, ?3 = now, ?4 = who (the user id, or 'cli'). */
export function claimStatements(email: string, userId: string, now: number, actor: string): Sql[] {
  const v = [email, userId, now, actor];
  const s = (sql: string, values: Sql['values'] = v.slice(0, 2)): Sql => ({ sql, values });
  return [
    s(
      `UPDATE users SET legacy_email = ?1, claim_state = 'claimed',
         display_name = COALESCE(display_name, (SELECT display_name FROM profiles WHERE email = ?1))
       WHERE id = ?2 AND legacy_email IS NULL AND ${fresh} RETURNING id`,
    ),
    s(`UPDATE documents SET owner = ?2 WHERE owner = ?1 AND ${isOurs}`),
    s(`UPDATE sync_seq SET owner = ?2 WHERE owner = ?1 AND ${isOurs}`),
    s(`UPDATE shares SET owner = ?2 WHERE owner = ?1 AND ${isOurs}`),
    s(`UPDATE shares SET grantee = ?2 WHERE grantee = ?1 AND ${isOurs}`),
    // The desktop apps linked to the e-mail keep working, now for the account.
    s(`UPDATE devices SET owner = ?2 WHERE owner = ?1 AND ${isOurs}`),
    s(`UPDATE pair_codes SET owner = ?2 WHERE owner = ?1 AND ${isOurs}`),
    // Accounts that share with each other are friends (sharing between accounts needs that).
    s(
      `INSERT OR IGNORE INTO friendships (a, b, state, requested_by, created_at, updated_at)
       SELECT MIN(owner, grantee), MAX(owner, grantee), 'accepted', owner, ?3, ?3 FROM shares
       WHERE (owner = ?2 OR grantee = ?2) AND owner LIKE 'u!_%' ESCAPE '!' AND grantee LIKE 'u!_%' ESCAPE '!' AND owner <> grantee AND ${isOurs}`,
      v.slice(0, 3),
    ),
    s(
      `INSERT INTO account_claims (user_id, legacy_email, at, docs, matches, shares, devices)
       SELECT ?2, ?1, ?3,
         (SELECT COUNT(*) FROM documents WHERE owner = ?2 AND kind = 'team' AND deleted = 0),
         (SELECT COUNT(*) FROM documents WHERE owner = ?2 AND kind = 'match' AND deleted = 0),
         (SELECT COUNT(*) FROM shares WHERE owner = ?2 OR grantee = ?2),
         (SELECT COUNT(*) FROM devices WHERE owner = ?2)
       WHERE ${isOurs}`,
      v.slice(0, 3),
    ),
    s(`INSERT INTO events (at, actor, kind, target) SELECT ?3, ?4, 'account.claim', ?2 WHERE ${isOurs}`, v),
  ];
}

/**
 * The way back: everything the account owns goes back to its e-mail (also what it synced since the claim), and the
 * account can claim again. ?1 = the e-mail, ?2 = the user id, ?3 = now, ?4 = who.
 */
export function unclaimStatements(email: string, userId: string, now: number, actor: string): Sql[] {
  const v = [email, userId, now, actor];
  const s = (sql: string, values: Sql['values'] = v.slice(0, 2)): Sql => ({ sql, values });
  return [
    s(`UPDATE documents SET owner = ?1 WHERE owner = ?2 AND ${isOurs}`),
    s(`UPDATE sync_seq SET owner = ?1 WHERE owner = ?2 AND ${isOurs}`),
    s(`UPDATE shares SET owner = ?1 WHERE owner = ?2 AND ${isOurs}`),
    s(`UPDATE shares SET grantee = ?1 WHERE grantee = ?2 AND ${isOurs}`),
    s(`UPDATE devices SET owner = ?1 WHERE owner = ?2 AND ${isOurs}`),
    s(`UPDATE pair_codes SET owner = ?1 WHERE owner = ?2 AND ${isOurs}`),
    s(`UPDATE account_claims SET undone_at = ?3 WHERE user_id = ?2 AND legacy_email = ?1 AND undone_at IS NULL AND ${isOurs}`, v.slice(0, 3)),
    s(`INSERT INTO events (at, actor, kind, target) SELECT ?3, ?4, 'account.unclaim', ?2 WHERE ${isOurs}`, v),
    // Last: the guard above reads it.
    s(`UPDATE users SET legacy_email = NULL, claim_state = 'pending' WHERE id = ?2 AND legacy_email = ?1`),
  ];
}

export interface ClaimCounts {
  teams: number;
  matches: number;
  shares: number;
  devices: number;
}

/** What an e-mail owns today (the preview the app shows before claiming). */
export async function legacyCounts(db: D1Like, email: string): Promise<ClaimCounts> {
  const row = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM documents WHERE owner = ?1 AND kind = 'team' AND deleted = 0) AS teams,
              (SELECT COUNT(*) FROM documents WHERE owner = ?1 AND kind = 'match' AND deleted = 0) AS matches,
              (SELECT COUNT(*) FROM shares WHERE owner = ?1 OR grantee = ?1) AS shares,
              (SELECT COUNT(*) FROM devices WHERE owner = ?1) AS devices`,
    )
    .bind(email)
    .first<ClaimCounts>();
  return row ?? { teams: 0, matches: 0, shares: 0, devices: 0 };
}

/** Has this account nothing of its own yet (so it may take over an e-mail's data)? */
export async function isFresh(db: D1Like, userId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT (SELECT legacy_email FROM users WHERE id = ?2) IS NULL AND ${fresh} AS ok`).bind(null, userId).first<{ ok: number }>();
  return row?.ok === 1;
}

export type ClaimResult = { ok: true; counts: ClaimCounts } | { ok: false; reason: 'not-fresh' | 'taken' };

/** Runs the claim in one batch (one transaction). */
export async function claim(db: D1Like, email: string, userId: string, now: number, actor: string): Promise<ClaimResult> {
  const taken = await db.prepare('SELECT id FROM users WHERE legacy_email = ?').bind(email).first<{ id: string }>();
  if (taken && taken.id !== userId) return { ok: false, reason: 'taken' };
  let out: { results?: unknown[] }[];
  try {
    out = await db.batch(claimStatements(email, userId, now, actor).map((q) => db.prepare(q.sql).bind(...q.values)));
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message) && /legacy_email/.test(e.message)) return { ok: false, reason: 'taken' };
    throw e;
  }
  if (!out[0]?.results?.length) return { ok: false, reason: 'not-fresh' };
  const row = await db.prepare('SELECT docs AS teams, matches, shares, devices FROM account_claims WHERE user_id = ? ORDER BY id DESC LIMIT 1').bind(userId).first<ClaimCounts>();
  return { ok: true, counts: row ?? { teams: 0, matches: 0, shares: 0, devices: 0 } };
}

export async function unclaim(db: D1Like, email: string, userId: string, now: number, actor: string): Promise<void> {
  await db.batch(unclaimStatements(email, userId, now, actor).map((q) => db.prepare(q.sql).bind(...q.values)));
}

/**
 * Who an Access e-mail is now: the account that claimed it (its id), or the e-mail itself. A claimed account that
 * an admin disabled is refused (`null`), so it can't keep syncing through Access.
 */
export async function ownerForEmail(db: D1Like, email: string): Promise<string | null> {
  const row = await db.prepare('SELECT id, disabled FROM users WHERE legacy_email = ?').bind(email).first<{ id: string; disabled: number }>();
  if (!row) return email;
  return row.disabled === 1 ? null : row.id;
}
