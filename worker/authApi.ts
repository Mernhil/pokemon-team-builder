/**
 * The app's own accounts (docs/ACCOUNTS_PLAN.md): signup with an invite, login, recovery, logout, the
 * signed-in user and their sessions. Only reachable when AUTH_MODE is "both" or "accounts"; otherwise
 * these paths are 404 and the Worker behaves exactly as before.
 *
 * The web app is identified by an HttpOnly cookie (so every non-GET needs the CSRF checks below), the
 * desktop app by a bearer token. Passwords, tokens and codes are never logged and never echoed except
 * where a route says so (the token and the recovery code once, in the answer that creates them).
 */
import {
  AdminIdSchema,
  AdminResetSchema,
  AdminRoleSchema,
  ChangePasswordSchema,
  InviteCreateSchema,
  KDF_ITERATIONS,
  LoginSchema,
  MeUpdateSchema,
  ParamsSchema,
  PasswordOnlySchema,
  RECOVERY_LENGTH,
  RecoverSchema,
  SESSION_COOKIE,
  SESSION_TOKEN_RE,
  SessionIdSchema,
  SignupSchema,
  THROTTLES,
  formatCode,
  generateCode,
  isCode,
  normalizeCode,
  usernameKey,
  usernameProblem,
  type AccountUser,
  type AuthResponse,
  type InvitesResponse,
  type KdfParams,
  type NewInviteResponse,
  type ResetCodeResponse,
  type SessionsResponse,
  type UsersResponse,
} from '../src/domain/accounts';
import { REFUSAL_TEXT, listInvites, listUsers, makeInvite, makeResetCode, revokeInvite, setDisabled, setRole } from './admin';
import { randomId, safeEqualText, sha256Hex, timingSafeEqual } from './crypto';
import { deviceOrigins, fail, firstIssue, readJson, reply } from './http';
import { inviteHash, inviteUsable } from './invites';
import { dummyVerify, fakeParams, paramsOf, storeKey, verifyKey } from './password';
import { createSession, listSessions, revokeAllSessions, revokeSession, sessionByToken, type ActiveSession } from './sessions';
import { allow, bump, clientAddress, count, retryAfter, type Rule } from './throttle';
import type { D1Like, Env } from './types';

export interface AuthDeps {
  now?: () => number;
}

/** Whether the accounts routes are on: "both" (accounts next to Access) or "accounts" (Access gone). Anything else: off. */
export const accountsEnabled = (env: Env): boolean => env.AUTH_MODE === 'both' || env.AUTH_MODE === 'accounts';

interface Ctx {
  db: D1Like;
  pepper: string;
  env: Env;
  request: Request;
  url: URL;
  now: number;
}
interface Authed {
  session: ActiveSession;
  viaCookie: boolean;
}
type Handler = (c: Ctx, a: Authed) => Promise<Response>;
interface Route {
  methods: string[];
  /** No session needed (signup, login, recovery). */
  public?: boolean;
  /** Admins only (checked on every call, from the session's own lookup). */
  admin?: boolean;
  handle: Handler;
}

const SMALL = 2048;
const ADMIN_BODY = 4096;
const tooMany = (rule: Rule, now: number) => fail(429, 'Too many attempts. Wait a few minutes and try again.', { 'retry-after': String(retryAfter(rule, now)) });

const cookie = (token: string, maxAgeS: number) => `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}`;
const clearCookie = () => `${SESSION_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`;

/** CSRF: the page that sent this is ours (or the desktop app's webview) and could set a custom header, which a cross-site form cannot. */
function sameSiteProblem(c: Ctx): boolean {
  const origin = c.request.headers.get('origin');
  if (!origin || (origin !== c.url.origin && !deviceOrigins(c.env).has(origin))) return true;
  return c.request.headers.get('x-ptb') !== '1';
}
const fromDesktop = (c: Ctx): boolean => deviceOrigins(c.env).has(c.request.headers.get('origin') ?? '');

/** The session behind the request: a bearer token (desktop) or the session cookie (web). */
async function authenticate(c: Ctx): Promise<Authed | null> {
  const bearer = /^Bearer (\S+)$/.exec(c.request.headers.get('authorization') ?? '')?.[1];
  let token = bearer && SESSION_TOKEN_RE.test(bearer) ? bearer : undefined;
  let viaCookie = false;
  if (!token) {
    for (const part of (c.request.headers.get('cookie') ?? '').split(';')) {
      const [name, ...rest] = part.trim().split('=');
      const value = rest.join('=');
      if (name === SESSION_COOKIE && SESSION_TOKEN_RE.test(value)) {
        token = value;
        viaCookie = true;
      }
    }
  }
  if (!token) return null;
  const session = await sessionByToken(c.db, token, c.now);
  return session ? { session, viaCookie } : null;
}

const toUser = (u: { id: string; username: string; display_name: string | null; role: 'user' | 'admin' }): AccountUser => ({ id: u.id, username: u.username, displayName: u.display_name ?? undefined, role: u.role });

interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  role: 'user' | 'admin';
  disabled: number;
  pw_hash: string;
  recovery_hash: string;
}
const USER_COLUMNS = 'id, username, display_name, role, disabled, pw_hash, recovery_hash';
const userByKey = (db: D1Like, key: string) => db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username_key = ?`).bind(key).first<UserRow>();
const userById = (db: D1Like, id: string) => db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();

/** Starts a session and builds the answer: a cookie for the web app, the token in the body for the desktop app. */
async function startSession(c: Ctx, user: AccountUser, deviceName: string, mode: 'cookie' | 'token', extra: Partial<AuthResponse> = {}): Promise<Response> {
  const s = await createSession(c.db, user.id, deviceName, mode === 'token' ? 'desktop' : 'web', c.now);
  const body: AuthResponse = { user, expiresAt: s.expiresAt, ...(mode === 'token' ? { token: s.token } : {}), ...extra };
  return reply(200, body, mode === 'cookie' ? { 'set-cookie': cookie(s.token, Math.floor((s.expiresAt - c.now) / 1000)) } : {});
}

// ---------------------------------------------------------------------------
// Signup, login, recovery
// ---------------------------------------------------------------------------

/** How to derive this username's key. A name that doesn't exist gets a stable, real-looking answer, so this reveals nothing. */
const params: Handler = async (c) => {
  if (!(await allow(c.db, c.pepper, 'paramsIp', clientAddress(c.request), THROTTLES.paramsIp, c.now))) return tooMany(THROTTLES.paramsIp, c.now);
  const r = await readJson(c.request, SMALL);
  if ('response' in r) return r.response;
  const parsed = ParamsSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  const key = usernameKey(parsed.data.username);
  const row = await userByKey(c.db, key);
  const real = row ? paramsOf(row.pw_hash) : null;
  return reply(200, (real ?? (await fakeParams(key, c.pepper, KDF_ITERATIONS))) satisfies KdfParams);
};

const signup: Handler = async (c) => {
  const { db, pepper, now } = c;
  const ip = clientAddress(c.request);
  if (!(await allow(db, pepper, 'signupIp', ip, THROTTLES.signupIp, now))) return tooMany(THROTTLES.signupIp, now);
  if ((await count(db, pepper, 'badInviteIp', ip, THROTTLES.badInviteIp, now)) >= THROTTLES.badInviteIp.max) return tooMany(THROTTLES.badInviteIp, now);

  const r = await readJson(c.request, SMALL);
  if ('response' in r) return r.response;
  const parsed = SignupSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  const d = parsed.data;
  if (d.mode === 'token' && !fromDesktop(c)) return fail(400, 'a token is only issued to the desktop app');

  // The invite comes first: nothing about usernames is revealed to someone without one.
  const typed = d.invite.trim();
  const users = (await db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>())?.n ?? 0;
  const setup = users === 0 && !!c.env.SETUP_CODE && typed.length > 0 && (await safeEqualText(typed, c.env.SETUP_CODE));
  const hash = setup ? null : await inviteHash(typed);
  if (!setup && !(hash && (await inviteUsable(db, hash, now)))) {
    await bump(db, pepper, 'badInviteIp', ip, THROTTLES.badInviteIp, now);
    return fail(400, 'That invite isn’t valid.');
  }

  const name = d.username.trim();
  const problem = usernameProblem(name);
  if (problem) return fail(400, problem);
  const key = usernameKey(name);
  if (await userByKey(db, key)) return fail(409, 'That username is taken.');

  const id = randomId('u_');
  const recovery = generateCode(RECOVERY_LENGTH);
  const pw = await storeKey(d.key, d.salt, d.iterations, pepper);
  const recoveryHash = await sha256Hex(recovery);
  // One batch is one transaction: the invite is consumed by the same statements that create the user, so two signups can't both win it.
  const insert = setup
    ? db
        .prepare("INSERT INTO users (id, username, username_key, role, pw_hash, pw_changed_at, recovery_hash, created_at) SELECT ?1, ?2, ?3, 'admin', ?4, ?5, ?6, ?5 WHERE (SELECT COUNT(*) FROM users) = 0 RETURNING id")
        .bind(id, name, key, pw, now, recoveryHash)
    : db
        .prepare(
          `INSERT INTO users (id, username, username_key, role, pw_hash, pw_changed_at, recovery_hash, invited_by, created_at)
           SELECT ?1, ?2, ?3, 'user', ?4, ?5, ?6, (SELECT created_by FROM invites WHERE code_hash = ?7), ?5
           WHERE EXISTS (SELECT 1 FROM invites WHERE code_hash = ?7 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?5) RETURNING id`,
        )
        .bind(id, name, key, pw, now, recoveryHash, hash);
  const statements = setup ? [insert] : [insert, db.prepare('UPDATE invites SET used_by = ?1, used_at = ?2 WHERE code_hash = ?3 AND used_at IS NULL').bind(id, now, hash)];
  let created: { results?: { id?: string }[] }[];
  try {
    created = await db.batch<{ id?: string }>(statements);
  } catch (e) {
    if (e instanceof Error && /UNIQUE/i.test(e.message)) return fail(409, 'That username is taken.');
    throw e;
  }
  if (!created[0]?.results?.length) {
    await bump(db, pepper, 'badInviteIp', ip, THROTTLES.badInviteIp, now);
    return fail(400, 'That invite isn’t valid.');
  }
  const user: AccountUser = { id, username: name, role: setup ? 'admin' : 'user' };
  return startSession(c, user, d.deviceName, d.mode, { recoveryCode: formatCode(recovery) });
};

const login: Handler = async (c) => {
  const { db, pepper, now } = c;
  if (!(await allow(db, pepper, 'loginIp', clientAddress(c.request), THROTTLES.loginIp, now))) return tooMany(THROTTLES.loginIp, now);
  const r = await readJson(c.request, SMALL);
  if ('response' in r) return r.response;
  const parsed = LoginSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  const d = parsed.data;
  if (d.mode === 'token' && !fromDesktop(c)) return fail(400, 'a token is only issued to the desktop app');

  const key = usernameKey(d.username);
  if ((await count(db, pepper, 'loginUser', key, THROTTLES.loginUser, now)) >= THROTTLES.loginUser.max) return tooMany(THROTTLES.loginUser, now);
  const row = await userByKey(db, key);
  let ok = false;
  if (row) ok = await verifyKey(d.key, row.pw_hash, pepper);
  else await dummyVerify(d.key, pepper);
  if (!row || !ok || row.disabled === 1) {
    // The same answer and the same work whether the name exists, the password is wrong or the account is disabled.
    await bump(db, pepper, 'loginUser', key, THROTTLES.loginUser, now);
    return fail(401, 'Wrong username or password.');
  }
  return startSession(c, toUser(row), d.deviceName, d.mode);
};

const recover: Handler = async (c) => {
  const { db, pepper, now } = c;
  const ip = clientAddress(c.request);
  if (!(await allow(db, pepper, 'recoverIp', ip, THROTTLES.recoverIp, now))) return tooMany(THROTTLES.recoverIp, now);
  const r = await readJson(c.request, SMALL);
  if ('response' in r) return r.response;
  const parsed = RecoverSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  const d = parsed.data;
  if (d.mode === 'token' && !fromDesktop(c)) return fail(400, 'a token is only issued to the desktop app');
  const key = usernameKey(d.username);
  if ((await count(db, pepper, 'recoverUser', key, THROTTLES.recoverUser, now)) >= THROTTLES.recoverUser.max) return tooMany(THROTTLES.recoverUser, now);
  const row = await userByKey(db, key);
  const code = normalizeCode(d.code);
  const codeHash = await sha256Hex(isCode(code, RECOVERY_LENGTH) ? code : '');
  let valid = false;
  if (row && row.disabled === 0 && isCode(code, RECOVERY_LENGTH)) {
    valid = timingSafeEqual(new TextEncoder().encode(codeHash), new TextEncoder().encode(row.recovery_hash));
    if (!valid) valid = !!(await db.prepare('SELECT 1 AS ok FROM reset_codes WHERE code_hash = ? AND user_id = ? AND expires_at > ?').bind(codeHash, row.id, now).first());
  }
  if (!row || !valid) {
    await bump(db, pepper, 'recoverUser', key, THROTTLES.recoverUser, now);
    return fail(400, 'That code doesn’t work.');
  }
  const fresh = generateCode(RECOVERY_LENGTH);
  await db.batch([
    db.prepare('UPDATE users SET pw_hash = ?, pw_changed_at = ?, recovery_hash = ? WHERE id = ?').bind(await storeKey(d.key, d.salt, d.iterations, pepper), now, await sha256Hex(fresh), row.id),
    db.prepare('DELETE FROM reset_codes WHERE user_id = ?').bind(row.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id),
  ]);
  return startSession(c, toUser(row), d.deviceName, d.mode, { recoveryCode: formatCode(fresh) });
};

// ---------------------------------------------------------------------------
// The signed-in user
// ---------------------------------------------------------------------------

const logout: Handler = async (c, a) => {
  await revokeSession(c.db, a.session.user.id, a.session.id);
  return reply(200, { ok: true }, { 'set-cookie': clearCookie() });
};
const logoutAll: Handler = async (c, a) => {
  await revokeAllSessions(c.db, a.session.user.id);
  return reply(200, { ok: true }, { 'set-cookie': clearCookie() });
};

const me: Handler = async (c, a) => {
  if (c.request.method === 'GET') return reply(200, { user: a.session.user });
  const r = await readJson(c.request, SMALL);
  if ('response' in r) return r.response;
  const parsed = MeUpdateSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  const name = parsed.data.displayName.replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  await c.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(name || null, a.session.user.id).run();
  return reply(200, { user: { ...a.session.user, displayName: name || undefined } });
};

/** The current password, checked with the same throttle in both password routes. Returns a refusal, or the user. */
async function confirmPassword(c: Ctx, a: Authed, key: string): Promise<Response | UserRow> {
  const scope = 'passwordUser';
  const id = a.session.user.id;
  if ((await count(c.db, c.pepper, scope, id, THROTTLES.passwordUser, c.now)) >= THROTTLES.passwordUser.max) return tooMany(THROTTLES.passwordUser, c.now);
  const row = await userById(c.db, id);
  if (!row) return fail(401, 'not signed in');
  if (!(await verifyKey(key, row.pw_hash, c.pepper))) {
    await bump(c.db, c.pepper, scope, id, THROTTLES.passwordUser, c.now);
    return fail(403, 'Wrong password.');
  }
  return row;
}

const changePassword: Handler = async (c, a) => {
  const r = await readJson(c.request, SMALL);
  if ('response' in r) return r.response;
  const parsed = ChangePasswordSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  const row = await confirmPassword(c, a, parsed.data.current);
  if (row instanceof Response) return row;
  const next = parsed.data.next;
  await c.db.prepare('UPDATE users SET pw_hash = ?, pw_changed_at = ? WHERE id = ?').bind(await storeKey(next.key, next.salt, next.iterations, c.pepper), c.now, row.id).run();
  await revokeAllSessions(c.db, row.id, a.session.id);
  return reply(200, { ok: true });
};

const newRecoveryCode: Handler = async (c, a) => {
  const r = await readJson(c.request, SMALL);
  if ('response' in r) return r.response;
  const parsed = PasswordOnlySchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  const row = await confirmPassword(c, a, parsed.data.key);
  if (row instanceof Response) return row;
  const fresh = generateCode(RECOVERY_LENGTH);
  await c.db.prepare('UPDATE users SET recovery_hash = ? WHERE id = ?').bind(await sha256Hex(fresh), row.id).run();
  return reply(200, { recoveryCode: formatCode(fresh) });
};

const sessions: Handler = async (c, a) => {
  const list = async () => reply(200, { sessions: await listSessions(c.db, a.session.user.id, a.session.id) } satisfies SessionsResponse);
  if (c.request.method === 'GET') return list();
  const r = await readJson(c.request, SMALL);
  if ('response' in r) return r.response;
  const parsed = SessionIdSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  await revokeSession(c.db, a.session.user.id, parsed.data.id);
  const res = await list();
  // Revoking the session this request used also ends the cookie.
  if (parsed.data.id === a.session.id) res.headers.append('set-cookie', clearCookie());
  return res;
};

// ---------------------------------------------------------------------------
// Admin: invites and users (worker/admin.ts holds the rules)
// ---------------------------------------------------------------------------

const invites: Handler = async (c, a) => {
  const actor = a.session.user.id;
  const list = async () => ({ invites: await listInvites(c.db, c.now) }) satisfies InvitesResponse;
  if (c.request.method === 'GET') return reply(200, await list());
  const r = await readJson(c.request, ADMIN_BODY);
  if ('response' in r) return r.response;
  if (c.request.method === 'POST') {
    const parsed = InviteCreateSchema.safeParse(r.body);
    if (!parsed.success) return fail(400, firstIssue(parsed.error));
    const made = await makeInvite(c.db, actor, parsed.data.note, parsed.data.ttlHours * 3600_000, c.now);
    return reply(200, { ...made, ...(await list()) } satisfies NewInviteResponse);
  }
  const parsed = AdminIdSchema.safeParse(r.body);
  if (!parsed.success) return fail(400, firstIssue(parsed.error));
  if (!(await revokeInvite(c.db, actor, parsed.data.id, c.now))) return fail(404, 'No open invite with that id (it may have been used already).');
  return reply(200, await list());
};

const users: Handler = async (c) => reply(200, { users: await listUsers(c.db) } satisfies UsersResponse);

/** POST /api/admin/users/disable|enable|role|reset. */
const userAction =
  (action: 'disable' | 'enable' | 'role' | 'reset'): Handler =>
  async (c, a) => {
    const actor = a.session.user.id;
    const r = await readJson(c.request, ADMIN_BODY);
    if ('response' in r) return r.response;
    const done = async (refusal: keyof typeof REFUSAL_TEXT | null) => (refusal ? fail(refusal === 'not-found' ? 404 : 409, REFUSAL_TEXT[refusal]) : reply(200, { users: await listUsers(c.db) } satisfies UsersResponse));
    if (action === 'role') {
      const parsed = AdminRoleSchema.safeParse(r.body);
      if (!parsed.success) return fail(400, firstIssue(parsed.error));
      return done(await setRole(c.db, actor, parsed.data.id, parsed.data.role, c.now));
    }
    if (action === 'reset') {
      const parsed = AdminResetSchema.safeParse(r.body);
      if (!parsed.success) return fail(400, firstIssue(parsed.error));
      // The admin's own password again: a stolen admin session alone can't take over someone's account.
      const me = await confirmPassword(c, a, parsed.data.key);
      if (me instanceof Response) return me;
      const made = await makeResetCode(c.db, actor, parsed.data.id, c.now);
      if (typeof made === 'string') return done(made);
      return reply(200, { ...made, users: await listUsers(c.db) } satisfies ResetCodeResponse);
    }
    const parsed = AdminIdSchema.safeParse(r.body);
    if (!parsed.success) return fail(400, firstIssue(parsed.error));
    return done(await setDisabled(c.db, actor, parsed.data.id, action === 'disable', c.now));
  };

const ROUTES: Record<string, Route> = {
  '/api/auth/params': { methods: ['POST'], public: true, handle: params },
  '/api/auth/signup': { methods: ['POST'], public: true, handle: signup },
  '/api/auth/login': { methods: ['POST'], public: true, handle: login },
  '/api/auth/recover': { methods: ['POST'], public: true, handle: recover },
  '/api/auth/logout': { methods: ['POST'], handle: logout },
  '/api/auth/logout-all': { methods: ['POST'], handle: logoutAll },
  '/api/me': { methods: ['GET', 'PUT'], handle: me },
  '/api/me/password': { methods: ['POST'], handle: changePassword },
  '/api/me/recovery': { methods: ['POST'], handle: newRecoveryCode },
  '/api/sessions': { methods: ['GET', 'DELETE'], handle: sessions },
  '/api/admin/invites': { methods: ['GET', 'POST', 'DELETE'], admin: true, handle: invites },
  '/api/admin/users': { methods: ['GET'], admin: true, handle: users },
  '/api/admin/users/disable': { methods: ['POST'], admin: true, handle: userAction('disable') },
  '/api/admin/users/enable': { methods: ['POST'], admin: true, handle: userAction('enable') },
  '/api/admin/users/role': { methods: ['POST'], admin: true, handle: userAction('role') },
  '/api/admin/users/reset': { methods: ['POST'], admin: true, handle: userAction('reset') },
};

/** Is this one of the account routes (the Worker sends only these here)? */
export const isAccountPath = (pathname: string): boolean => pathname in ROUTES;

/** What the deployment lacks for accounts, by setting name. */
export const accountsMissing = (env: Env): string[] => [!env.DB && 'DB', !env.PASSWORD_PEPPER && 'PASSWORD_PEPPER'].filter((m): m is string => !!m);

export async function handleAuth(request: Request, env: Env, url: URL, deps: AuthDeps = {}): Promise<Response> {
  const route = ROUTES[url.pathname];
  if (!route) return fail(404, 'not found');
  if (!route.methods.includes(request.method)) return fail(405, 'method not allowed');
  const missing = accountsMissing(env);
  if (missing.length) return reply(501, { error: 'accounts are not set up on this deployment', missing });
  const c: Ctx = { db: env.DB!, pepper: env.PASSWORD_PEPPER!, env, request, url, now: (deps.now ?? Date.now)() };

  if (route.public) {
    if (sameSiteProblem(c)) return fail(403, 'request refused');
    return route.handle(c, undefined as never);
  }
  const auth = await authenticate(c);
  if (!auth) return fail(401, 'not signed in');
  // A cookie is sent by the browser on its own, so a request that changes something must prove it came from our page.
  if (auth.viaCookie && request.method !== 'GET' && sameSiteProblem(c)) return fail(403, 'request refused');
  if (route.admin && auth.session.user.role !== 'admin') return fail(403, 'Only an admin can do that.');
  const res = await route.handle(c, auth);
  if (auth.viaCookie && auth.session.renewed && !res.headers.has('set-cookie')) {
    const token = /(?:^|;\s*)__Host-ptb_session=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
    if (token) res.headers.append('set-cookie', cookie(token, Math.floor((auth.session.expiresAt - c.now) / 1000)));
  }
  return res;
}
