/**
 * The pure half of `npm run admin` (scripts/admin.ts): argument parsing, input validation and the SQL each
 * command runs, with values bound by `bindSql` (never pasted into a string by hand). The runner passes the SQL
 * to `wrangler d1 execute` in a file, so nothing a person typed ever reaches a shell.
 */
import { USERNAME_MAX, USERNAME_MIN, usernameKey } from '../../src/domain/accounts.ts';

export type SqlValue = string | number | null;

/** A value as an SQLite literal: numbers as they are (finite only), text quoted with '' doubled, NUL refused. */
export function sqlLiteral(v: SqlValue): string {
  if (v === null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('not a finite number');
    return String(v);
  }
  if (v.includes('\u0000')) throw new Error('text with a NUL character');
  return `'${v.replace(/'/g, "''")}'`;
}

/**
 * Fills each `?` with the next value (or each `?N` with the N-th), as a prepared statement would. A `?` inside a
 * quoted literal in `sql` is not allowed.
 */
export function bindSql(sql: string, values: SqlValue[]): string {
  let out = '';
  let next = 0;
  let numbered: boolean | undefined;
  const used = new Set<number>();
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // A literal in the template, copied as it is ('' is an escaped quote inside it).
      const end = sql.indexOf("'", i + 1);
      if (end < 0) throw new Error('an unclosed literal');
      if (sql.slice(i, end + 1).includes('?')) throw new Error('a ? inside a literal');
      out += sql.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch !== '?') {
      out += ch;
      continue;
    }
    const digits = /^\d+/.exec(sql.slice(i + 1))?.[0];
    if (numbered === undefined) numbered = !!digits;
    if (numbered !== !!digits) throw new Error('mixed ? and ?N');
    let k: number;
    if (digits) {
      k = Number(digits);
      i += digits.length;
    } else k = ++next;
    if (k < 1 || k > values.length) throw new Error(digits ? `no value for ?${digits}` : 'too few values');
    used.add(k);
    out += sqlLiteral(values[k - 1]);
  }
  if (used.size !== values.length) throw new Error('too many values');
  return out;
}

/** Usernames are typed on the command line: the same rule as the app's, plus nothing else. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export function checkUsername(name: string | undefined): string {
  const n = (name ?? '').trim();
  if (n.length < USERNAME_MIN || n.length > USERNAME_MAX || !NAME_RE.test(n)) throw new Error(`"${n.slice(0, 40)}" is not a username (${USERNAME_MIN}–${USERNAME_MAX} letters, digits, "_", "." or "-").`);
  return n;
}

export interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | true>;
}
/** `invite --note "for Sam" --days 3 --local` → { command: 'invite', flags: { note, days, local } }. */
export function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith('--') && VALUE_FLAGS.has(name)) {
        flags[name] = next;
        i++;
      } else flags[name] = true;
    } else positional.push(a);
  }
  return { command, positional, flags };
}
const VALUE_FLAGS = new Set(['note', 'days', 'db', 'backup']);

/** The database name passed to wrangler: a D1 name, nothing else. */
export function checkDbName(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(name)) throw new Error(`"${name.slice(0, 40)}" is not a D1 database name.`);
  return name;
}

/** An e-mail as Cloudflare Access gives it (lower case), strictly: it goes into SQL and onto a command line. */
export function checkEmail(email: string | undefined): string {
  const e = (email ?? '').trim().toLowerCase();
  if (!/^[a-z0-9._+-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e) || e.length > 254) throw new Error(`"${e.slice(0, 60)}" is not an e-mail address.`);
  return e;
}

/** Is the account fresh (nothing of its own, never claimed), and is the e-mail already someone's? */
export const freshSql = (userId: string, email: string) =>
  bindSql(
    `SELECT ((SELECT legacy_email FROM users WHERE id = ?1) IS NULL AND NOT EXISTS (SELECT 1 FROM documents WHERE owner = ?1) AND NOT EXISTS (SELECT 1 FROM sync_seq WHERE owner = ?1)
       AND NOT EXISTS (SELECT 1 FROM shares WHERE owner = ?1 OR grantee = ?1)) AS fresh, EXISTS (SELECT 1 FROM users WHERE legacy_email = ?2) AS taken`,
    [userId, email],
  );

export const USER_BY_NAME = (name: string) => bindSql('SELECT id, username, role, disabled FROM users WHERE username_key = ?', [usernameKey(checkUsername(name))]);
export const LIST_USERS =
  "SELECT u.username, u.role, u.disabled, datetime(u.created_at / 1000, 'unixepoch') AS created, (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS devices, u.claim_state AS old_data, u.legacy_email AS claimed_from FROM users u ORDER BY u.created_at";
export const COUNT_USERS = 'SELECT COUNT(*) AS n FROM users';
export const OTHER_ADMINS = (id: string) => bindSql("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?", [id]);

const event = (kind: string, target: string | null, now: number) => bindSql("INSERT INTO events (at, actor, kind, target) VALUES (?, 'cli', ?, ?);", [now, kind, target]);

export function inviteSql(codeHash: string, note: string | null, now: number, expiresAt: number): string {
  return [bindSql("INSERT INTO invites (code_hash, created_by, note, created_at, expires_at) VALUES (?, 'cli', ?, ?, ?);", [codeHash, note, now, expiresAt]), event('invite.create', codeHash.slice(0, 16), now)].join('\n');
}

export function resetSql(userId: string, codeHash: string, now: number, expiresAt: number): string {
  return [
    bindSql('DELETE FROM reset_codes WHERE user_id = ? OR expires_at <= ?;', [userId, now]),
    bindSql("INSERT INTO reset_codes (code_hash, user_id, created_by, expires_at) VALUES (?, ?, 'cli', ?);", [codeHash, userId, expiresAt]),
    event('user.reset', userId, now),
  ].join('\n');
}

export function disableSql(userId: string, disabled: boolean, now: number): string {
  return [
    bindSql('UPDATE users SET disabled = ? WHERE id = ?;', [disabled ? 1 : 0, userId]),
    ...(disabled ? [bindSql('DELETE FROM sessions WHERE user_id = ?;', [userId]), bindSql('DELETE FROM reset_codes WHERE user_id = ?;', [userId])] : []),
    event(disabled ? 'user.disable' : 'user.enable', userId, now),
  ].join('\n');
}

/**
 * The first admin without the app (when SETUP_CODE can't be used): an account with no usable password, plus a reset
 * code the person enters under "Forgot password?" to choose one. The script never needs the pepper or a password.
 * Only while there are no accounts (the INSERT checks it itself).
 */
export function bootstrapSql(o: { id: string; username: string; recoveryHash: string; resetHash: string; now: number; expiresAt: number }): string {
  const name = checkUsername(o.username);
  return [
    bindSql("INSERT INTO users (id, username, username_key, role, pw_hash, pw_changed_at, recovery_hash, created_at) SELECT ?, ?, ?, 'admin', '!', ?, ?, ? WHERE (SELECT COUNT(*) FROM users) = 0;", [o.id, name, usernameKey(name), o.now, o.recoveryHash, o.now]),
    bindSql("INSERT INTO reset_codes (code_hash, user_id, created_by, expires_at) SELECT ?, ?, 'cli', ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?);", [o.resetHash, o.id, o.expiresAt, o.id]),
    event('user.bootstrap', o.id, o.now),
  ].join('\n');
}
