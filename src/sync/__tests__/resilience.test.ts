import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleApi } from '../../../worker/api';
import { NOW as T, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from '../../../worker/__tests__/helpers';
import { getFormat } from '@/domain/formats';
import { docKey, type LocalDoc } from '@/domain/sync';
import type { PullResponse, PushResponse } from '@/domain/syncProtocol';
import { createTeam } from '@/domain/team';
import type { Team } from '@/domain/types';
import { syncOnce, type LocalStore, type SyncApi, type SyncState } from '../engine';
import { SIGNIN_MESSAGE, SyncHttpError, request } from '../http';
import { createRetrier, type RunResult } from '../retry';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** What the network does to one device: signed in or not, reachable or not, and whether the push alone fails. */
interface Net {
  session: 'valid' | 'expired' | 'redirect';
  online: boolean;
  failPush: boolean;
  calls: string[];
}

/**
 * A device whose requests go through the app's real fetch wrapper (src/sync/http.ts) to a stubbed `fetch` that
 * answers like the deployment does: the real Worker handler and database when the Access session is good, a 401 or
 * Access's redirect when it has expired, and a thrown error when offline.
 */
function device(env: ReturnType<typeof makeEnv>, name: string, email = 'me@example.com') {
  const docs = new Map<string, LocalDoc>();
  const net: Net = { session: 'valid', online: true, failPush: false, calls: [] };
  let clock = T;
  let state: SyncState = { cursor: 0, known: {} };
  const store: LocalStore = {
    list: () => [...docs.values()],
    apply: ({ upserts, deletes }) => {
      for (const d of upserts) docs.set(docKey(d.kind, d.id), d);
      for (const d of deletes) docs.delete(docKey(d.kind, d.id));
    },
  };
  const fakeFetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    net.calls.push(`${method} ${url}`);
    if (!net.online) throw new TypeError('Failed to fetch');
    if (net.session === 'redirect') return { type: 'opaqueredirect', status: 0, ok: false, headers: new Headers() } as unknown as Response;
    if (net.session === 'expired') return new Response(JSON.stringify({ error: 'not signed in' }), { status: 401, headers: { 'content-type': 'application/json' } });
    if (net.failPush && method === 'POST') return new Response(JSON.stringify({ error: 'server error' }), { status: 500, headers: { 'content-type': 'application/json' } });
    const headers = { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(email)) };
    return handleApi(new Request(`https://app.example${url}`, { method, headers, body: init.body as string | undefined }), env, { keys: async () => [key.jwk], now: () => clock });
  };
  const api: SyncApi = {
    pull: (since) => request<PullResponse>('GET', `/api/sync?since=${since}`),
    push: (batch) => request<PushResponse>('POST', '/api/sync', { docs: batch }),
  };
  const fmt = getFormat('champions-vgc-reg-mc');
  /** One sync run, exactly as the runner does it: the state it reaches is saved even when the run then fails. */
  const sync = async () => {
    vi.stubGlobal('fetch', fakeFetch);
    const r = await syncOnce({ store, api, state, save: (s) => (state = s), deviceName: name, now: () => clock });
    state = r.state;
    return r.stats;
  };
  return {
    docs,
    net,
    tick: (ms: number) => (clock += ms),
    get state() {
      return state;
    },
    sync,
    /** The same, as the retrier wants it. */
    run: async (): Promise<RunResult> => {
      try {
        await sync();
        return { ok: true };
      } catch (e) {
        return { ok: false, kind: e instanceof SyncHttpError ? e.kind : 'other' };
      }
    },
    addTeam: (teamName: string) => {
      const t = { ...createTeam(fmt, teamName), createdAt: clock, updatedAt: clock };
      docs.set(docKey('team', t.id), { id: t.id, kind: 'team', updatedAt: clock, json: t });
      return t;
    },
    editTeam: (id: string, patch: Partial<Team>) => {
      const cur = docs.get(docKey('team', id))!;
      docs.set(docKey('team', id), { ...cur, updatedAt: clock, json: { ...(cur.json as Team), ...patch, updatedAt: clock } });
    },
    teams: () => [...docs.values()].filter((d) => d.kind === 'team').map((d) => d.json as Team),
  };
}

/** Lets the promise chains of a finished run run to their end. */
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};
const names = (d: { teams: () => Team[] }) => d.teams().map((t) => t.name).sort();
const serverHas = (env: ReturnType<typeof makeEnv>) => (env.DB.raw.prepare("SELECT COUNT(*) AS n FROM documents WHERE deleted = 0").get() as { n: number }).n;

describe('the fetch wrapper tells failures apart', () => {
  const kindOf = async (net: (d: ReturnType<typeof device>) => void) => {
    const d = device(makeEnv(), 'Phone');
    net(d);
    return d.sync().then(
      () => undefined,
      (e: unknown) => e as SyncHttpError,
    );
  };
  it('401 and Access redirects are a sign-in problem with the new message', async () => {
    const expired = await kindOf((d) => (d.net.session = 'expired'));
    expect(expired).toMatchObject({ kind: 'signin', status: 401, message: SIGNIN_MESSAGE });
    expect(SIGNIN_MESSAGE).toBe('Your sign-in has expired. Tap Sign in again.');
    expect(await kindOf((d) => (d.net.session = 'redirect'))).toMatchObject({ kind: 'signin', status: 0 });
  });
  it('no connection is offline, a server error is something else', async () => {
    expect(await kindOf((d) => (d.net.online = false))).toMatchObject({ kind: 'offline', status: undefined });
    const d = device(makeEnv(), 'Phone');
    d.addTeam('T');
    d.net.failPush = true;
    await expect(d.sync()).rejects.toMatchObject({ kind: 'other', status: 500 });
  });
});

describe('expiry then recovery', () => {
  it('keeps the local edit while signed out and sends it after signing in again', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const t = phone.addTeam('Rain');
    await phone.sync();
    expect(serverHas(env)).toBe(1);

    phone.net.session = 'expired';
    phone.tick(60_000);
    phone.editTeam(t.id, { name: 'Rain v2' });
    const extra = phone.addTeam('Made while signed out');
    await expect(phone.sync()).rejects.toMatchObject({ kind: 'signin' });
    // Nothing was lost, and nothing is claimed as sent.
    expect(names(phone)).toEqual(['Made while signed out', 'Rain v2']);
    expect(phone.state.known[docKey('team', extra.id)]).toBeUndefined();
    expect(serverHas(env)).toBe(1);

    phone.net.session = 'valid'; // "Sign in again" → /api/session/renew → back in the app
    const stats = await phone.sync();
    expect(stats.pushed).toBe(2);
    expect(serverHas(env)).toBe(2);
    expect(names(phone)).toEqual(['Made while signed out', 'Rain v2']);
  });
});

describe('offline then retry', () => {
  it('retries after 10 s, 30 s and 2 min, then waits for the next trigger', async () => {
    vi.useFakeTimers();
    const env = makeEnv();
    const phone = device(env, 'Phone');
    phone.addTeam('T');
    phone.net.online = false;
    const run = vi.fn(phone.run);
    const retrier = createRetrier({ run });

    await retrier.trigger();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(60 * 60_000); // gave up until something triggers it
    expect(run).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('syncs the pending change as soon as a retry finds the network back, and then stops', async () => {
    vi.useFakeTimers();
    const env = makeEnv();
    const phone = device(env, 'Phone');
    phone.addTeam('Made on the train');
    phone.net.online = false;
    const run = vi.fn(phone.run);
    const retrier = createRetrier({ run });
    await retrier.trigger();
    expect(serverHas(env)).toBe(0);

    phone.net.online = true;
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(serverHas(env)).toBe(1)); // signing the request and the database are really asynchronous
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry a sign-in or setup problem, and a new trigger starts over', async () => {
    vi.useFakeTimers();
    const phone = device(makeEnv(), 'Phone');
    phone.net.session = 'expired';
    const run = vi.fn(phone.run);
    const retrier = createRetrier({ run });
    await retrier.trigger();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(run).toHaveBeenCalledTimes(1);

    const setup = createRetrier({ run: async () => ({ ok: false, kind: 'setup' }) });
    await setup.trigger();
    expect(vi.getTimerCount()).toBe(0);

    // A trigger while a retry is pending replaces it: the schedule restarts from 10 s.
    phone.net.session = 'valid';
    phone.net.online = false;
    const runAgain = vi.fn(phone.run);
    const again = createRetrier({ run: runAgain });
    await again.trigger();
    await vi.advanceTimersByTimeAsync(10_000); // retry 1 (fails)
    await vi.waitFor(() => expect(runAgain).toHaveBeenCalledTimes(2));
    await settle();
    await again.trigger(); // e.g. the window regained focus
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    again.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a failed push loses nothing: the pull is applied and saved first, the local change goes next time', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    laptop.addTeam('From the laptop');
    await laptop.sync();

    const mine = phone.addTeam('Phone only');
    phone.net.failPush = true;
    await expect(phone.sync()).rejects.toMatchObject({ kind: 'other' });
    expect(names(phone)).toEqual(['From the laptop', 'Phone only']); // pulled and applied, local kept
    expect(phone.state.cursor).toBeGreaterThan(0); // and remembered
    expect(phone.state.known[docKey('team', mine.id)]).toBeUndefined();

    phone.net.failPush = false;
    phone.net.calls.length = 0;
    await phone.sync();
    expect(phone.net.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
    expect(serverHas(env)).toBe(2);
  });
});

describe('two devices converge after one was signed out', () => {
  it('the signed-out phone catches up and nothing is lost on either side, including a conflict', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const shared = phone.addTeam('Shared');
    const phoneOnly = phone.addTeam('Phone one');
    await phone.sync();
    await laptop.sync();

    // The phone's Access session expires; both keep working.
    phone.net.session = 'expired';
    phone.tick(60_000);
    phone.editTeam(shared.id, { name: 'Shared (phone edit)' });
    phone.editTeam(phoneOnly.id, { name: 'Phone one v2' });
    await expect(phone.sync()).rejects.toMatchObject({ kind: 'signin' });

    laptop.tick(120_000);
    laptop.editTeam(shared.id, { name: 'Shared (laptop edit)' });
    laptop.addTeam('Laptop new');
    await laptop.sync();

    // Signing in again, the phone syncs; the laptop picks up what the phone sent.
    phone.net.session = 'valid';
    phone.tick(180_000);
    await phone.sync();
    await laptop.sync();
    await phone.sync();

    expect(names(phone)).toEqual(names(laptop));
    const all = names(phone);
    expect(all).toContain('Phone one v2');
    expect(all).toContain('Laptop new');
    // Both edits of "Shared" survive: one as the team, the other as a conflict copy.
    expect(all.filter((n) => n.includes('edit')).length).toBeGreaterThanOrEqual(2);
    expect(serverHas(env)).toBe(phone.docs.size);
  });
});
