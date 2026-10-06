import { isDesktopApp, useDeviceStore } from './deviceStore';

/** Talking to the sync Worker from the browser: one fetch wrapper that turns every failure into a message the player can act on. */
export class SyncHttpError extends Error {
  kind: 'signin' | 'setup' | 'offline' | 'other';
  constructor(message: string, kind: 'signin' | 'setup' | 'offline' | 'other') {
    super(message);
    this.kind = kind;
  }
}

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

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { url, init } = target(path);
  let res: Response;
  try {
    // redirect: 'manual' so an expired Access session (a redirect to the login page) is noticed, not followed.
    res = await fetch(url, { method, ...init, headers: { ...(init.headers as Record<string, string> | undefined), accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new SyncHttpError("Couldn't reach the server. You may be offline.", 'offline');
  }
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) {
    throw new SyncHttpError(isDesktopApp() ? 'This desktop app was unlinked from your account. Link it again in Settings → Sync.' : 'Your sign-in has expired. Reload the page to sign in again.', 'signin');
  }
  if (res.status === 501) throw new SyncHttpError(await setupMessage(res), 'setup');
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new SyncHttpError(res.status === 404 ? 'This deployment has no sync service.' : `Unexpected response (HTTP ${res.status}).`, 'setup');
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new SyncHttpError(json.error ?? `HTTP ${res.status}`, 'other');
  return json;
}
