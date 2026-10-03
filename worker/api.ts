/**
 * The server side of cloud sync and sharing: GET/POST /api/sync (the caller's own documents), GET/POST /api/shared
 * (other accounts' folders and match logs shared with the caller) and GET/POST /api/shares (who can see what). Every request
 * is for one account, identified only by the e-mail in a verified Cloudflare Access JWT. Payloads
 * are validated with the zod schemas in src/domain/syncProtocol.ts, and each document is run
 * through the same sanitisers the app loads its own data with before it is stored.
 */
import { sanitizeMatch, sanitizeTeam } from '../src/domain/sanitize';
import { LIMITS, PushBodySchema, SharedPushSchema, ShareOpSchema, type PullResponse, type PushDoc, type PushResponse, type PushResult } from '../src/domain/syncProtocol';
import { AuthError, jwksProvider, verifyAccessJwt, type KeyProvider } from './auth';
import { docMeta, pullDocs, pushDoc, type StoredDoc } from './store';
import { mySharing, roleFor, setDisplayName, sharedWith, shareFolder, shareMatches, unshareFolder, type ShareResult } from './shares';
import type { Env } from './types';

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const fail = (status: number, error: string) => reply(status, { error });

/** A device whose clock is further ahead than this can't win every future conflict: its documents are refused. */
export const MAX_FUTURE_MS = 10 * 60 * 1000;

export interface ApiDeps {
  /** Signing keys, injected by tests; by default the Access team's published keys. */
  keys?: KeyProvider;
  now?: () => number;
}

const ROUTES = new Set(['/api/sync', '/api/shared', '/api/shares']);

/** Validates and sanitises pushed documents; a Response is an error to return as is. */
function prepare(docs: PushDoc[], now: number): StoredDoc[] | Response {
  const prepared: StoredDoc[] = [];
  for (const d of docs) {
    if (d.updatedAt > now + MAX_FUTURE_MS) return fail(400, `${d.kind} ${d.id}: updatedAt is in the future (check this device's clock)`);
    if (d.deleted) {
      prepared.push({ id: d.id, kind: d.kind, updatedAt: d.updatedAt, deleted: true, json: null });
      continue;
    }
    const size = JSON.stringify(d.json).length;
    if (size > LIMITS.maxDocChars) return fail(413, `${d.kind} ${d.id} is too large (${size} characters, limit ${LIMITS.maxDocChars})`);
    const clean = d.kind === 'team' ? sanitizeTeam(d.json) : sanitizeMatch(d.json);
    // The sanitiser replaces an invalid id with a fresh one; a document whose own id doesn't match its row is refused.
    if (!clean || clean.id !== d.id) return fail(400, `${d.kind} ${d.id}: not a valid ${d.kind}`);
    const folder = d.kind === 'team' ? ((clean as { groupId?: string }).groupId ?? clean.id) : null;
    prepared.push({ id: d.id, kind: d.kind, updatedAt: d.updatedAt, deleted: false, json: JSON.stringify(clean), folder });
  }
  return prepared;
}

async function parseBody(request: Request): Promise<{ body: unknown } | Response> {
  const text = await request.text();
  if (text.length > LIMITS.maxBodyChars) return fail(413, 'request too large');
  try {
    return { body: JSON.parse(text) };
  } catch {
    return fail(400, 'body is not JSON');
  }
}

const issueText = (e: { issues: { path: PropertyKey[]; message: string }[] }) => `invalid request at ${e.issues[0].path.join('.') || '(root)'}: ${e.issues[0].message}`;

async function writeAll(env: Required<Pick<Env, 'DB'>>, owner: string, prepared: StoredDoc[]): Promise<Response> {
  const results: PushResult[] = [];
  for (const d of prepared) {
    const r = await pushDoc(env.DB, owner, d);
    results.push(r.status === 'applied' ? { id: d.id, kind: d.kind, status: 'applied' } : { id: d.id, kind: d.kind, status: 'stale', doc: r.doc });
  }
  return reply(200, { results } satisfies PushResponse);
}

export async function handleApi(request: Request, env: Env, deps: ApiDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  if (!ROUTES.has(url.pathname)) return fail(404, 'not found');
  if (request.method !== 'GET' && request.method !== 'POST') return fail(405, 'method not allowed');
  if (!env.DB || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return fail(501, 'sync is not set up on this deployment');
  const db = env.DB;
  const now = (deps.now ?? Date.now)();

  // Who is asking: only a verified Access token counts, never a header the client could have written.
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return fail(401, 'not signed in');
  let me: string;
  try {
    ({ email: me } = await verifyAccessJwt(token, { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD }, deps.keys ?? jwksProvider(env.ACCESS_TEAM_DOMAIN), now));
  } catch (e) {
    return fail(401, e instanceof AuthError ? `not signed in (${e.message})` : 'not signed in');
  }

  // ---- /api/shares: who can see what ----
  if (url.pathname === '/api/shares') {
    if (request.method === 'GET') return reply(200, await mySharing(db, me));
    const parsedBody = await parseBody(request);
    if (parsedBody instanceof Response) return parsedBody;
    const op = ShareOpSchema.safeParse(parsedBody.body);
    if (!op.success) return fail(400, issueText(op.error));
    const o = op.data;
    let r: ShareResult;
    if (o.op === 'share') r = await shareFolder(db, me, o.folderId, o.grantee, o.role, now);
    else if (o.op === 'unshare') r = await unshareFolder(db, me, o.folderId, o.grantee);
    else if (o.op === 'leave') r = await unshareFolder(db, o.owner, o.folderId, me);
    else if (o.op === 'shareMatches') r = await shareMatches(db, me, o.grantee, o.enabled, now);
    else r = await setDisplayName(db, me, o.displayName);
    return r.ok ? reply(200, await mySharing(db, me)) : fail(r.status, r.error);
  }

  // ---- /api/shared: other accounts' documents ----
  if (url.pathname === '/api/shared') {
    if (request.method === 'GET') return reply(200, await sharedWith(db, me));
    const parsedBody = await parseBody(request);
    if (parsedBody instanceof Response) return parsedBody;
    const parsed = SharedPushSchema.safeParse(parsedBody.body);
    if (!parsed.success) return fail(400, issueText(parsed.error));
    const { owner, docs } = parsed.data;
    if (owner === me) return fail(400, 'those are your own documents: use /api/sync');
    if (docs.some((d) => d.kind !== 'team')) return fail(403, 'only teams can be edited through a share');
    const prepared = prepare(docs, now);
    if (prepared instanceof Response) return prepared;

    // Every document must be in a folder the caller may edit, and stay in it.
    for (const d of prepared) {
      const existing = await docMeta(db, owner, 'team', d.id);
      const folder = d.deleted ? existing?.folder : d.folder;
      if (!folder) return fail(403, `team ${d.id}: no edit access`);
      if ((await roleFor(db, owner, folder, me)) !== 'edit') return fail(403, `team ${d.id}: no edit access`);
      if (existing && existing.folder && existing.folder !== folder) return fail(403, `team ${d.id}: can't be moved out of its folder`);
      const isRoot = d.id === folder;
      if (!existing && isRoot) return fail(403, `team ${d.id}: only the owner can create the shared team itself`);
      if (d.deleted && isRoot) return fail(403, `team ${d.id}: only the owner can delete the shared team itself`);
      if (!d.deleted && existing && existing.folder === d.id && d.folder !== d.id) return fail(403, `team ${d.id}: the shared team can't become a variation`);
      d.editor = me;
    }
    return writeAll({ DB: db }, owner, prepared);
  }

  // ---- /api/sync: the caller's own documents ----
  if (request.method === 'GET') {
    const raw = url.searchParams.get('since') ?? '0';
    const since = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(since)) return fail(400, 'since must be a whole number');
    const page = await pullDocs(db, me, since, LIMITS.pageSize);
    return reply(200, page satisfies PullResponse);
  }
  const parsedBody = await parseBody(request);
  if (parsedBody instanceof Response) return parsedBody;
  const parsed = PushBodySchema.safeParse(parsedBody.body);
  if (!parsed.success) return fail(400, issueText(parsed.error));
  const prepared = prepare(parsed.data.docs, now);
  if (prepared instanceof Response) return prepared;
  return writeAll({ DB: db }, me, prepared);
}
