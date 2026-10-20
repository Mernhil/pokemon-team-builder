/**
 * GET /api/sync?since=<seq> and POST /api/sync: the whole server side of cloud sync. Every request
 * is for one account, identified only by the e-mail in a verified Cloudflare Access JWT. Payloads
 * are validated with the zod schemas in src/domain/syncProtocol.ts, and each document is run
 * through the same sanitisers the app loads its own data with before it is stored.
 */
import { sanitizeMatch, sanitizeTeam } from '../src/domain/sanitize';
import {
  LIMITS,
  MAX_SHARES,
  ProfileSchema,
  PushBodySchema,
  ShareSchema,
  SharedPushBodySchema,
  UnshareSchema,
  type PullResponse,
  type PushResponse,
  type PushResult,
  type SharedPullResponse,
  type SharesResponse,
  USER_ID_RE,
  normalizeIdentity,
} from '../src/domain/syncProtocol';
import { areFriends } from './friends';
import { ownerForEmail } from './claim';
import { ALL_MATCHES, accessTo, canWrite, type Target } from './access';
import { AuthError, jwksProvider, verifyAccessJwt, type KeyProvider } from './auth';
import { RedeemSchema, type DevicesResponse, type PairResponse, type RedeemResponse, TOKEN_RE } from '../src/domain/pairing';
import { SESSION_TOKEN_RE, usernameKey } from '../src/domain/accounts';
import { health } from './health';
import { accountsEnabled, crossSiteRequest, findSession, handleAuth, isAccountPath, renewedCookie, type AuthDeps, type Authed } from './authApi';
import { revokeSession } from './sessions';
import { JSON_HEADERS, fail, firstIssue, preflight, readJson, reply, withCors } from './http';
import { createPairCode, deviceByToken, listDevices, redeemAttemptAllowed, redeemPairCode, revokeDevice } from './devices';
import { deleteShare, groupOfTeam, isLiveRootTeam, namesFor, putShare, setDisplayName, sharedDocs, sharesBetween, sharesOf } from './shares';
import { pullDocs, pushDoc, type StoredDoc } from './store';
import type { Env } from './types';

/** 501, naming which of the three settings the deployment lacks (the app turns it into a hint; docs/SYNC.md has the steps). */
const notSetUp = (env: Env, needAccess: boolean) => {
  const missing = [!env.DB && 'DB', needAccess && !env.ACCESS_TEAM_DOMAIN && 'ACCESS_TEAM_DOMAIN', needAccess && !env.ACCESS_AUD && 'ACCESS_AUD'].filter(Boolean);
  return reply(501, { error: 'sync is not set up on this deployment', missing });
};

/** A device whose clock is further ahead than this can't win every future conflict: its documents are refused. */
export const MAX_FUTURE_MS = 10 * 60 * 1000;

const ROUTES: Record<string, string[]> = {
  '/api/sync': ['GET', 'POST'],
  '/api/shared': ['GET', 'POST'],
  '/api/shares': ['GET', 'PUT', 'DELETE'],
  '/api/profile': ['PUT'],
  // Signed in with Access (the phone or the website): make a pairing code, see and revoke linked devices.
  '/api/pair': ['POST'],
  '/api/devices': ['GET', 'DELETE'],
  // Re-login inside the installed app: needs the Access login, then sends the browser back to the app.
  '/api/session/renew': ['GET'],
  // Is the deployment set up (database, migrations, Access settings)? Says nothing about any account.
  '/api/health': ['GET'],
};

/** Routes a linked device may use under /api/device/ (bearer token instead of Access). Not pairing or the device list. */
const DEVICE_ROUTES = new Set(['/api/sync', '/api/shared', '/api/shares', '/api/profile']);

/** "/api/me" or "/api/device/me" → "/api/me" when it is an account route; otherwise null. */
function accountPathOf(pathname: string): string | null {
  if (isAccountPath(pathname)) return pathname;
  if (!pathname.startsWith('/api/device/')) return null;
  const inner = `/api/${pathname.slice('/api/device/'.length)}`;
  return isAccountPath(inner) ? inner : null;
}

export interface ApiDeps extends AuthDeps {
  /** Signing keys, injected by tests; by default the Access team's published keys. */
  keys?: KeyProvider;
}

export async function handleApi(request: Request, env: Env, deps: ApiDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  // The app's own accounts (AUTH_MODE "both" or "accounts"); otherwise these paths are not routes at all. While
  // Cloudflare Access is in front of the site, the desktop app reaches them under /api/device/ (already a Bypass path).
  const accountPath = accountsEnabled(env) ? accountPathOf(url.pathname) : null;
  if (accountPath) {
    if (request.method === 'OPTIONS') return preflight(origin, env);
    // "Bring my teams from before" needs the old identity too: the e-mail of a verified Access JWT on the same request.
    const accessEmail = async () => {
      const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
      if (!jwt || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
      try {
        return (await verifyAccessJwt(jwt, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD }, deps.keys ?? jwksProvider(env.ACCESS_TEAM_DOMAIN), (deps.now ?? Date.now)())).email;
      } catch {
        return null;
      }
    };
    return withCors(await handleAuth(request, env, new URL(accountPath, url), { ...deps, accessEmail }), origin, env);
  }
  if (url.pathname.startsWith('/api/device/')) {
    if (request.method === 'OPTIONS') return preflight(origin, env);
    return withCors(await handleDevice(request, env, url, deps), origin, env);
  }
  const route = ROUTES[url.pathname];
  if (!route) return fail(404, 'not found');
  if (!route.includes(request.method)) return fail(405, 'method not allowed');
  const isHealth = url.pathname === '/api/health';
  // Renewing a session and the health report don't touch the database; health reports what is missing instead of refusing.
  const needsDb = url.pathname !== '/api/session/renew' && !isHealth;

  // With the app's own accounts, a session (the web cookie, or a bearer token) says who this is, before Access does.
  if (needsDb && env.DB && accountsEnabled(env)) {
    const now = (deps.now ?? Date.now)();
    const auth = await findSession(env.DB, request, now);
    if (auth) {
      if (auth.viaCookie && request.method !== 'GET' && crossSiteRequest(request, env, url)) return fail(403, 'request refused');
      return asAccount(auth, request, env, url.pathname, now);
    }
    // No session, and no Access to fall back on (after Access is gone): simply not signed in.
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return fail(401, 'not signed in');
  }
  const { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: audience } = env;
  // The report is booleans, migration names and the time: public once accounts are on (Access may be on Bypass by then),
  // and without Access settings there is nothing to verify a token against anyway.
  if (isHealth && (accountsEnabled(env) || !teamDomain || !audience)) return reply(200, await health(env, (deps.now ?? Date.now)()));
  if (!teamDomain || !audience || (needsDb && !env.DB)) return notSetUp(env, true);

  // Who is asking: only a verified Access token counts, never a header the client could have written.
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return fail(401, 'not signed in');
  let owner: string;
  try {
    ({ email: owner } = await verifyAccessJwt(token, { teamDomain, audience }, deps.keys ?? jwksProvider(teamDomain), (deps.now ?? Date.now)()));
  } catch (e) {
    return fail(401, e instanceof AuthError ? `not signed in (${e.message})` : 'not signed in');
  }
  const now = (deps.now ?? Date.now)();
  if (isHealth) return reply(200, await health(env, now));
  // The Access login just happened (or the cookie was still good): back to the app, which now holds a fresh session.
  if (url.pathname === '/api/session/renew') return new Response(null, { status: 302, headers: { location: '/', 'cache-control': 'no-store' } });
  // With accounts on, an e-mail whose data an account has claimed is that account now (worker/claim.ts).
  if (accountsEnabled(env)) {
    const mapped = await ownerForEmail(env.DB!, owner);
    if (!mapped) return fail(403, 'this account is disabled');
    owner = mapped;
  }
  return handleAccount(request, env, url.pathname, owner, now);
}

/**
 * /api/device/*: the desktop app, which can't pass Access. Access must let these paths through
 * (a bypass policy, docs/SYNC.md), so everything here is checked by the Worker itself: a pairing
 * code or a device token that was issued to a signed-in account and can be revoked.
 */
/**
 * A request identified by a session. While the account hasn't decided about its data from before accounts
 * ("Bring my teams from before" is pending, Access still in front), sync waits: syncing first would give the account
 * documents of its own, and then it could no longer take over the old ones.
 */
async function asAccount(auth: Authed, request: Request, env: Env, path: string, now: number): Promise<Response> {
  if (env.AUTH_MODE === 'both' && auth.session.claimState === 'pending') {
    return reply(409, { error: 'Bring your teams from before into your account first, or skip it: Settings → Account.', code: 'claim-pending' });
  }
  const res = await handleAccount(request, env, path, auth.session.user.id, now);
  const again = renewedCookie(auth, request, now);
  if (again && !res.headers.has('set-cookie')) res.headers.append('set-cookie', again);
  return res;
}

async function handleDevice(request: Request, env: Env, url: URL, deps: ApiDeps): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  if (!env.DB) return notSetUp(env, false);
  const sub = `/api/${url.pathname.slice('/api/device/'.length)}`;

  if (sub === '/api/redeem') {
    if (request.method !== 'POST') return fail(405, 'method not allowed');
    // Cloudflare sets this header at its edge; a request without it (local development) shares one bucket.
    if (!(await redeemAttemptAllowed(env.DB, request.headers.get('cf-connecting-ip') ?? 'unknown', now))) {
      return new Response(JSON.stringify({ error: 'too many attempts: wait a few minutes and try again' }), { status: 429, headers: { ...JSON_HEADERS, 'retry-after': '600' } });
    }
    const r = await readJson(request, 1024);
    if ('response' in r) return r.response;
    const parsed = RedeemSchema.safeParse(r.body);
    if (!parsed.success) return fail(400, 'that is not a pairing code');
    const out = await redeemPairCode(env.DB, parsed.data.code, parsed.data.name, now);
    if ('error' in out) return out.error === 'invalid' ? fail(400, 'that code is wrong, already used or has expired') : fail(409, 'this account already has the most devices it can link: remove one on the phone first');
    return reply(200, out satisfies RedeemResponse);
  }

  const isSelf = sub === '/api/self';
  if (!isSelf && !DEVICE_ROUTES.has(sub)) return fail(404, 'not found');
  const methods = isSelf ? ['DELETE'] : ROUTES[sub];
  if (!methods.includes(request.method)) return fail(405, 'method not allowed');

  const bearer = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  // The desktop app logged in with its account: its session token (ptbs_…), here because Access lets /api/device/* through.
  if (bearer && SESSION_TOKEN_RE.test(bearer)) {
    const auth = accountsEnabled(env) ? await findSession(env.DB, request, now) : null;
    if (!auth) return fail(401, 'not signed in');
    if (isSelf) {
      await revokeSession(env.DB, auth.session.user.id, auth.session.id);
      return reply(200, { ok: true });
    }
    return asAccount(auth, request, env, sub, now);
  }
  const device = bearer && TOKEN_RE.test(bearer) ? await deviceByToken(env.DB, bearer, now) : null;
  if (!device) return fail(401, 'this device is not linked (or was unlinked)');
  // A desktop app linked before a claim belongs to the account now; a disabled account's devices stop.
  if (accountsEnabled(env) && device.owner.startsWith('u_')) {
    const u = await env.DB.prepare('SELECT disabled FROM users WHERE id = ?').bind(device.owner).first<{ disabled: number }>();
    if (!u || u.disabled === 1) return fail(401, 'this device is not linked (or was unlinked)');
  }
  if (isSelf) {
    await revokeDevice(env.DB, device.owner, device.id);
    return reply(200, { ok: true });
  }
  return handleAccount(request, env, sub, device.owner, now);
}

/** The routes that act for one account, however it was identified (Access JWT or device token). */
async function handleAccount(request: Request, env: Env, path: string, owner: string, now: number): Promise<Response> {
  const url = new URL(request.url);
  if (path === '/api/pair') {
    const live = await createPairCode(env.DB!, owner, now);
    return reply(200, live satisfies PairResponse);
  }
  if (path === '/api/devices') {
    if (request.method === 'GET') return reply(200, { devices: await listDevices(env.DB!, owner) } satisfies DevicesResponse);
    const r = await readJson(request, 1024);
    if ('response' in r) return r.response;
    const id = (r.body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id.length > 64) return fail(400, 'id is required');
    await revokeDevice(env.DB!, owner, id);
    return reply(200, { devices: await listDevices(env.DB!, owner) } satisfies DevicesResponse);
  }

  if (path === '/api/shared') return handleShared(request, env, owner, now);
  if (path === '/api/shares') return handleShares(request, env, owner, now);
  if (path === '/api/profile') return handleProfile(request, env, owner);

  if (request.method === 'GET') {
    const raw = url.searchParams.get('since') ?? '0';
    const since = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(since)) return fail(400, 'since must be a whole number');
    const page = await pullDocs(env.DB!, owner, since, LIMITS.pageSize);
    return reply(200, page satisfies PullResponse);
  }

  // POST
  const text = await request.text();
  if (text.length > LIMITS.maxBodyChars) return fail(413, 'request too large');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'body is not JSON');
  }
  const parsed = PushBodySchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(400, `invalid request at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }

  const prepared: StoredDoc[] = [];
  for (const d of parsed.data.docs) {
    const r = prepareDoc(d, now);
    if ('error' in r) return fail(r.status, r.error);
    prepared.push(r.doc);
  }

  const results: PushResult[] = [];
  for (const d of prepared) {
    const r = await pushDoc(env.DB!, owner, d);
    results.push(r.status === 'applied' ? { id: d.id, kind: d.kind, status: 'applied' } : { id: d.id, kind: d.kind, status: 'stale', doc: r.doc });
  }
  return reply(200, { results } satisfies PushResponse);
}

type PreparedResult = { doc: StoredDoc } | { error: string; status: number };

/** Validates one incoming document and turns it into what is stored: sanitised, size-limited, never from the future. */
function prepareDoc(d: { id: string; kind: 'team' | 'match'; updatedAt: number; deleted: boolean; json?: unknown }, now: number): PreparedResult {
  if (d.updatedAt > now + MAX_FUTURE_MS) return { status: 400, error: `${d.kind} ${d.id}: updatedAt is in the future (check this device's clock)` };
  if (d.deleted) return { doc: { id: d.id, kind: d.kind, updatedAt: d.updatedAt, deleted: true, json: null } };
  const size = JSON.stringify(d.json).length;
  if (size > LIMITS.maxDocChars) return { status: 413, error: `${d.kind} ${d.id} is too large (${size} characters, limit ${LIMITS.maxDocChars})` };
  const clean = d.kind === 'team' ? sanitizeTeam(d.json) : sanitizeMatch(d.json);
  // The sanitiser replaces an invalid id with a fresh one; a document whose own id doesn't match its row is refused.
  if (!clean || clean.id !== d.id) return { status: 400, error: `${d.kind} ${d.id}: not a valid ${d.kind}` };
  // `shared` marks a copy someone else owns on a device; it never belongs in an account's own documents.
  if (d.kind === 'team') delete (clean as { shared?: unknown }).shared;
  const groupId = d.kind === 'team' ? ((clean as { groupId?: string }).groupId ?? clean.id) : undefined;
  return { doc: { id: d.id, kind: d.kind, updatedAt: d.updatedAt, deleted: false, json: JSON.stringify(clean), groupId } };
}

/** GET /api/shared: what others have shared with me. POST: my edits to folders shared with edit rights. */
async function handleShared(request: Request, env: Env, me: string, now: number): Promise<Response> {
  const db = env.DB!;
  if (request.method === 'GET') {
    const docs = await sharedDocs(db, me, 2000);
    const names = await namesFor(db, docs.map((d) => d.owner));
    return reply(200, { docs, names } satisfies SharedPullResponse);
  }
  const r = await readJson(request);
  if ('response' in r) return r.response;
  const parsed = SharedPushBodySchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));

  const results: PushResult[] = [];
  const sharesCache = new Map<string, Awaited<ReturnType<typeof sharesBetween>>>();
  for (const d of parsed.data.docs) {
    const owner = normalizeIdentity(d.owner);
    if (owner === me) return fail(400, 'these are your own documents: use /api/sync');
    if (d.kind !== 'team') {
      results.push({ id: d.id, kind: d.kind, status: 'denied' });
      continue;
    }
    const prepared = prepareDoc(d, now);
    if ('error' in prepared) return fail(prepared.status, prepared.error);
    const doc = prepared.doc;
    // The folder this write is for: the one the existing row is in (a new variation names its own).
    const existing = await groupOfTeam(db, owner, d.id);
    const group = doc.deleted ? existing : doc.groupId ?? null;
    let allowed = group !== null && (existing === null || existing === group);
    // An editor can change and add variations, never delete the folder's top-level team.
    if (allowed && doc.deleted && group === d.id) allowed = false;
    if (allowed) {
      if (!sharesCache.has(owner)) sharesCache.set(owner, await sharesBetween(db, owner, me));
      const target: Target = { kind: 'team', group: group! };
      allowed = canWrite(accessTo(me, owner, target, sharesCache.get(owner)!), target);
    }
    if (!allowed) {
      results.push({ id: d.id, kind: 'team', status: 'denied' });
      continue;
    }
    const w = await pushDoc(db, owner, doc);
    results.push(w.status === 'applied' ? { id: d.id, kind: 'team', status: 'applied' } : { id: d.id, kind: 'team', status: 'stale', doc: w.doc });
  }
  return reply(200, { results } satisfies PushResponse);
}

/** GET /api/shares: my shares in both directions and the display names. PUT: share. DELETE: stop sharing (or leave). */
async function handleShares(request: Request, env: Env, me: string, now: number): Promise<Response> {
  const db = env.DB!;
  const list = async (): Promise<Response> => {
    const { granted, received } = await sharesOf(db, me);
    const names = await namesFor(db, [me, ...granted.map((s) => s.grantee), ...received.map((s) => s.owner)]);
    return reply(200, { me: { email: me, displayName: names[me] }, granted, received, names } satisfies SharesResponse);
  };
  if (request.method === 'GET') return list();
  const r = await readJson(request, 4096);
  if ('response' in r) return r.response;

  if (request.method === 'PUT') {
    const parsed = ShareSchema.safeParse(r.body);
    if (!parsed.success) return fail(400, firstIssue(parsed.error));
    let s = parsed.data;
    // "@name": an account, by its username.
    if (s.grantee.startsWith('@')) {
      const row = accountsEnabled(env) ? await db.prepare('SELECT id FROM users WHERE username_key = ? AND disabled = 0').bind(usernameKey(s.grantee.slice(1))).first<{ id: string }>() : null;
      if (!row) return fail(400, 'No account has that username.');
      s = { ...s, grantee: row.id };
    } else if (accountsEnabled(env) && s.grantee.includes('@')) {
      // An e-mail whose data an account has claimed is that account.
      const grantee = await ownerForEmail(db, s.grantee);
      if (!grantee) return fail(400, "that account can't receive shares");
      s = { ...s, grantee };
    }
    if (s.grantee === me) return fail(400, "you can't share with yourself");
    // Between accounts, only with a friend (Settings → Friends). People still on Access alone share as before.
    if (accountsEnabled(env) && USER_ID_RE.test(me)) {
      if (!USER_ID_RE.test(s.grantee)) return fail(400, 'Share with a friend: add them in Settings → Friends first.');
      if (!(await areFriends(db, me, s.grantee))) return fail(403, 'You can only share with friends: add them in Settings → Friends first.');
    }
    if (s.kind === 'matches') {
      if (s.ref !== ALL_MATCHES) return fail(400, 'the match log is shared as a whole');
      if (s.role !== 'view') return fail(400, 'a shared match log is view only');
    } else if (!(await isLiveRootTeam(db, me, s.ref))) {
      return fail(400, 'only a top-level team of yours that has been synced can be shared (turn sync on and sync once)');
    }
    const { granted } = await sharesOf(db, me);
    const isNew = !granted.some((g) => g.grantee === s.grantee && g.kind === s.kind && g.ref === s.ref);
    if (isNew && granted.length >= MAX_SHARES) return fail(400, `at most ${MAX_SHARES} shares`);
    await putShare(db, me, s, now);
    return list();
  }

  // DELETE: the owner stops sharing, or the grantee leaves a share (`owner` names whose).
  const parsed = UnshareSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  const u = parsed.data;
  if (u.owner && normalizeIdentity(u.owner) !== me) {
    if (u.grantee !== me) return fail(403, 'not yours to remove');
    await deleteShare(db, normalizeIdentity(u.owner), me, u.kind, u.ref);
  } else {
    await deleteShare(db, me, u.grantee, u.kind, u.ref);
  }
  return list();
}

async function handleProfile(request: Request, env: Env, me: string): Promise<Response> {
  const r = await readJson(request, 1024);
  if ('response' in r) return r.response;
  const parsed = ProfileSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  await setDisplayName(env.DB!, me, parsed.data.displayName);
  return reply(200, { displayName: parsed.data.displayName || null });
}
