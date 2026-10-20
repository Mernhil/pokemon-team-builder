/**
 * The friend list (docs/ACCOUNTS_PLAN.md section 10.2): small on purpose. Request → accept (or a single-use friend
 * code), remove, block. A pair has one `friendships` row (a < b). Sharing between two accounts needs an accepted
 * friendship (worker/api.ts); ending one (remove or block) deletes every share between the two, both ways, in the
 * same batch. A request by username answers the same whether or not the name exists, so it reveals nothing.
 */
import { FRIEND_LINK_LENGTH, FRIEND_LINK_TTL_MS, MAX_FRIENDS, MAX_LIVE_FRIEND_LINKS, MAX_PENDING, formatFriendCode, generateCode, usernameKey, type FriendInfo, type FriendsResponse } from '../src/domain/accounts';
import { sha256Hex } from './crypto';
import type { D1Like, D1Statement } from './types';

const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
export const NEUTRAL = 'If that person has an account, they’ll see your request.';

interface Row {
  other: string;
  username: string;
  display_name: string | null;
  disabled: number;
  state: 'pending' | 'accepted';
  requested_by: string;
  created_at: number;
  updated_at: number;
}

export async function friendsOf(db: D1Like, me: string): Promise<FriendsResponse> {
  const { results } = await db
    .prepare(
      `SELECT CASE WHEN f.a = ?1 THEN f.b ELSE f.a END AS other, u.username, u.display_name, u.disabled, f.state, f.requested_by, f.created_at, f.updated_at
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.a = ?1 THEN f.b ELSE f.a END
       WHERE f.a = ?1 OR f.b = ?1 ORDER BY u.username_key`,
    )
    .bind(me)
    .all<Row>();
  const info = (r: Row): FriendInfo => ({ id: r.other, username: r.username, ...(r.display_name ? { displayName: r.display_name } : {}), since: r.state === 'accepted' ? r.updated_at : r.created_at, ...(r.disabled ? { unavailable: true } : {}) });
  const blocked = await db.prepare('SELECT b.blocked AS id, u.username FROM blocks b JOIN users u ON u.id = b.blocked WHERE b.blocker = ? ORDER BY u.username_key').bind(me).all<{ id: string; username: string }>();
  return {
    friends: results.filter((r) => r.state === 'accepted').map(info),
    // A disabled account's requests wait unseen; mine to it are still listed (I can cancel them).
    incoming: results.filter((r) => r.state === 'pending' && r.requested_by !== me && !r.disabled).map(info),
    outgoing: results.filter((r) => r.state === 'pending' && r.requested_by === me).map(info),
    blocked: blocked.results,
  };
}

/** Friend requests waiting for this account's answer. */
export async function incomingCount(db: D1Like, me: string): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM friendships f JOIN users u ON u.id = f.requested_by WHERE (f.a = ?1 OR f.b = ?1) AND f.state = 'pending' AND f.requested_by <> ?1 AND u.disabled = 0",
    )
    .bind(me)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export const areFriends = async (db: D1Like, x: string, y: string): Promise<boolean> => {
  const [a, b] = pair(x, y);
  return !!(await db.prepare("SELECT 1 AS ok FROM friendships WHERE a = ? AND b = ? AND state = 'accepted'").bind(a, b).first());
};
const blockedEitherWay = async (db: D1Like, x: string, y: string) =>
  !!(await db.prepare('SELECT 1 AS ok FROM blocks WHERE (blocker = ?1 AND blocked = ?2) OR (blocker = ?2 AND blocked = ?1)').bind(x, y).first());
const counts = async (db: D1Like, me: string) =>
  (await db
    .prepare("SELECT SUM(state = 'accepted') AS friends, SUM(state = 'pending') AS pending FROM friendships WHERE a = ?1 OR b = ?1")
    .bind(me)
    .first<{ friends: number | null; pending: number | null }>()) ?? { friends: 0, pending: 0 };

export type FriendRefusal = 'too-many-friends' | 'they-have-too-many' | 'too-many-pending';
export const FRIEND_REFUSALS: Record<FriendRefusal, string> = {
  'too-many-friends': `You have the most friends there can be (${MAX_FRIENDS}). Remove one first.`,
  'they-have-too-many': 'They can’t take another friend right now.',
  'too-many-pending': `You have ${MAX_PENDING} requests waiting already. Wait for answers, or cancel some.`,
};

/**
 * A request by username. Unknown names, blocks (either way), yourself and existing friends all get the same quiet
 * nothing; the caller always answers NEUTRAL. A request to someone who already asked me accepts theirs.
 */
export async function requestFriend(db: D1Like, me: string, username: string, now: number): Promise<FriendRefusal | null> {
  const target = await db.prepare('SELECT id FROM users WHERE username_key = ? AND disabled = 0').bind(usernameKey(username)).first<{ id: string }>();
  if (!target || target.id === me || (await blockedEitherWay(db, me, target.id))) return null;
  const [a, b] = pair(me, target.id);
  const existing = await db.prepare('SELECT state, requested_by FROM friendships WHERE a = ? AND b = ?').bind(a, b).first<{ state: string; requested_by: string }>();
  if (existing?.state === 'accepted' || existing?.requested_by === me) return null;
  if (existing) return respond(db, me, target.id, true, now);
  const mine = await counts(db, me);
  if ((mine.friends ?? 0) >= MAX_FRIENDS) return 'too-many-friends';
  if ((mine.pending ?? 0) >= MAX_PENDING) return 'too-many-pending';
  // Their side full: dropped quietly (an answer would tell the requester something about them).
  if (((await counts(db, target.id)).pending ?? 0) >= MAX_PENDING) return null;
  await db.prepare("INSERT OR IGNORE INTO friendships (a, b, state, requested_by, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?)").bind(a, b, me, now, now).run();
  return null;
}

/** Accept or decline a request someone else made to me. */
export async function respond(db: D1Like, me: string, other: string, accept: boolean, now: number): Promise<FriendRefusal | null> {
  const [a, b] = pair(me, other);
  const row = await db.prepare("SELECT requested_by FROM friendships WHERE a = ? AND b = ? AND state = 'pending'").bind(a, b).first<{ requested_by: string }>();
  if (!row || row.requested_by === me) return null;
  if (!accept) {
    await db.prepare('DELETE FROM friendships WHERE a = ? AND b = ?').bind(a, b).run();
    return null;
  }
  if (((await counts(db, me)).friends ?? 0) >= MAX_FRIENDS) return 'too-many-friends';
  if (((await counts(db, other)).friends ?? 0) >= MAX_FRIENDS) return 'they-have-too-many';
  await db.prepare("UPDATE friendships SET state = 'accepted', updated_at = ? WHERE a = ? AND b = ?").bind(now, a, b).run();
  return null;
}

/** Every share between two people, both ways (they stop seeing each other's teams at their next sync). */
const sharesBetweenBoth = (db: D1Like, x: string, y: string): D1Statement => db.prepare('DELETE FROM shares WHERE (owner = ?1 AND grantee = ?2) OR (owner = ?2 AND grantee = ?1)').bind(x, y);

/** Remove a friend, cancel my request, or decline theirs; the shares between us go in the same batch. */
export async function removeFriend(db: D1Like, me: string, other: string): Promise<void> {
  const [a, b] = pair(me, other);
  await db.batch([db.prepare('DELETE FROM friendships WHERE a = ? AND b = ?').bind(a, b), sharesBetweenBoth(db, me, other)]);
}

/** Block: the friendship (or request) and every share between us go; their requests are dropped quietly from now on. */
export async function block(db: D1Like, me: string, other: string, now: number): Promise<boolean> {
  if (me === other || !(await db.prepare('SELECT 1 AS ok FROM users WHERE id = ?').bind(other).first())) return false;
  const [a, b] = pair(me, other);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO blocks (blocker, blocked, created_at) VALUES (?, ?, ?)').bind(me, other, now),
    db.prepare('DELETE FROM friendships WHERE a = ? AND b = ?').bind(a, b),
    sharesBetweenBoth(db, me, other),
  ]);
  return true;
}

export async function unblock(db: D1Like, me: string, other: string): Promise<void> {
  await db.prepare('DELETE FROM blocks WHERE blocker = ? AND blocked = ?').bind(me, other).run();
}

/** A new friend code (7 days, once); the oldest live ones beyond the limit and every expired one are dropped. */
export async function makeFriendLink(db: D1Like, me: string, now: number): Promise<{ code: string; expiresAt: number }> {
  const code = generateCode(FRIEND_LINK_LENGTH);
  const expiresAt = now + FRIEND_LINK_TTL_MS;
  await db.batch([
    db.prepare('DELETE FROM friend_links WHERE expires_at <= ? OR used_at IS NOT NULL').bind(now),
    db
      .prepare('DELETE FROM friend_links WHERE owner = ?1 AND code_hash NOT IN (SELECT code_hash FROM friend_links WHERE owner = ?1 ORDER BY created_at DESC LIMIT ?2)')
      .bind(me, MAX_LIVE_FRIEND_LINKS - 1),
    db.prepare('INSERT INTO friend_links (code_hash, owner, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(code), me, now, expiresAt),
  ]);
  return { code: formatFriendCode(code), expiresAt };
}

/**
 * Redeem a friend code: its maker and I are friends at once (they made it for that). Single use: the code is
 * claimed by the same statement that checks it, so two people can't both use it. False for anything wrong.
 */
export async function redeemFriendLink(db: D1Like, me: string, code: string, now: number): Promise<boolean | FriendRefusal> {
  const hash = await sha256Hex(code);
  const link = await db.prepare('SELECT owner FROM friend_links WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').bind(hash, now).first<{ owner: string }>();
  if (!link || link.owner === me || (await blockedEitherWay(db, me, link.owner))) return false;
  const owner = await db.prepare('SELECT disabled FROM users WHERE id = ?').bind(link.owner).first<{ disabled: number }>();
  if (!owner || owner.disabled) return false;
  if (!(await areFriends(db, me, link.owner))) {
    if (((await counts(db, me)).friends ?? 0) >= MAX_FRIENDS) return 'too-many-friends';
    if (((await counts(db, link.owner)).friends ?? 0) >= MAX_FRIENDS) return 'they-have-too-many';
  }
  const [a, b] = pair(me, link.owner);
  const [used] = await db.batch<{ owner: string }>([
    db.prepare('UPDATE friend_links SET used_by = ?, used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING owner').bind(me, now, hash, now),
    db
      .prepare(
        `INSERT INTO friendships (a, b, state, requested_by, created_at, updated_at)
         SELECT ?1, ?2, 'accepted', ?3, ?4, ?4 WHERE EXISTS (SELECT 1 FROM friend_links WHERE code_hash = ?5 AND used_by = ?6 AND used_at = ?4)
         ON CONFLICT (a, b) DO UPDATE SET state = 'accepted', updated_at = excluded.updated_at`,
      )
      .bind(a, b, link.owner, now, hash, me),
  ]);
  return !!used?.results?.length;
}
