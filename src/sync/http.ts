import { PHONE_EXPIRED_MESSAGE, SIGNIN_MESSAGE, accessSessionEnded, signedOutMessage } from '@/domain/accessSession';
import { isDesktopApp, isPhoneLinked, isStandalone, useDeviceStore } from './deviceStore';
import { useAccountStore } from './accountStore';

/** Talking to the sync Worker from the browser: one fetch wrapper that turns every failure into a message the player can act on. */
export type SyncErrorKind = 'signin' | 'offline' | 'setup' | 'other';

export class SyncHttpError extends Error {
  kind: SyncErrorKind;
  /** The HTTP status, 0 for a redirect to the Access login, undefined when there was no answer. */
  status?: number;
  constructor(message: string, kind: SyncErrorKind, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** Where "Sign in again" goes: behind Access, so it shows the login inside the app's own window and returns to the app (worker/api.ts). */
export const RENEW_PATH = '/api/session/renew';

/**
 * Signs in again in a browser tab: a full navigation in the same window, Access logs in there, and the Worker sends the
 * browser back to `/` (the service worker leaves /api/* to the network, vite.config.ts). Only on a tab, on tap: the
 * installed iPhone app has its own cookie jar and the login sheet iOS opens for a foreign page can end on a white page, so
 * there it never navigates to the login; it links with a pairing code instead (`isStandalone`, docs/SYNC.md).
 */
export function signInAgain(): void {
  window.location.href = RENEW_PATH;
}

export { PHONE_EXPIRED_MESSAGE, SIGNIN_MESSAGE };

/**
 * The browser (web and phone app) talks to its own origin with its cookies: the account session when it is logged
 * in (the Worker looks at that first), else the Access cookie. A phone linked with a pairing code (and not logged in to
 * an account) sends its device token to /api/device/ instead and never needs the cookie, which the installed iPhone app
 * can't get (docs/SYNC.md). The desktop app talks to its server under /api/device/ with its account session token, or,
 * if it was linked with a pairing code and never logged in, that device token.
 */
function target(path: string): { url: string; init: RequestInit; viaAccount: boolean } {
  if (!isDesktopApp() && !useAccountStore.getState().user && isPhoneLinked()) {
    const { server, token } = useDeviceStore.getState();
    // redirect: 'manual' as everywhere: if /api/device/* isn't a Bypass path in Access, that is a login redirect to report, not to follow.
    return { url: `${server}${path.replace(/^\/api\//, '/api/device/')}`, init: { credentials: 'omit', redirect: 'manual', headers: { authorization: `Bearer ${token}` } }, viaAccount: false };
  }
  if (!isDesktopApp()) return { url: path, init: { credentials: 'same-origin', redirect: 'manual' }, viaAccount: !!useAccountStore.getState().user };
  const account = useAccountStore.getState();
  const device = useDeviceStore.getState();
  const server = account.token ? (account.server ?? device.server) : device.server;
  const token = account.token ?? device.token;
  if (!server || !token) throw new SyncHttpError('Log in to your account (Settings → Account) to sync this desktop app.', 'signin');
  return { url: `${server}${path.replace(/^\/api\//, '/api/device/')}`, init: { credentials: 'omit', headers: { authorization: `Bearer ${token}` } }, viaAccount: !!account.token };
}

/** The account hasn't brought over (or skipped) its data from before accounts: sync waits for that (worker/api.ts). */
export const CLAIM_MESSAGE = 'Bring your teams from before into your account first, or skip it: Settings → Account.';

/** What the 501 says is missing, in words (the Worker lists the settings it lacks). */
export async function setupMessage(res: Response): Promise<string> {
  const base = "Sync isn't set up on this deployment yet";
  let missing: unknown;
  try {
    missing = ((await res.json()) as { missing?: unknown }).missing;
  } catch {
    return `${base} (see docs/SYNC.md).`;
  }
  const list = Array.isArray(missing) ? missing.filter((m): m is string => typeof m === 'string') : [];
  const parts = [
    list.includes('DB') && 'the D1 database isn’t bound (docs/SYNC.md steps 1–3)',
    list.some((m) => m.startsWith('ACCESS_')) && `${list.filter((m) => m.startsWith('ACCESS_')).join(' and ')} ${list.filter((m) => m.startsWith('ACCESS_')).length > 1 ? 'aren’t' : 'isn’t'} set on the Worker (docs/SYNC.md steps 4–5)`,
  ].filter(Boolean);
  return parts.length ? `${base}: ${parts.join('; ')}.` : `${base} (see docs/SYNC.md).`;
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, init, viaAccount } = target(path);
  let res: Response;
  try {
    // redirect: 'manual' so an expired Access session (a redirect to the login page) is noticed, not followed.
    // X-PTB: 1 on every call: with the app's own accounts the Worker refuses a cookie request that changes something without it (CSRF, docs/ACCOUNTS.md).
    res = await fetch(url, { method, ...init, headers: { ...(init.headers as Record<string, string> | undefined), accept: 'application/json', 'x-ptb': '1', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new SyncHttpError("Couldn't reach the server. You may be offline.", 'offline');
  }
  if (res.status === 401 && viaAccount) {
    // The account session ended (and nothing else stood in for it): the banner's "Sign in again" opens the login dialog.
    useAccountStore.getState().markExpired();
    throw new SyncHttpError(SIGNIN_MESSAGE, 'signin', 401);
  }
  if (accessSessionEnded(res)) {
    // Status 0 = Access's redirect to its login (the banner then offers the right way back, src/components/shell/SyncStatus.tsx).
    throw new SyncHttpError(signedOutMessage({ desktop: isDesktopApp(), linked: isPhoneLinked(), standalone: isStandalone() }), 'signin', res.type === 'opaqueredirect' || res.status < 400 ? 0 : res.status);
  }
  if (res.status === 409 && (res.headers.get('content-type') ?? '').includes('json')) {
    const body = (await res.clone().json().catch(() => ({}))) as { code?: string };
    if (body.code === 'claim-pending') throw new SyncHttpError(CLAIM_MESSAGE, 'setup', 409);
  }
  if (res.status === 501) throw new SyncHttpError(await setupMessage(res), 'setup', 501);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new SyncHttpError(res.status === 404 ? 'This deployment has no sync service.' : `Unexpected response (HTTP ${res.status}).`, 'setup', res.status);
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new SyncHttpError(json.error ?? `HTTP ${res.status}`, 'other', res.status);
  return json;
}
