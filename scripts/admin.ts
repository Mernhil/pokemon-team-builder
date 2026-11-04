/**
 * `npm run admin -- <command>`: the account admin actions without the app, for when an admin is locked out
 * (docs/ACCOUNTS.md). It runs `wrangler d1 execute` against the remote database (`--local` for the dev one),
 * so wrangler must be logged in (`npx wrangler login`).
 *
 *   list                              accounts, roles, state and devices
 *   invite [--note "for Sam"] [--days 7]
 *   reset <username>                  a one-time code (24 h) for "Forgot password?"
 *   disable <username> | enable <username>
 *   bootstrap <username>              the first admin when there are no accounts yet (then "Forgot password?" with the printed code)
 *   claim <email> <username> --backup <file>   move what an Access e-mail synced into an account (after `wrangler d1 export`)
 *   unclaim <username>                put it back under the e-mail
 *
 * Values are bound (scripts/lib/adminSql.ts) and the SQL goes to wrangler in a temporary file, so nothing typed here
 * reaches a shell. Codes are printed once and only their SHA-256 is stored, as the app does.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INVITE_LENGTH, RECOVERY_LENGTH, RESET_TTL_MS, formatCode, generateCode } from '../src/domain/accounts.ts';
import { claimStatements, unclaimStatements } from '../worker/claim.ts';
import { COUNT_USERS, LIST_USERS, OTHER_ADMINS, USER_BY_NAME, bindSql, bootstrapSql, checkDbName, checkEmail, checkUsername, disableSql, freshSql, inviteSql, parseArgs, resetSql } from './lib/adminSql.ts';

const args = parseArgs(process.argv.slice(2));
const db = checkDbName(typeof args.flags.db === 'string' ? args.flags.db : 'pokemon-team-builder');
const where = args.flags.local ? '--local' : '--remote';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const code = (n: number) => generateCode(n, (k) => new Uint8Array(randomBytes(k)));
const now = Date.now();

function wrangler(extra: string[]): string {
  // Fixed words, the checked database name, checked SQL (reads) or our own temp-file path (writes): nothing typed raw.
  const argv = ['wrangler', 'd1', 'execute', db, where, ...extra];
  // Windows runs npx through cmd.exe, which joins the arguments: quote each (none can hold a double quote or a %).
  if (argv.some((a) => /["%\r\n]/.test(a))) throw new Error('refusing an argument with a quote, % or a line break');
  const win = process.platform === 'win32';
  const r = spawnSync('npx', win ? argv.map((a) => `"${a}"`) : argv, { encoding: 'utf8', shell: win, stdio: ['ignore', 'pipe', 'inherit'] });
  if (r.status !== 0) throw new Error(`wrangler failed (exit ${r.status}). Is it logged in (npx wrangler login)?`);
  return r.stdout;
}

/** A read: the SQL holds only checked values (usernames, ids, numbers), so it can go on the command line. */
function query<T>(sql: string): T[] {
  let out: unknown;
  try {
    out = JSON.parse(wrangler(['--json', '--command', sql.replace(/\s+/g, ' ')]));
  } catch {
    throw new Error('wrangler printed something that is not JSON.');
  }
  return Array.isArray(out) ? out.flatMap((r: { results?: T[] }) => r.results ?? []) : [];
}

/** A write: always through a file. */
function execute(sql: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'ptb-admin-'));
  try {
    const file = join(dir, 'admin.sql');
    writeFileSync(file, `${sql}\n`, { mode: 0o600 });
    wrangler(['--file', file, '--yes']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface UserRow {
  id: string;
  username: string;
  role: 'user' | 'admin';
  disabled: number;
}
function user(name: string | undefined): UserRow {
  const u = query<UserRow>(USER_BY_NAME(checkUsername(name)))[0];
  if (!u) throw new Error(`No account is called ${name}.`);
  return u;
}

function main(): void {
  switch (args.command) {
    case 'list': {
      console.table(query(LIST_USERS));
      return;
    }
    case 'invite': {
      const days = args.flags.days === undefined ? 7 : Number(args.flags.days);
      if (!Number.isFinite(days) || days < 1 / 24 || days > 30) throw new Error('--days is between 0.05 (an hour) and 30.');
      const note = typeof args.flags.note === 'string' ? args.flags.note.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().slice(0, 80) || null : null;
      const c = code(INVITE_LENGTH);
      const expiresAt = now + Math.round(days * 24 * 3600_000);
      execute(inviteSql(sha256(c), note, now, expiresAt));
      console.log(`Invite: ${formatCode(c)}  (valid until ${new Date(expiresAt).toLocaleString()}; shown only now)`);
      return;
    }
    case 'reset': {
      const u = user(args.positional[0]);
      if (u.disabled) throw new Error(`${u.username} is disabled: enable it first.`);
      const c = code(RECOVERY_LENGTH);
      execute(resetSql(u.id, sha256(c), now, now + RESET_TTL_MS));
      console.log(`Reset code for ${u.username}: ${formatCode(c)}\nValid 24 hours, once. They enter it in Settings → Account → Forgot password?. Shown only now.`);
      return;
    }
    case 'disable':
    case 'enable': {
      const u = user(args.positional[0]);
      const off = args.command === 'disable';
      if (off && u.role === 'admin' && (query<{ n: number }>(OTHER_ADMINS(u.id))[0]?.n ?? 0) === 0) throw new Error(`${u.username} is the last admin: make someone else an admin first.`);
      execute(disableSql(u.id, off, now));
      console.log(`${u.username} is ${off ? 'disabled and signed out everywhere' : 'enabled'}.`);
      return;
    }
    case 'bootstrap': {
      const name = checkUsername(args.positional[0]);
      if ((query<{ n: number }>(COUNT_USERS)[0]?.n ?? 0) > 0) throw new Error('There are accounts already: bootstrap only makes the very first one.');
      const reset = code(RECOVERY_LENGTH);
      const id = `u_${randomBytes(9).toString('base64url')}`;
      execute(bootstrapSql({ id, username: name, recoveryHash: sha256(code(RECOVERY_LENGTH)), resetHash: sha256(reset), now, expiresAt: now + RESET_TTL_MS }));
      console.log(`Admin account ${name} made. In the app: Settings → Account → Log in → Forgot password?, username ${name}, code ${formatCode(reset)} (24 hours, once), then your new password.`);
      return;
    }
    case 'claim': {
      const email = checkEmail(args.positional[0]);
      const u = user(args.positional[1]);
      const backup = args.flags.backup;
      // The claim rewrites many rows: only with a fresh backup at hand (npx wrangler d1 export … --output backup.sql).
      if (typeof backup !== 'string' || !existsSync(backup) || statSync(backup).size === 0) throw new Error('Back up first: npx wrangler d1 export pokemon-team-builder --remote --output backup.sql, then pass --backup backup.sql.');
      const check = query<{ fresh: number; taken: number }>(freshSql(u.id, email))[0];
      if (!check?.fresh) throw new Error(`${u.username} already has data of its own (or has claimed before): it can't take over another e-mail's.`);
      if (check.taken) throw new Error(`Another account has already claimed ${email}.`);
      execute(claimStatements(email, u.id, now, 'cli').map((q) => `${bindSql(q.sql, q.values)};`).join('\n'));
      console.table(query(bindSql('SELECT legacy_email, docs AS teams, matches, shares, devices FROM account_claims WHERE user_id = ? ORDER BY id DESC LIMIT 1', [u.id])));
      return;
    }
    case 'unclaim': {
      const u = user(args.positional[0]);
      const row = query<{ legacy_email: string | null }>(bindSql('SELECT legacy_email FROM users WHERE id = ?', [u.id]))[0];
      if (!row?.legacy_email) throw new Error(`${u.username} hasn't claimed anything.`);
      execute(unclaimStatements(row.legacy_email, u.id, now, 'cli').map((q) => `${bindSql(q.sql, q.values)};`).join('\n'));
      console.log(`Everything of ${u.username}'s is back under ${row.legacy_email}. With AUTH_MODE=access that e-mail syncs as before.`);
      return;
    }
    default:
      console.log('Usage: npm run admin -- <list | invite [--note "…"] [--days 7] | reset <username> | disable <username> | enable <username> | bootstrap <username> | claim <email> <username> --backup <file> | unclaim <username>> [--local] [--db <name>]');
      if (args.command !== 'help') process.exitCode = 1;
  }
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
