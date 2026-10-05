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
} from '../src/domain/syncProtocol';
import { ALL_MATCHES, accessTo, canWrite, type Target } from './access';
import { AuthError, jwksProvider, verifyAccessJwt, type KeyProvider } from './auth';
import { RedeemSchema, type DevicesResponse, type PairResponse, type RedeemResponse, TOKEN_RE } from '../src/domain/pairing';
import { createPairCode, deviceByToken, listDevices, redeemPairCode, revokeDevice } from './devices';
import { deleteShare, groupOfTeam, isLiveRootTeam, namesFor, putShare, setDisplayName, sharedDocs, sharesBetween, sharesOf } from './shares';
import { pullDocs, pushDoc, type StoredDoc } from './store';
import type { Env } from './types';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

/** The desktop app's webview origins. A linked device sends a bearer token (never cookies), so this only lets its page read the answers. */
const DEVICE_ORIGINS = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://localhost:1420']);
const withCors = (res: Response, origin: string | null): Response => {
  if (!origin || !DEVICE_ORIGINS.has(origin)) return res;
  const r = new Response(res.body, res);
  r.headers.set('access-control-allow-origin', origin);
  r.headers.set('vary', 'origin');
  return r;
};
const fail = (status: number, error: string) => reply(status, { error });

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
};

/** Routes a linked device may use under /api/device/ (bearer token instead of Access). Not pairing or the device list. */
const DEVICE_ROUTES = new Set(['/api/sync', '/api/shared', '/api/shares', '/api/profile']);

export interface ApiDeps {
  /** Signing keys, injected by tests; by default the Access team's published keys. */
  keys?: KeyProvider;
  now?: () => number;
}

export async function handleApi(request: Request, env: Env, deps: ApiDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/device/')) {
    const origin = request.headers.get('origin');
    if (request.method === 'OPTIONS') {
      const preflight = new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400' } });
      return withCors(preflight, origin);
    }
    return withCors(await handleDevice(request, env, url, deps), origin);
  }
  const route = ROUTES[url.pathname];
  if (!route) return fail(404, 'not found');
  if (!route.includes(request.method)) return fail(405, 'method not allowed');
  if (!env.DB || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return fail(501, 'sync is not set up on this deployment');

  // Who is asking: only a verified Access token counts, never a header the client could have written.
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return fail(401, 'not signed in');
  let owner: string;
  try {
    ({ email: owner } = await verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD }, deps.keys ?? jwksProvider(env.ACCESS_TEAM_DOMAIN), (deps.now ?? Date.now)()));
  } catch (e) {
    return fail(401, e instanceof AuthError ? `not signed in (${e.message})` : 'not signed in');
  }
  return handleAccount(request, env, url.pathname, owner, (deps.now ?? Date.now)());
}

/**
 * /api/device/*: the desktop app, which can't pass Access. Access must let these paths through
 * (a bypass policy, docs/SYNC.md), so everything here is checked by the Worker itself: a pairing
 * code or a device token that was issued to a signed-in account and can be revoked.
 */
async function handleDevice(request: Request, env: Env, url: URL, deps: ApiDeps): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  if (!env.DB) return fail(501, 'sync is not set up on this deployment');
  const sub = `/api/${url.pathname.slice('/api/device/'.length)}`;

  if (sub === '/api/redeem') {
    if (request.method !== 'POST') return fail(405, 'method not allowed');
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
  const device = bearer && TOKEN_RE.test(bearer) ? await deviceByToken(env.DB, bearer, now) : null;
  if (!device) return fail(401, 'this device is not linked (or was unlinked)');
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

async function readJson(request: Request, max = LIMITS.maxBodyChars): Promise<{ body: unknown } | { response: Response }> {
  const text = await request.text();
  if (text.length > max) return { response: fail(413, 'request too large') };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { response: fail(400, 'body is not JSON') };
  }
}
const firstIssue = (e: { issues: { path: PropertyKey[]; message: string }[] }) => `invalid request at ${e.issues[0].path.join('.') || '(root)'}: ${e.issues[0].message}`;

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
    const owner = d.owner.trim().toLowerCase();
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
    const s = parsed.data;
    if (s.grantee === me) return fail(400, "you can't share with yourself");
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
  if (u.owner && u.owner.trim().toLowerCase() !== me) {
    if (u.grantee !== me) return fail(403, 'not yours to remove');
    await deleteShare(db, u.owner.trim().toLowerCase(), me, u.kind, u.ref);
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
