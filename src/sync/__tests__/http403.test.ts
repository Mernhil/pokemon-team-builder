import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGNIN_MESSAGE, SyncHttpError, request } from '../http';

afterEach(() => vi.unstubAllGlobals());

const answer = (status: number, body: string, type: string) => vi.stubGlobal('fetch', async () => new Response(body, { status, headers: { 'content-type': type } }));

describe('a 403 from the sync routes', () => {
  it('shows the Worker’s own reason, not “sign-in expired”', async () => {
    answer(403, JSON.stringify({ error: 'You can only share with friends: add them in Settings → Friends first.' }), 'application/json');
    const e = (await request('PUT', '/api/shares', { a: 1 }).catch((x) => x)) as SyncHttpError;
    expect(e).toBeInstanceOf(SyncHttpError);
    expect(e.message).toContain('only share with friends');
    expect(e.kind).toBe('other');
    expect(e.status).toBe(403);
  });
  it('still reads Access’s own HTML 403 as an ended sign-in', async () => {
    answer(403, '<html>Forbidden</html>', 'text/html');
    const e = (await request('GET', '/api/sync').catch((x) => x)) as SyncHttpError;
    expect(e.kind).toBe('signin');
    expect(e.message).toBe(SIGNIN_MESSAGE);
  });
});
