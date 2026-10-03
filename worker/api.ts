/**
 * GET /api/sync?since=<seq> and POST /api/sync: the whole server side of cloud sync. Every request
 * is for one account, identified only by the e-mail in a verified Cloudflare Access JWT. Payloads
 * are validated with the zod schemas in src/domain/syncProtocol.ts, and each document is run
 * through the same sanitisers the app loads its own data with before it is stored.
 */
import { sanitizeMatch, sanitizeTeam } from '../src/domain/sanitize';
import { LIMITS, PushBodySchema, type PullResponse, type PushResponse, type PushResult } from '../src/domain/syncProtocol';
import { AuthError, jwksProvider, verifyAccessJwt, type KeyProvider } from './auth';
import { pullDocs, pushDoc, type StoredDoc } from './store';
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

export async function handleApi(request: Request, env: Env, deps: ApiDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/sync') return fail(404, 'not found');
  if (request.method !== 'GET' && request.method !== 'POST') return fail(405, 'method not allowed');
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

  if (request.method === 'GET') {
    const raw = url.searchParams.get('since') ?? '0';
    const since = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(since)) return fail(400, 'since must be a whole number');
    const page = await pullDocs(env.DB, owner, since, LIMITS.pageSize);
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

  const now = (deps.now ?? Date.now)();
  const prepared: StoredDoc[] = [];
  for (const d of parsed.data.docs) {
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
    prepared.push({ id: d.id, kind: d.kind, updatedAt: d.updatedAt, deleted: false, json: JSON.stringify(clean) });
  }

  const results: PushResult[] = [];
  for (const d of prepared) {
    const r = await pushDoc(env.DB, owner, d);
    results.push(r.status === 'applied' ? { id: d.id, kind: d.kind, status: 'applied' } : { id: d.id, kind: d.kind, status: 'stale', doc: r.doc });
  }
  return reply(200, { results } satisfies PushResponse);
}
