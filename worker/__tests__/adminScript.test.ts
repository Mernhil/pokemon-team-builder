/** `npm run admin` (scripts/admin.ts): the SQL it hands to wrangler, run against the real schema, then checked through the Worker. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RESET_TTL_MS } from '../../src/domain/accounts';
import { bindSql, bootstrapSql, checkDbName, checkUsername, disableSql, inviteSql, parseArgs, resetSql, sqlLiteral, USER_BY_NAME } from '../../scripts/lib/adminSql';
import { PW, accountEnv, call, firstAdmin, inviteAndSignup, login, newKeyBody } from './accountHelpers';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const CODE = 'ABCDEFGHJKLM';
const RESET = 'ABCDEFGHJKLMNPQRSTUV';

describe('binding values', () => {
  it('quotes text, doubles quotes, and refuses what can’t be a literal', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral(5)).toBe('5');
    expect(sqlLiteral(null)).toBe('NULL');
    expect(() => sqlLiteral(Number.NaN)).toThrow();
    expect(() => sqlLiteral('a\u0000b')).toThrow();
    expect(bindSql('SELECT ?, ?', ['a', 1])).toBe("SELECT 'a', 1");
    expect(() => bindSql('SELECT ?', [])).toThrow(/too few/);
    expect(() => bindSql('SELECT ?', [1, 2])).toThrow(/too many/);
    expect(() => bindSql("SELECT '?'", [1])).toThrow(/inside a literal/);
  });

  it('a hostile note is stored as text and runs nothing', () => {
    const env = accountEnv();
    const note = "x'); DROP TABLE users; --";
    env.DB.raw.exec(inviteSql(sha256(CODE), note, Date.now(), Date.now() + 1000));
    expect(env.DB.raw.prepare('SELECT note FROM invites').get()).toEqual({ note });
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'users'").get()).toEqual({ n: 1 });
  });

  it('usernames and database names are checked before anything runs', () => {
    expect(checkUsername(' Ash ')).toBe('Ash');
    for (const bad of ['a', 'ash; rm -rf ~', '$(whoami)', 'ash ketchum', "ash'--", '-ash', 'x'.repeat(21), undefined]) expect(() => checkUsername(bad)).toThrow(/not a username/);
    expect(USER_BY_NAME('Ash')).toContain("'ash'");
    expect(checkDbName('pokemon-team-builder')).toBe('pokemon-team-builder');
    expect(() => checkDbName('db; rm -rf /')).toThrow();
  });

  it('reads arguments and flags', () => {
    expect(parseArgs(['invite', '--note', 'for Sam', '--days', '3', '--local'])).toEqual({ command: 'invite', positional: [], flags: { note: 'for Sam', days: '3', local: true } });
    expect(parseArgs(['reset', 'misty'])).toEqual({ command: 'reset', positional: ['misty'], flags: {} });
    expect(parseArgs([]).command).toBe('help');
  });
});

describe('what the commands do (checked through the Worker)', () => {
  it('invite: the printed code signs someone up', async () => {
    const env = accountEnv();
    await firstAdmin(env);
    env.DB.raw.exec(inviteSql(sha256(CODE), 'for Sam', Date.now(), Date.now() + 3600_000));
    expect((await call(env, 'POST', '/api/auth/signup', { body: { invite: 'ABCD-EFGH-JKLM', username: 'sam', ...(await newKeyBody(PW)) } })).status).toBe(200);
    const ev = env.DB.raw.prepare('SELECT actor, kind FROM events').all();
    expect(ev).toEqual([{ actor: 'cli', kind: 'invite.create' }]);
  });

  it('reset: the printed code sets a new password once; disable signs out; enable lets back in', async () => {
    const env = accountEnv();
    const ash = await firstAdmin(env);
    const misty = await inviteAndSignup(env, ash.cookie, 'misty');
    const now = Date.now();
    env.DB.raw.exec(resetSql(misty.user.id, sha256(RESET), now, now + RESET_TTL_MS));
    const fresh = await newKeyBody('a brand new passphrase');
    expect((await call(env, 'POST', '/api/auth/recover', { body: { username: 'misty', code: 'abcde-fghjk-lmnpq-rstuv', ...fresh } })).status).toBe(200);
    expect((await call(env, 'POST', '/api/auth/recover', { body: { username: 'misty', code: RESET, ...fresh } })).status).toBe(400);

    const again = await login(env, 'misty', 'a brand new passphrase');
    env.DB.raw.exec(disableSql(misty.user.id, true, now));
    expect((await call(env, 'GET', '/api/me', { cookie: again.cookie })).status).toBe(401);
    expect((await login(env, 'misty', 'a brand new passphrase')).r.status).toBe(401);
    env.DB.raw.exec(disableSql(misty.user.id, false, now));
    expect((await login(env, 'misty', 'a brand new passphrase')).r.status).toBe(200);
  });

  it('bootstrap: the first admin, with no password until the reset code sets one; never a second time', async () => {
    const env = accountEnv({ SETUP_CODE: undefined });
    const now = Date.now();
    const sql = bootstrapSql({ id: 'u_first', username: 'Ash', recoveryHash: sha256('unused'), resetHash: sha256(RESET), now, expiresAt: now + RESET_TTL_MS });
    env.DB.raw.exec(sql);
    // No password works yet; the params look like any other name's.
    expect((await login(env, 'ash')).r.status).toBe(401);
    const r = await call(env, 'POST', '/api/auth/recover', { body: { username: 'ash', code: RESET, ...(await newKeyBody(PW)) } });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ username: 'Ash', role: 'admin' });
    expect((await login(env, 'ash')).r.status).toBe(200);
    // Once there is an account, the same SQL adds nothing.
    env.DB.raw.exec(bootstrapSql({ id: 'u_second', username: 'gary', recoveryHash: sha256('x'), resetHash: sha256('y'), now, expiresAt: now + 1 }));
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM reset_codes WHERE user_id = 'u_second'").get()).toEqual({ n: 0 });
  });
});
