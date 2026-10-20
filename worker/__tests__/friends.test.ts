import { describe, expect, it } from 'vitest';
import { MAX_FRIENDS, MAX_PENDING, THROTTLES, formatFriendCode, parseFriendCode } from '../../src/domain/accounts';
import { getFormat } from '../../src/domain/formats';
import type { PushDoc } from '../../src/domain/syncProtocol';
import { createTeam } from '../../src/domain/team';
import { sha256Hex } from '../crypto';
import { PW, accountEnv, call as rawCall, cookieOf, newKeyBody, type AccountEnv, type CallOptions } from './accountHelpers';
import { NOW } from './helpers';

const call = (env: AccountEnv, method: string, path: string, o: CallOptions = {}) => rawCall(env, method, path, { now: NOW, ...o });
type User = { cookie: string; id: string; username: string };

/** An admin and n more accounts, all past "Bring my teams from before". */
async function people(env: AccountEnv, ...names: string[]): Promise<User[]> {
  const out: User[] = [];
  for (const [i, username] of names.entries()) {
    let invite = env.SETUP_CODE;
    if (i > 0) invite = (await call(env, 'POST', '/api/admin/invites', { cookie: out[0].cookie, body: {} })).body.code;
    const r = await call(env, 'POST', '/api/auth/signup', { body: { invite, username, ...(await newKeyBody(PW)) } });
    expect(r.status).toBe(200);
    const u = { cookie: cookieOf(r)!, id: r.body.user.id as string, username };
    await call(env, 'POST', '/api/claim/skip', { cookie: u.cookie, body: {} });
    out.push(u);
  }
  return out;
}
const list = async (env: AccountEnv, u: User) => (await call(env, 'GET', '/api/friends', { cookie: u.cookie })).body;
const request = (env: AccountEnv, from: User, username: string) => call(env, 'POST', '/api/friends/request', { cookie: from.cookie, body: { username } });
const accept = (env: AccountEnv, me: User, other: User, yes = true) => call(env, 'POST', '/api/friends/respond', { cookie: me.cookie, body: { id: other.id, accept: yes } });
const befriend = async (env: AccountEnv, x: User, y: User) => {
  await request(env, x, y.username);
  await accept(env, y, x);
};
const team = (name: string) => ({ ...createTeam(getFormat('champions-vgc-reg-mc'), name), updatedAt: NOW - 5000, createdAt: NOW - 5000 });
const doc = (t: { id: string; updatedAt: number }): PushDoc => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, deleted: false, json: t });
async function shareTeam(env: AccountEnv, from: User, to: User) {
  const t = team(`${from.username}'s team`);
  await call(env, 'POST', '/api/sync', { cookie: from.cookie, body: { docs: [doc(t)] } });
  return { t, r: await call(env, 'PUT', '/api/shares', { cookie: from.cookie, body: { kind: 'team-group', ref: t.id, grantee: to.id, role: 'view' } }) };
}
const sharesCount = (env: AccountEnv) => (env.DB.raw.prepare('SELECT COUNT(*) AS n FROM shares').get() as { n: number }).n;

describe('requests', () => {
  it('request → the other sees it → accept: friends both ways, by username and name', async () => {
    const env = accountEnv();
    const [ash, misty] = await people(env, 'ash', 'Misty');
    await call(env, 'PUT', '/api/me', { cookie: misty.cookie, body: { displayName: 'Misty W.' } });
    const r = await request(env, ash, '@MISTY');
    expect(r.status).toBe(200);
    expect(r.body.notice).toMatch(/If that person has an account/);
    expect(r.body.outgoing).toEqual([{ id: misty.id, username: 'Misty', displayName: 'Misty W.', since: NOW }]);
    expect((await list(env, misty)).incoming.map((f: { username: string }) => f.username)).toEqual(['ash']);
    expect((await call(env, 'GET', '/api/me', { cookie: misty.cookie })).body.incomingFriends).toBe(1);
    // Only the other side answers.
    await accept(env, ash, misty);
    expect((await list(env, ash)).friends).toEqual([]);
    await accept(env, misty, ash);
    expect((await list(env, ash)).friends.map((f: { id: string }) => f.id)).toEqual([misty.id]);
    expect((await list(env, misty)).friends.map((f: { id: string }) => f.id)).toEqual([ash.id]);
    expect((await call(env, 'GET', '/api/me', { cookie: misty.cookie })).body.incomingFriends).toBe(0);
  });

  it('decline drops it; asking someone who already asked me accepts theirs', async () => {
    const env = accountEnv();
    const [ash, misty, brock] = await people(env, 'ash', 'misty', 'brock');
    await request(env, ash, 'misty');
    await accept(env, misty, ash, false);
    expect((await list(env, ash)).outgoing).toEqual([]);
    await request(env, brock, 'ash');
    await request(env, ash, 'brock');
    expect((await list(env, ash)).friends.map((f: { username: string }) => f.username)).toEqual(['brock']);
  });

  it('answers exactly the same for a name that doesn’t exist, myself, a blocker and an existing friend', async () => {
    const env = accountEnv();
    const [ash, misty, gary] = await people(env, 'ash', 'misty', 'gary');
    await befriend(env, ash, misty);
    await call(env, 'POST', '/api/blocks', { cookie: gary.cookie, body: { id: ash.id } });
    const bodies = [];
    for (const name of ['nobody-here', 'ash', 'gary', 'misty']) {
      const r = await request(env, ash, name);
      expect(r.status).toBe(200);
      bodies.push({ notice: r.body.notice, outgoing: r.body.outgoing });
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect((await list(env, gary)).incoming).toEqual([]); // dropped quietly
  });

  it('30 requests a day per person, whoever they are for', async () => {
    const env = accountEnv();
    const [ash] = await people(env, 'ash');
    for (let i = 0; i < THROTTLES.friendRequestUser.max; i++) expect((await request(env, ash, `nobody${i}`)).status).toBe(200);
    const r = await request(env, ash, 'nobody-else');
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
  });

  it(`at most ${MAX_PENDING} pending requests and ${MAX_FRIENDS} friends`, async () => {
    const env = accountEnv();
    const [ash, misty] = await people(env, 'ash', 'misty');
    // Fill Ash's pending list directly (making 20 accounts through the API is slow).
    for (let i = 0; i < MAX_PENDING; i++) {
      const id = `u_fake${String(i).padStart(8, '0')}`;
      env.DB.raw.prepare("INSERT INTO users (id, username, username_key, pw_hash, pw_changed_at, recovery_hash, created_at, claim_state) VALUES (?, ?, ?, '!', 0, 'x', 0, 'skipped')").run(id, `fake${i}`, `fake${i}`);
      const [a, b] = ash.id < id ? [ash.id, id] : [id, ash.id];
      env.DB.raw.prepare("INSERT INTO friendships (a, b, state, requested_by, created_at, updated_at) VALUES (?, ?, 'pending', ?, 0, 0)").run(a, b, ash.id);
    }
    const r = await request(env, ash, 'misty');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/requests waiting/);
    env.DB.raw.prepare("UPDATE friendships SET state = 'accepted'").run();
    for (let i = MAX_PENDING; i < MAX_FRIENDS; i++) {
      const id = `u_fake${String(i).padStart(8, '0')}`;
      env.DB.raw.prepare("INSERT INTO users (id, username, username_key, pw_hash, pw_changed_at, recovery_hash, created_at, claim_state) VALUES (?, ?, ?, '!', 0, 'x', 0, 'skipped')").run(id, `fake${i}`, `fake${i}`);
      const [a, b] = ash.id < id ? [ash.id, id] : [id, ash.id];
      env.DB.raw.prepare("INSERT INTO friendships (a, b, state, requested_by, created_at, updated_at) VALUES (?, ?, 'accepted', ?, 0, 0)").run(a, b, ash.id);
    }
    expect((await request(env, ash, 'misty')).body.error).toMatch(/most friends/);
    // Misty asks Ash: Ash can't accept while full.
    await request(env, misty, 'ash');
    expect((await accept(env, ash, misty)).status).toBe(409);
  });
});

describe('friend codes', () => {
  it('make one (shown once, only the hash kept), redeem it: friends at once; once only', async () => {
    const env = accountEnv();
    const [ash, misty, brock] = await people(env, 'ash', 'misty', 'brock');
    const made = await call(env, 'POST', '/api/friends/link', { cookie: ash.cookie, body: {} });
    expect(made.body.code).toMatch(/^FR-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const raw = parseFriendCode(made.body.code)!;
    expect(formatFriendCode(raw)).toBe(made.body.code);
    expect(env.DB.raw.prepare('SELECT code_hash FROM friend_links').get()).toEqual({ code_hash: await sha256Hex(raw) });
    // My own code does nothing.
    expect((await call(env, 'POST', '/api/friends/link/redeem', { cookie: ash.cookie, body: { code: made.body.code } })).status).toBe(400);
    const r = await call(env, 'POST', '/api/friends/link/redeem', { cookie: misty.cookie, body: { code: made.body.code.toLowerCase().replace(/-/g, ' ') } });
    expect(r.status).toBe(200);
    expect(r.body.friends.map((f: { username: string }) => f.username)).toEqual(['ash']);
    const again = await call(env, 'POST', '/api/friends/link/redeem', { cookie: brock.cookie, body: { code: made.body.code } });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/doesn’t work/);
  });

  it('expires after 7 days; blocked people can’t use it; redeeming is throttled per address', async () => {
    const env = accountEnv();
    const [ash, misty, gary] = await people(env, 'ash', 'misty', 'gary');
    const old = await call(env, 'POST', '/api/friends/link', { cookie: ash.cookie, body: {} });
    expect((await call(env, 'POST', '/api/friends/link/redeem', { cookie: misty.cookie, body: { code: old.body.code }, now: NOW + 7 * 86_400_000 + 1 })).status).toBe(400);
    await call(env, 'POST', '/api/blocks', { cookie: ash.cookie, body: { id: gary.id } });
    const fresh = await call(env, 'POST', '/api/friends/link', { cookie: ash.cookie, body: {} });
    expect((await call(env, 'POST', '/api/friends/link/redeem', { cookie: gary.cookie, body: { code: fresh.body.code } })).status).toBe(400);
    for (let i = 0; i < THROTTLES.friendLinkIp.max; i++) await call(env, 'POST', '/api/friends/link/redeem', { cookie: misty.cookie, body: { code: 'FR-AAAAA-AAAAA' }, ip: '10.0.0.9' });
    expect((await call(env, 'POST', '/api/friends/link/redeem', { cookie: misty.cookie, body: { code: fresh.body.code }, ip: '10.0.0.9' })).status).toBe(429);
  });
});

describe('sharing needs a friendship', () => {
  it('refused to a non-friend, allowed to a friend; removing the friend deletes every share both ways', async () => {
    const env = accountEnv();
    const [ash, misty] = await people(env, 'ash', 'misty');
    expect((await shareTeam(env, ash, misty)).r.status).toBe(403);
    await befriend(env, ash, misty);
    expect((await shareTeam(env, ash, misty)).r.status).toBe(200);
    expect((await shareTeam(env, misty, ash)).r.status).toBe(200);
    expect(sharesCount(env)).toBe(2);
    await call(env, 'DELETE', '/api/friends', { cookie: misty.cookie, body: { id: ash.id } });
    expect(sharesCount(env)).toBe(0);
    expect((await call(env, 'GET', '/api/shared', { cookie: misty.cookie })).body.docs).toEqual([]);
    expect((await list(env, ash)).friends).toEqual([]);
  });

  it('block: the friendship and every share go at once, their requests are dropped, unblock lets them ask again', async () => {
    const env = accountEnv();
    const [ash, misty] = await people(env, 'ash', 'misty');
    await befriend(env, ash, misty);
    await shareTeam(env, ash, misty);
    await shareTeam(env, misty, ash);
    const blocked = await call(env, 'POST', '/api/blocks', { cookie: ash.cookie, body: { id: misty.id } });
    expect(blocked.body.blocked).toEqual([{ id: misty.id, username: 'misty' }]);
    expect(blocked.body.friends).toEqual([]);
    expect(sharesCount(env)).toBe(0);
    await request(env, misty, 'ash');
    expect((await list(env, ash)).incoming).toEqual([]);
    expect((await list(env, misty)).outgoing).toEqual([]);
    await call(env, 'DELETE', '/api/blocks', { cookie: ash.cookie, body: { id: misty.id } });
    await request(env, misty, 'ash');
    expect((await list(env, ash)).incoming.map((f: { id: string }) => f.id)).toEqual([misty.id]);
  });

  it('a disabled friend is "unavailable" and their shares are hidden; enabling brings them back', async () => {
    const env = accountEnv();
    const [ash, misty] = await people(env, 'ash', 'misty');
    await befriend(env, ash, misty);
    await shareTeam(env, misty, ash);
    await call(env, 'POST', '/api/admin/users/disable', { cookie: ash.cookie, body: { id: misty.id } });
    expect((await list(env, ash)).friends).toEqual([expect.objectContaining({ id: misty.id, unavailable: true })]);
    expect((await call(env, 'GET', '/api/shared', { cookie: ash.cookie })).body.docs).toEqual([]);
    await call(env, 'POST', '/api/admin/users/enable', { cookie: ash.cookie, body: { id: misty.id } });
    expect((await list(env, ash)).friends[0].unavailable).toBeUndefined();
    expect((await call(env, 'GET', '/api/shared', { cookie: ash.cookie })).body.docs).toHaveLength(1);
  });

  it('the share access rules themselves are unchanged (the friend reads only what was shared)', async () => {
    const env = accountEnv();
    const [ash, misty] = await people(env, 'ash', 'misty');
    await befriend(env, ash, misty);
    const other = team('Not shared');
    await call(env, 'POST', '/api/sync', { cookie: ash.cookie, body: { docs: [doc(other)] } });
    const { t } = await shareTeam(env, ash, misty);
    const got = await call(env, 'GET', '/api/shared', { cookie: misty.cookie });
    expect(got.body.docs.map((d: { id: string }) => d.id)).toEqual([t.id]);
    // A view share can't be written.
    const w = await call(env, 'POST', '/api/shared', { cookie: misty.cookie, body: { docs: [{ ...doc({ ...t, updatedAt: NOW }), owner: ash.id }] } });
    expect(w.body.results[0].status).toBe('denied');
  });
});
