/** Talking to the sync Worker from the browser: one fetch wrapper that turns every failure into a message the player can act on. */
export class SyncHttpError extends Error {
  kind: 'signin' | 'setup' | 'offline' | 'other';
  constructor(message: string, kind: 'signin' | 'setup' | 'offline' | 'other') {
    super(message);
    this.kind = kind;
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    // redirect: 'manual' so an expired Access session (a redirect to the login page) is noticed, not followed.
    res = await fetch(path, { method, credentials: 'same-origin', redirect: 'manual', headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new SyncHttpError("Couldn't reach the server. You may be offline.", 'offline');
  }
  if (res.type === 'opaqueredirect' || res.status === 401 || res.status === 403) throw new SyncHttpError('Your sign-in has expired. Reload the page to sign in again.', 'signin');
  if (res.status === 501) throw new SyncHttpError("Sync isn't set up on this deployment yet (see docs/SYNC.md).", 'setup');
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new SyncHttpError(res.status === 404 ? 'This deployment has no sync service.' : `Unexpected response (HTTP ${res.status}).`, 'setup');
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new SyncHttpError(json.error ?? `HTTP ${res.status}`, 'other');
  return json;
}
