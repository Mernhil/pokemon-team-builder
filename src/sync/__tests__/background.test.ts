import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFormat } from '@/domain/formats';
import { docKey, localChanges, type LocalDoc } from '@/domain/sync';
import type { PullResponse, PushDoc, PushResponse } from '@/domain/syncProtocol';
import { createTeam } from '@/domain/team';
import type { Team } from '@/domain/types';
import { KEEPALIVE_MAX_BYTES, RunAbandoned, syncOnce, type LocalStore, type SyncApi, type SyncState } from '../engine';
import { REQUEST_TIMEOUT_MS, SyncHttpError, TIMEOUT_MESSAGE, request } from '../http';
import { createRunController } from '../runControl';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const fmt = getFormat('champions-vgc-reg-mc');

describe('a request that never answers', () => {
  it('fails as a retryable offline error after the timeout, even when the fetch ignores the abort', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => new Promise(() => {})); // iOS froze it: it will never settle
    let result: unknown;
    void request('GET', '/api/sync?since=0').catch((e: unknown) => (result = e));
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeInstanceOf(SyncHttpError);
    expect(result).toMatchObject({ kind: 'offline', message: TIMEOUT_MESSAGE });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the fetch it gave up on, and passes keepalive through', async () => {
    vi.useFakeTimers();
    let seen: RequestInit | undefined;
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      seen = init;
      return new Promise(() => {});
    });
    const p = request('POST', '/api/sync', { docs: [] }, { keepalive: true, timeoutMs: 1000 }).catch((e: unknown) => e);
    expect(seen?.keepalive).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen?.signal?.aborted).toBe(true);
    expect(await p).toMatchObject({ kind: 'offline' });
  });

  it('is cancelled by the caller (an abandoned run) as an offline error, and a normal answer clears its timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const ctl = new AbortController();
    const p = request('GET', '/api/sync?since=0', undefined, { signal: ctl.signal }).catch((e: unknown) => e);
    ctl.abort();
    expect(await p).toMatchObject({ kind: 'offline' });

    vi.stubGlobal('fetch', async () => new Response('{"ok":1}', { headers: { 'content-type': 'application/json' } }));
    await expect(request('GET', '/api/x')).resolves.toEqual({ ok: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createRunController', () => {
  it('joins a young run, and replaces one older than the limit; the old one is released and no longer current', async () => {
    vi.useFakeTimers();
    const ctxs: { isCurrent: () => boolean; signal: AbortSignal }[] = [];
    const c = createRunController<string>({
      maxAgeMs: 90_000,
      abandoned: 'abandoned',
      execute: (ctx) => {
        ctxs.push(ctx);
        return new Promise(() => {}); // hangs
      },
    });
    const first = c.start();
    expect(c.start()).toBe(first);
    expect(ctxs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(89_000);
    expect(c.start()).toBe(first);
    await vi.advanceTimersByTimeAsync(2_000);
    const second = c.start();
    expect(second).not.toBe(first);
    expect(ctxs).toHaveLength(2);
    expect(ctxs[0].isCurrent()).toBe(false);
    expect(ctxs[0].signal.aborted).toBe(true);
    expect(ctxs[1].isCurrent()).toBe(true);
    expect(await first).toBe('abandoned'); // whoever awaited the dead run is not stuck
  });

  it('abandonOlderThan only drops a run that is older than that', async () => {
    vi.useFakeTimers();
    const c = createRunController<number>({ maxAgeMs: 90_000, abandoned: -1, execute: () => new Promise(() => {}) });
    c.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.abandonOlderThan(20_000)).toBe(false);
    expect(c.running()).toBe(true);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(c.abandonOlderThan(20_000)).toBe(true);
    expect(c.running()).toBe(false);
  });

  it('a finished run frees the slot', async () => {
    const c = createRunController<number>({ maxAgeMs: 1000, abandoned: -1, execute: async () => 1 });
    expect(await c.start()).toBe(1);
    expect(c.running()).toBe(false);
  });
});

/** A device with a controllable server: every call waits for the test to answer it. */
function lab() {
  const docs = new Map<string, LocalDoc>();
  const applied: string[] = [];
  const saved: SyncState[] = [];
  let clock = 1_790_000_000_000;
  const store: LocalStore = {
    list: () => [...docs.values()],
    apply: ({ upserts, deletes }) => {
      for (const d of upserts) {
        docs.set(docKey(d.kind, d.id), d);
        applied.push(d.id);
      }
      for (const d of deletes) docs.delete(docKey(d.kind, d.id));
    },
  };
  const addTeam = (name: string, bytesOfNotes = 0): Team => {
    clock += 10;
    const t: Team = { ...createTeam(fmt, name), createdAt: clock, updatedAt: clock, notes: 'x'.repeat(bytesOfNotes) };
    docs.set(docKey('team', t.id), { id: t.id, kind: 'team', updatedAt: t.updatedAt, json: t });
    return t;
  };
  return { docs, applied, saved, store, addTeam, now: () => clock };
}

describe('an abandoned run cannot write anything', () => {
  it('a pull that answers after the run was replaced applies nothing and saves no cursor', async () => {
    const l = lab();
    let answerPull!: (r: PullResponse) => void;
    const stale: SyncApi = {
      pull: () => new Promise<PullResponse>((resolve) => (answerPull = resolve)),
      push: async () => ({ results: [] }),
    };
    let current = true;
    const run = syncOnce({ store: l.store, api: stale, state: { cursor: 0, known: {} }, save: (s) => l.saved.push(s), deviceName: 'Phone', now: l.now, isCurrent: () => current });
    current = false; // replaced by a newer run while the request hangs
    const remote = createTeam(fmt, 'From the server');
    answerPull({ docs: [{ id: remote.id, kind: 'team', updatedAt: remote.updatedAt, deleted: false, json: remote, seq: 9 }], cursor: 9, more: false });
    await expect(run).rejects.toBeInstanceOf(RunAbandoned);
    expect(l.applied).toEqual([]);
    expect(l.saved).toEqual([]);
  });

  it('a push that answers late does not record its documents as sent', async () => {
    const l = lab();
    l.addTeam('Rain');
    let answerPush!: (r: PushResponse) => void;
    const api: SyncApi = {
      pull: async () => ({ docs: [], cursor: 0, more: false }),
      push: () => new Promise<PushResponse>((resolve) => (answerPush = resolve)),
    };
    let current = true;
    const state: SyncState = { cursor: 0, known: {} };
    const run = syncOnce({ store: l.store, api, state, save: (s) => l.saved.push(JSON.parse(JSON.stringify(s)) as SyncState), deviceName: 'Phone', now: l.now, isCurrent: () => current });
    await vi.waitFor(() => expect(answerPush).toBeDefined());
    const savedBefore = l.saved.length;
    current = false;
    const [doc] = [...l.docs.values()];
    answerPush({ results: [{ id: doc.id, kind: 'team', status: 'applied' }] });
    await expect(run).rejects.toBeInstanceOf(RunAbandoned);
    expect(l.saved.length).toBe(savedBefore);
    expect(l.saved.every((s) => Object.keys(s.known).length === 0)).toBe(true);
  });

  it('a hung first run, then a fresh one that completes: the dead run never overwrites the newer cursor', async () => {
    vi.useFakeTimers();
    const l = lab();
    l.addTeam('Rain');
    let cursor = 0;
    let known: SyncState['known'] = {};
    const save = (s: SyncState) => {
      cursor = s.cursor;
      known = s.known;
    };
    const hung: { release?: (r: PullResponse) => void } = {};
    let calls = 0;
    const api: SyncApi = {
      pull: (since) => {
        calls++;
        if (calls === 1) return new Promise<PullResponse>((resolve) => (hung.release = resolve)); // iOS froze it
        return Promise.resolve({ docs: [], cursor: since + 5, more: false });
      },
      push: async (docs: PushDoc[]) => ({ results: docs.map((d) => ({ id: d.id, kind: d.kind, status: 'applied' as const })) }),
    };
    const c = createRunController<string>({
      maxAgeMs: 90_000,
      abandoned: 'abandoned',
      execute: async ({ isCurrent }) => {
        try {
          await syncOnce({ store: l.store, api, state: { cursor, known }, save: (s) => isCurrent() && save(s), deviceName: 'Phone', now: l.now, isCurrent });
          return 'done';
        } catch (e) {
          if (e instanceof RunAbandoned) return 'abandoned';
          throw e;
        }
      },
    });
    const dead = c.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(c.start()).toBe(dead); // "Sync now" joins the hung run…
    expect(c.abandonOlderThan(REQUEST_TIMEOUT_MS)).toBe(true); // …until the app is back in front
    expect(await dead).toBe('abandoned');
    expect(await c.start()).toBe('done');
    expect(cursor).toBe(5);
    expect(Object.keys(known)).toHaveLength(1);

    // The frozen request finally answers with an older cursor: nothing of it is used.
    hung.release!({ docs: [], cursor: 1, more: false });
    await vi.advanceTimersByTimeAsync(10);
    expect(cursor).toBe(5);
  });
});

describe('the flush when the app goes to the background', () => {
  const pushed = () => {
    const calls: { docs: PushDoc[]; keepalive?: boolean }[] = [];
    const api: SyncApi = {
      pull: () => {
        throw new Error('a flush must not pull first');
      },
      push: async (docs, opts) => {
        calls.push({ docs, keepalive: opts?.keepalive });
        return { results: docs.map((d) => ({ id: d.id, kind: d.kind, status: 'applied' as const })) };
      },
    };
    return { api, calls };
  };

  it('pushes at once without pulling, with keepalive', async () => {
    const l = lab();
    const t = l.addTeam('Rain');
    const { api, calls } = pushed();
    const state: SyncState = { cursor: 3, known: {} };
    const r = await syncOnce({ store: l.store, api, state, save: () => {}, deviceName: 'Phone', now: l.now, flush: { maxBytes: KEEPALIVE_MAX_BYTES } });
    expect(calls).toHaveLength(1);
    expect(calls[0].keepalive).toBe(true);
    expect(calls[0].docs.map((d) => d.id)).toEqual([t.id]);
    expect(r.state.known[docKey('team', t.id)]).toEqual({ updatedAt: t.updatedAt });
  });

  it('sends the most recently edited documents that fit one keepalive body, and leaves the rest for the next run', async () => {
    const l = lab();
    const made = [l.addTeam('Oldest', 15_000), l.addTeam('Older', 15_000), l.addTeam('Newer', 15_000), l.addTeam('Newest', 15_000)];
    const { api, calls } = pushed();
    const r = await syncOnce({ store: l.store, api, state: { cursor: 0, known: {} }, save: () => {}, deviceName: 'Phone', now: l.now, flush: { maxBytes: KEEPALIVE_MAX_BYTES } });
    expect(calls).toHaveLength(1);
    const sent = calls[0].docs;
    expect(sent.map((d) => d.id)).toEqual([made[3].id, made[2].id, made[1].id]); // newest first, three of them fit
    expect(new TextEncoder().encode(JSON.stringify({ docs: sent })).length).toBeLessThanOrEqual(KEEPALIVE_MAX_BYTES);
    const left = localChanges(l.store.list(), r.state.known, l.now());
    expect(left.map((c) => c.id)).toEqual([made[0].id]); // still pending: the unsent-edits flag stays set
  });

  it('a single document too big for a keepalive body is sent as an ordinary request', async () => {
    const l = lab();
    l.addTeam('Huge', 61_000);
    const { api, calls } = pushed();
    await syncOnce({ store: l.store, api, state: { cursor: 0, known: {} }, save: () => {}, deviceName: 'Phone', now: l.now, flush: { maxBytes: KEEPALIVE_MAX_BYTES } });
    expect(calls).toHaveLength(1);
    expect(calls[0].keepalive).toBeUndefined();
  });

  it('with nothing to send it makes no request', async () => {
    const l = lab();
    const { api, calls } = pushed();
    await syncOnce({ store: l.store, api, state: { cursor: 0, known: {} }, save: () => {}, deviceName: 'Phone', now: l.now, flush: { maxBytes: KEEPALIVE_MAX_BYTES } });
    expect(calls).toEqual([]);
  });
});

describe('the run controller and a run that checks isCurrent before its first await', () => {
  it('is current from the very start (a flush has no pull to await first)', async () => {
    const c = createRunController<boolean>({ maxAgeMs: 1000, abandoned: false, execute: async ({ isCurrent }) => isCurrent() });
    expect(await c.start()).toBe(true);
  });
});

describe('the cursor is saved only after the merged state', () => {
  it('writes the pulled documents to the store before it saves the cursor, and saves no cursor when writing them fails', async () => {
    const l = lab();
    const order: string[] = [];
    const remote = createTeam(fmt, 'From the server');
    const api: SyncApi = {
      pull: async () => ({ docs: [{ id: remote.id, kind: 'team', updatedAt: remote.updatedAt, deleted: false, json: remote, seq: 4 }], cursor: 4, more: false }),
      push: async () => ({ results: [] }),
    };
    const store: LocalStore = { list: l.store.list, apply: (c) => (order.push('apply'), l.store.apply(c)) };
    await syncOnce({ store, api, state: { cursor: 0, known: {} }, save: (s) => order.push(`save ${s.cursor}`), deviceName: 'Phone', now: l.now });
    expect(order.slice(0, 2)).toEqual(['apply', 'save 4']);

    const saved: number[] = [];
    const failing: LocalStore = { list: l.store.list, apply: () => { throw new Error('storage full'); } };
    await expect(syncOnce({ store: failing, api, state: { cursor: 0, known: {} }, save: (s) => saved.push(s.cursor), deviceName: 'Phone', now: l.now })).rejects.toThrow('storage full');
    expect(saved).toEqual([]);
  });
});
