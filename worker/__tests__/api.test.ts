import { beforeAll, describe, expect, it } from 'vitest';
import { getFormat } from '../../src/domain/formats';
import { createMatch } from '../../src/domain/matches';
import { createTeam } from '../../src/domain/team';
import { LIMITS, type PullResponse, type PushDoc, type PushResponse } from '../../src/domain/syncProtocol';
import { handleApi, MAX_FUTURE_MS } from '../api';
import { NOW, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from './helpers';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});

const deps = () => ({ keys: async () => [key.jwk], now: () => NOW });
const as = async (email: string) => ({ 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(email)) });

async function call(env: ReturnType<typeof makeEnv>, method: string, path: string, who: string | null, body?: unknown) {
  const headers: Record<string, string> = who ? await as(who) : {};
  const res = await handleApi(new Request(`https://app.example${path}`, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env, deps());
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const pull = async (env: ReturnType<typeof makeEnv>, who: string, since = 0) => (await call(env, 'GET', `/api/sync?since=${since}`, who)).body as unknown as PullResponse;
const push = async (env: ReturnType<typeof makeEnv>, who: string, docs: unknown[]) => call(env, 'POST', '/api/sync', who, { docs });

const team = (name = 'T', updatedAt = NOW - 1000) => {
  const t = { ...createTeam(getFormat('champions-vgc-reg-mc'), name), updatedAt, createdAt: updatedAt };
  return t;
};
const teamDoc = (t = team(), over: Partial<PushDoc> = {}): PushDoc => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, deleted: false, json: t, ...over });

describe('who may call', () => {
  it('says so when sync is not set up (no database or no Access settings)', async () => {
    const env = makeEnv();
    expect((await call({ ...env, DB: undefined }, 'GET', '/api/sync', 'a@b.c')).status).toBe(501);
    expect((await call({ ...env, ACCESS_AUD: undefined }, 'GET', '/api/sync', 'a@b.c')).status).toBe(501);
  });

  it('needs a verified Access token: nothing, a forged one, an e-mail header alone', async () => {
    const env = makeEnv();
    expect((await call(env, 'GET', '/api/sync', null)).status).toBe(401);
    const forged = await handleApi(new Request('https://app.example/api/sync', { headers: { 'Cf-Access-Jwt-Assertion': 'a.b.c' } }), env, deps());
    expect(forged.status).toBe(401);
    const header = await handleApi(new Request('https://app.example/api/sync', { headers: { 'Cf-Access-Authenticated-User-Email': 'me@example.com' } }), env, deps());
    expect(header.status).toBe(401);
    const wrongAud = await handleApi(new Request('https://app.example/api/sync', { headers: { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims('me@example.com', { aud: ['x'] })) } }), env, deps());
    expect(wrongAud.status).toBe(401);
  });

  it('only knows /api/sync, GET and POST', async () => {
    const env = makeEnv();
    expect((await call(env, 'GET', '/api/other', 'a@b.c')).status).toBe(404);
    expect((await call(env, 'DELETE', '/api/sync', 'a@b.c')).status).toBe(405);
    expect((await call(env, 'GET', '/api/sync?since=abc', 'a@b.c')).status).toBe(400);
    expect((await call(env, 'GET', '/api/sync?since=-1', 'a@b.c')).status).toBe(400);
  });
});

describe('payload validation', () => {
  it('rejects bad bodies with a reason', async () => {
    const env = makeEnv();
    expect((await call(env, 'POST', '/api/sync', 'a@b.c', 'not json')).status).toBe(400);
    expect((await call(env, 'POST', '/api/sync', 'a@b.c', { nope: 1 })).status).toBe(400);
    const noJson = await push(env, 'a@b.c', [{ id: 'x1', kind: 'team', updatedAt: 5, deleted: false }]);
    expect(noJson.status).toBe(400);
    expect(String(noJson.body.error)).toContain('needs json');
    expect((await push(env, 'a@b.c', [{ id: '../etc', kind: 'team', updatedAt: 5, deleted: true }])).status).toBe(400);
    expect((await push(env, 'a@b.c', [{ id: 'x1', kind: 'other', updatedAt: 5, deleted: true }])).status).toBe(400);
    expect((await push(env, 'a@b.c', [{ id: 'x1', kind: 'team', updatedAt: -5, deleted: true }])).status).toBe(400);
    expect((await push(env, 'a@b.c', [{ id: 'x1', kind: 'team', updatedAt: 1.5, deleted: true }])).status).toBe(400);
  });

  it('limits documents per request, per document and per body', async () => {
    const env = makeEnv();
    const many = Array.from({ length: LIMITS.maxDocsPerRequest + 1 }, (_, i) => ({ id: `d${i}`, kind: 'team', updatedAt: 1, deleted: true }));
    expect((await push(env, 'a@b.c', many)).status).toBe(400);
    const fat = { ...team(), notes: 'x'.repeat(LIMITS.maxDocChars + 10) };
    // The sanitiser would cut the notes, but the size check is on what was sent.
    const big = await push(env, 'a@b.c', [{ id: fat.id, kind: 'team', updatedAt: fat.updatedAt, deleted: false, json: fat }]);
    expect(big.status).toBe(413);
    const huge = await call(env, 'POST', '/api/sync', 'a@b.c', JSON.stringify({ docs: [], pad: 'x'.repeat(LIMITS.maxBodyChars + 1) }));
    expect(huge.status).toBe(413);
  });

  it('only stores documents that are valid teams or matches with their own id, in sanitised form', async () => {
    const env = makeEnv();
    expect((await push(env, 'a@b.c', [{ id: 'abc', kind: 'team', updatedAt: 5, deleted: false, json: 'junk' }])).status).toBe(400);
    const t = team();
    expect((await push(env, 'a@b.c', [{ id: 'different-id', kind: 'team', updatedAt: 5, deleted: false, json: t }])).status).toBe(400);
    expect((await push(env, 'a@b.c', [{ id: 'abc', kind: 'match', updatedAt: 5, deleted: false, json: { date: 'nope' } }])).status).toBe(400);
    const dirty = { ...t, evil: '<script>', notes: 'ok', slots: t.slots };
    expect((await push(env, 'a@b.c', [teamDoc(dirty as never)])).status).toBe(200);
    const stored = (await pull(env, 'a@b.c')).docs[0].json as Record<string, unknown>;
    expect(stored.evil).toBeUndefined();
    expect(stored.notes).toBe('ok');
    const m = { ...createMatch('2026-10-01'), createdAt: NOW - 1000, updatedAt: NOW - 1000 };
    expect((await push(env, 'a@b.c', [{ id: m.id, kind: 'match', updatedAt: m.updatedAt, deleted: false, json: m }])).status).toBe(200);
  });

  it('refuses a document stamped far in the future (a wrong clock would win every conflict)', async () => {
    const env = makeEnv();
    const ahead = team('ahead', NOW + MAX_FUTURE_MS + 60_000);
    const r = await push(env, 'a@b.c', [teamDoc(ahead)]);
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toContain('in the future');
    expect((await push(env, 'a@b.c', [teamDoc(team('fine', NOW + 60_000))])).status).toBe(200);
  });
});

describe('last write wins, tombstones, sequence numbers', () => {
  it('stores a newer version, answers an older one with the server\'s, and numbers each write', async () => {
    const env = makeEnv();
    const t = team('v1', 1000);
    const a = (await push(env, 'a@b.c', [teamDoc(t)])).body as unknown as PushResponse;
    expect(a.results).toEqual([{ id: t.id, kind: 'team', status: 'applied' }]);
    const newer = { ...t, name: 'v2', updatedAt: 2000 };
    expect(((await push(env, 'a@b.c', [teamDoc(newer)])).body as unknown as PushResponse).results[0].status).toBe('applied');
    const older = { ...t, name: 'old', updatedAt: 1500 };
    const stale = ((await push(env, 'a@b.c', [teamDoc(older)])).body as unknown as PushResponse).results[0];
    expect(stale.status).toBe('stale');
    expect((stale.doc!.json as { name: string }).name).toBe('v2');
    // The same timestamp is not newer either.
    expect(((await push(env, 'a@b.c', [teamDoc({ ...t, name: 'same', updatedAt: 2000 })])).body as unknown as PushResponse).results[0].status).toBe('stale');
    const page = await pull(env, 'a@b.c');
    expect(page.docs).toHaveLength(1);
    expect((page.docs[0].json as { name: string }).name).toBe('v2');
    expect(page.cursor).toBe(page.docs[0].seq);
    expect(page.more).toBe(false);
    expect((await pull(env, 'a@b.c', page.cursor)).docs).toEqual([]);
  });

  it('syncs a delete as a tombstone, which only a newer version undoes', async () => {
    const env = makeEnv();
    const t = team('x', 1000);
    await push(env, 'a@b.c', [teamDoc(t)]);
    await push(env, 'a@b.c', [{ id: t.id, kind: 'team', updatedAt: 3000, deleted: true }]);
    const d = (await pull(env, 'a@b.c')).docs[0];
    expect(d.deleted).toBe(true);
    expect(d.json).toBeUndefined();
    const back = ((await push(env, 'a@b.c', [teamDoc({ ...t, updatedAt: 2000 })])).body as unknown as PushResponse).results[0];
    expect(back.status).toBe('stale');
    expect(back.doc!.deleted).toBe(true);
    expect(((await push(env, 'a@b.c', [teamDoc({ ...t, updatedAt: 4000 })])).body as unknown as PushResponse).results[0].status).toBe('applied');
    expect((await pull(env, 'a@b.c')).docs[0].deleted).toBe(false);
  });

  it('pages through many documents with a cursor', async () => {
    const env = makeEnv();
    const total = LIMITS.pageSize + 30;
    for (let i = 0; i < total; i += LIMITS.maxDocsPerRequest) {
      const docs = Array.from({ length: Math.min(LIMITS.maxDocsPerRequest, total - i) }, (_, j) => ({ id: `doc-${i + j}`, kind: 'team', updatedAt: 10, deleted: true }));
      expect((await push(env, 'a@b.c', docs)).status).toBe(200);
    }
    const first = await pull(env, 'a@b.c');
    expect(first.docs).toHaveLength(LIMITS.pageSize);
    expect(first.more).toBe(true);
    const second = await pull(env, 'a@b.c', first.cursor);
    expect(second.docs).toHaveLength(30);
    expect(second.more).toBe(false);
    expect(new Set([...first.docs, ...second.docs].map((d) => d.id)).size).toBe(total);
    const seqs = [...first.docs, ...second.docs].map((d) => d.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('keeps each account\'s documents apart, even with the same document id', async () => {
    const env = makeEnv();
    const t = team('mine', 1000);
    await push(env, 'alice@example.com', [teamDoc(t)]);
    expect((await pull(env, 'bob@example.com')).docs).toEqual([]);
    await push(env, 'bob@example.com', [teamDoc({ ...t, name: 'bobs' })]);
    expect(((await pull(env, 'alice@example.com')).docs[0].json as { name: string }).name).toBe('mine');
    expect(((await pull(env, 'bob@example.com')).docs[0].json as { name: string }).name).toBe('bobs');
    // The e-mail is compared lower-cased.
    expect((await pull(env, 'Alice@Example.com')).docs).toHaveLength(1);
  });

  it('keeps a team and a match with the same id apart', async () => {
    const env = makeEnv();
    const t = team('t', 1000);
    const m = { ...createMatch('2026-10-01'), id: t.id, updatedAt: 1000 };
    await push(env, 'a@b.c', [teamDoc(t), { id: m.id, kind: 'match', updatedAt: 1000, deleted: false, json: m }]);
    expect((await pull(env, 'a@b.c')).docs.map((d) => d.kind).sort()).toEqual(['match', 'team']);
  });
});
