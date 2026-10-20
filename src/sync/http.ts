import { isDesktopApp, useDeviceStore } from './deviceStore';

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
 * Signs in again from inside the installed app. A full navigation in the same window (never window.open: on iOS that
 * opens Safari, whose cookie the home-screen app can't see): Access logs in there, the cookie lands where the app can
 * use it, and the Worker sends the app back to `/`. The service worker leaves /api/* to the network (vite.config.ts).
 */
export function signInAgain(): void {
  window.location.href = RENEW_PATH;
}

export const SIGNIN_MESSAGE = 'Your sign-in has expired. Tap Sign in again.';

/**
 * The browser (web and phone app) talks to its own origin and is identified by the Access cookie.
 * The desktop app talks to the linked server under /api/device/ with its device token instead.
 */
function target(path: string): { url: string; init: RequestInit } {
  if (!isDesktopApp()) return { url: path, init: { credentials: 'same-origin', redirect: 'manual' } };
  const { server, token } = useDeviceStore.getState();
  if (!server || !token) throw new SyncHttpError('This desktop app is not linked to an account yet (Settings → Sync).', 'signin');
  return { url: `${server}${path.replace(/^\/api\//, '/api/device/')}`, init: { credentials: 'omit', headers: { authorization: `Bearer ${token}` } } };
}

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

/** A request that hasn't been answered after this long is given up as "offline", so the retry schedule takes over (a suspended iOS app can leave a fetch hanging for good). */
export const REQUEST_TIMEOUT_MS = 20_000;
export const TIMEOUT_MESSAGE = 'The server took too long to answer. Will try again.';

export interface RequestOptions {
  /** Default REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Lets the request finish while the app is being suspended (the body must stay under ~64 KB). */
  keepalive?: boolean;
  /** Abandons the request (fails as `offline`). */
  signal?: AbortSignal;
}

export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const { url, init } = target(path);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  // Raced against the fetch itself: a fetch that never settles (and ignores the abort) must not hang the caller.
  const giveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SyncHttpError(TIMEOUT_MESSAGE, 'offline'));
    }, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
    onAbort = () => {
      controller.abort();
      reject(new SyncHttpError('The request was cancelled.', 'offline'));
    };
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([send<T>(method, url, init, body, controller.signal, opts.keepalive), giveUp]);
  } finally {
    clearTimeout(timer);
    if (onAbort) opts.signal?.removeEventListener('abort', onAbort);
  }
}

async function send<T>(method: string, url: string, init: RequestInit, body: unknown, signal: AbortSignal, keepalive?: boolean): Promise<T> {
  let res: Response;
  try {
    // redirect: 'manual' so an expired Access session (a redirect to the login page) is noticed, not followed.
    res = await fetch(url, { method, ...init, signal, cache: 'no-store', ...(keepalive ? { keepalive: true } : {}), headers: { ...(init.headers as Record<string, string> | undefined), accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new SyncHttpError("Couldn't reach the server. You may be offline.", 'offline');
  }
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
    throw new SyncHttpError(isDesktopApp() ? 'This desktop app was unlinked from your account. Link it again in Settings → Sync.' : SIGNIN_MESSAGE, 'signin', res.type === 'opaqueredirect' ? 0 : res.status);
  }
  if (res.status === 501) throw new SyncHttpError(await setupMessage(res), 'setup', 501);
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new SyncHttpError(res.status === 404 ? 'This deployment has no sync service.' : `Unexpected response (HTTP ${res.status}).`, 'setup', res.status);
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new SyncHttpError(json.error ?? `HTTP ${res.status}`, 'other', res.status);
  return json;
}
