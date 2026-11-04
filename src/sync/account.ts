/**
 * The account calls (docs/ACCOUNTS.md): create an account, log in, recover, log out, the devices list, the
 * password and the recovery code. The password never leaves the device: `deriveKey` stretches it here and only
 * the derived key is sent. Nothing secret is logged, put in a URL or stored in clear (the desktop app's session
 * token is the one exception, in its own local storage, as the plan describes).
 */
import {
  KDF_ITERATIONS,
  deriveKey,
  deviceNameFor,
  newSalt,
  normalizeServer,
  passwordProblem,
  usernameProblem,
  type AccountUser,
  type AuthResponse,
  type ClaimDone,
  type ClaimInfo,
  type KdfParams,
  type MeResponse,
  type SessionInfo,
  type SessionsResponse,
} from '@/domain/accounts';
import { useAccountStore } from './accountStore';
import { isDesktopApp, useDeviceStore } from './deviceStore';
import { useSyncStore } from './syncStore';

export type AccountErrorKind = 'offline' | 'signin' | 'access' | 'off' | 'setup' | 'throttled' | 'invalid' | 'other';

export class AccountError extends Error {
  kind: AccountErrorKind;
  status?: number;
  constructor(message: string, kind: AccountErrorKind, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** Where the desktop app's account lives: its own address, else the one it was linked to with a pairing code. */
export const desktopServer = (): string | undefined => useAccountStore.getState().server ?? useDeviceStore.getState().server;

/**
 * The web app talks to its own origin with the session cookie. The desktop app talks to its server with its
 * bearer token, under /api/device/ while Cloudflare Access is still in front of the site (that path is already
 * let through to the Worker, docs/SYNC.md); the Worker answers the account routes there too.
 */
function target(path: string): { url: string; init: RequestInit; headers: Record<string, string> } {
  if (!isDesktopApp()) return { url: path, init: { credentials: 'same-origin', redirect: 'manual' }, headers: {} };
  const server = desktopServer();
  if (!server) throw new AccountError('Enter the address of your app first.', 'invalid');
  const token = useAccountStore.getState().token;
  return { url: `${server}${path.replace(/^\/api\//, '/api/device/')}`, init: { credentials: 'omit' }, headers: token ? { authorization: `Bearer ${token}` } : {} };
}

const minutes = (res: Response): string => {
  const s = Number(res.headers.get('retry-after'));
  return Number.isFinite(s) && s > 0 ? ` (about ${Math.max(1, Math.ceil(s / 60))} min)` : '';
};

/** One account call. Every failure becomes an AccountError with a message the person can act on. */
export async function accountRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, init, headers } = target(path);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      ...init,
      // X-PTB: our page sent this (a cross-site form can't set it); the Worker refuses cookie requests without it.
      headers: { ...headers, accept: 'application/json', 'x-ptb': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AccountError("Couldn't reach the server. You may be offline.", 'offline');
  }
  // Behind Cloudflare Access, an expired Access sign-in is a redirect to its login page.
  if (res.type === 'opaqueredirect') throw new AccountError('Your Cloudflare sign-in has expired. Use “Sign in again” in Settings → Sync, then try this again.', 'access', 0);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new AccountError(res.status === 404 || res.ok ? 'Accounts aren’t switched on for this server yet.' : `Unexpected response (HTTP ${res.status}).`, res.status === 404 || res.ok ? 'off' : 'other', res.status);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; missing?: unknown };
  if (res.ok) return json;
  const error = typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
  if (res.status === 404) throw new AccountError('Accounts aren’t switched on for this server yet.', 'off', 404);
  if (res.status === 501) throw new AccountError(`Accounts aren’t set up on this server yet${Array.isArray(json.missing) && json.missing.length ? ` (missing: ${json.missing.filter((m) => typeof m === 'string').join(', ')})` : ''}.`, 'setup', 501);
  if (res.status === 429) throw new AccountError(`${error}${minutes(res)}`, 'throttled', 429);
  if (res.status === 401) {
    // A session this device thought it had has ended (revoked, expired, or the account was disabled).
    if (error === 'not signed in') {
      useAccountStore.getState().markExpired();
      throw new AccountError('You’re signed out. Log in again.', 'signin', 401);
    }
    throw new AccountError(error, 'signin', 401);
  }
  throw new AccountError(error, res.status === 400 || res.status === 403 || res.status === 409 ? 'invalid' : 'other', res.status);
}

const mode = (): 'cookie' | 'token' => (isDesktopApp() ? 'token' : 'cookie');
const thisDevice = (): string => deviceNameFor(typeof navigator === 'undefined' ? '' : navigator.userAgent, isDesktopApp());

/** The desktop app needs the server address before anything else; the web app ignores it. */
function rememberServer(server?: string): void {
  if (!isDesktopApp()) return;
  const s = normalizeServer(server ?? desktopServer() ?? '');
  if (!s) throw new AccountError('Enter the address of your app (for example https://pokemon-team-builder.yourname.workers.dev).', 'invalid');
  useAccountStore.getState().setServer(s);
}

const remember = (r: AuthResponse): AuthResponse => {
  const before = useAccountStore.getState().lastUserId;
  // Another account than the one this device synced with: its sync position means nothing there, start afresh.
  if (before && before !== r.user.id) useSyncStore.getState().forget();
  useAccountStore.getState().signIn({ user: r.user, token: r.token, expiresAt: r.expiresAt });
  // The desktop app syncs through its account: logging in is what turns it on (as linking did).
  if (isDesktopApp()) useSyncStore.getState().setEnabled(true);
  return r;
};

/** Logged out: this device keeps its teams and stops syncing (turn sync on again after logging in). */
const signedOut = () => {
  useAccountStore.getState().signOut();
  if (useSyncStore.getState().enabled) useSyncStore.getState().setEnabled(false);
};

/** Is the server running accounts, and is this device signed in? Updates the store. Offline: throws. */
export async function checkAccount(): Promise<'off' | 'signedOut' | 'signedIn'> {
  const store = useAccountStore.getState();
  try {
    const { user, claim, claimAvailable, incomingFriends } = await accountRequest<MeResponse>('GET', '/api/me');
    store.setUser(user);
    store.setClaim(claim, claimAvailable);
    store.setIncomingFriends(incomingFriends ?? 0);
    store.setAvailability('on');
    return 'signedIn';
  } catch (e) {
    if (!(e instanceof AccountError)) throw e;
    if (e.kind === 'signin') {
      store.setAvailability('on');
      return 'signedOut';
    }
    if (e.kind === 'off') {
      store.setAvailability('off');
      return 'off';
    }
    throw e;
  }
}

/** How to derive this username's key (the same answer for a name that doesn't exist). */
const paramsFor = (username: string) => accountRequest<KdfParams>('POST', '/api/auth/params', { username });

export interface SignupInput {
  invite: string;
  username: string;
  password: string;
  server?: string;
}
/** Creates the account and signs this device in. Returns the recovery code, which is shown once. */
export async function signup({ invite, username, password, server }: SignupInput): Promise<string> {
  const name = username.trim();
  const problem = usernameProblem(name) ?? passwordProblem(password, name);
  if (problem) throw new AccountError(problem, 'invalid');
  if (!invite.trim()) throw new AccountError('Enter the invite code you were sent.', 'invalid');
  rememberServer(server);
  const salt = newSalt();
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const r = remember(await accountRequest<AuthResponse>('POST', '/api/auth/signup', { invite: invite.trim(), username: name, key, salt, iterations: KDF_ITERATIONS, deviceName: thisDevice(), mode: mode() }));
  return r.recoveryCode ?? '';
}

export async function login({ username, password, server }: { username: string; password: string; server?: string }): Promise<AccountUser> {
  const name = username.trim();
  if (!name || !password) throw new AccountError('Enter your username and password.', 'invalid');
  rememberServer(server);
  const p = await paramsFor(name);
  const key = await deriveKey(password, p.salt, p.iterations);
  return remember(await accountRequest<AuthResponse>('POST', '/api/auth/login', { username: name, key, deviceName: thisDevice(), mode: mode() })).user;
}

/** A forgotten password: the recovery code (or a reset code from the admin) sets a new one. Returns the new recovery code. */
export async function recover({ username, code, password, server }: { username: string; code: string; password: string; server?: string }): Promise<string> {
  const name = username.trim();
  const problem = passwordProblem(password, name);
  if (problem) throw new AccountError(problem, 'invalid');
  if (!name || !code.trim()) throw new AccountError('Enter your username and the code.', 'invalid');
  rememberServer(server);
  const salt = newSalt();
  const key = await deriveKey(password, salt, KDF_ITERATIONS);
  const r = remember(await accountRequest<AuthResponse>('POST', '/api/auth/recover', { username: name, code: code.trim(), key, salt, iterations: KDF_ITERATIONS, deviceName: thisDevice(), mode: mode() }));
  return r.recoveryCode ?? '';
}

/** Logs this device out. Local teams stay. Offline, the device forgets the session anyway (revoke it from another device). */
export async function logout(): Promise<void> {
  try {
    await accountRequest('POST', '/api/auth/logout', {});
  } finally {
    signedOut();
  }
}

/** Ends every session of the account, this one included. Needs the server. */
export async function logoutEverywhere(): Promise<void> {
  await accountRequest('POST', '/api/auth/logout-all', {});
  signedOut();
}

const currentUser = (): AccountUser => {
  const user = useAccountStore.getState().user;
  if (!user) throw new AccountError('You’re signed out. Log in again.', 'signin');
  return user;
};

/** The key for the signed-in account's current password (the server checks it). */
async function currentKey(password: string): Promise<string> {
  if (!password) throw new AccountError('Enter your current password.', 'invalid');
  const p = await paramsFor(currentUser().username);
  return deriveKey(password, p.salt, p.iterations);
}

/** Changes the password; every other device is logged out, this one stays. */
export async function changePassword(current: string, next: string): Promise<void> {
  const problem = passwordProblem(next, currentUser().username);
  if (problem) throw new AccountError(problem, 'invalid');
  const currentDerived = await currentKey(current);
  const salt = newSalt();
  const key = await deriveKey(next, salt, KDF_ITERATIONS);
  await accountRequest('POST', '/api/me/password', { current: currentDerived, next: { key, salt, iterations: KDF_ITERATIONS } });
}

/** A new recovery code (the old one stops working). Shown once. */
export async function newRecoveryCode(password: string): Promise<string> {
  return (await accountRequest<{ recoveryCode: string }>('POST', '/api/me/recovery', { key: await currentKey(password) })).recoveryCode;
}

export async function saveDisplayName(displayName: string): Promise<AccountUser> {
  const { user } = await accountRequest<{ user: AccountUser }>('PUT', '/api/me', { displayName });
  useAccountStore.getState().setUser(user);
  return user;
}

export const loadSessions = async (): Promise<SessionInfo[]> => (await accountRequest<SessionsResponse>('GET', '/api/sessions')).sessions;

/** Signs a device out. Revoking this device's own session logs it out. */
export async function revokeSession(id: string, current: boolean): Promise<SessionInfo[]> {
  const { sessions } = await accountRequest<SessionsResponse>('DELETE', '/api/sessions', { id });
  if (current) signedOut();
  return sessions;
}

// "Bring my teams from before" (docs/ACCOUNTS.md): what the Access sign-in synced moves into the account.
export const loadClaim = () => accountRequest<ClaimInfo>('GET', '/api/claim');
export async function claimOldData(): Promise<ClaimDone> {
  const done = await accountRequest<ClaimDone>('POST', '/api/claim', {});
  useAccountStore.getState().setClaim('claimed');
  return done;
}
export async function skipClaim(): Promise<void> {
  await accountRequest('POST', '/api/claim/skip', {});
  useAccountStore.getState().setClaim('skipped');
}
