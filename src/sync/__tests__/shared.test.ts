import { beforeAll, describe, expect, it } from 'vitest';
import { handleApi } from '../../../worker/api';
import { NOW as T, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from '../../../worker/__tests__/helpers';
import { getFormat } from '@/domain/formats';
import { createMatch } from '@/domain/matches';
import { docKey, type LocalDoc } from '@/domain/sync';
import { cloneTeam, createTeam } from '@/domain/team';
import type { Team } from '@/domain/types';
import { syncOnce, type LocalStore, type SyncState } from '../engine';
import { syncSharedOnce, type SharedApi, type SharedLocal, type SharedOutcome } from '../shared';
import type { SharedFolder } from '../sharedStore';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});
type Env = ReturnType<typeof makeEnv>;

/** One person on one device: their own documents (synced as usual) and the shared teams they hold. */
function person(env: Env, email: string) {
  let clock = T;
  const call = async (method: string, path: string, body?: unknown) => {
    const headers = { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(email, { iat: Math.floor(clock / 1000) - 60, nbf: Math.floor(clock / 1000) - 60, exp: Math.floor(clock / 1000) + 3600 })) };
    const res = await handleApi(new Request(`https://app.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { keys: async () => [key.jwk], now: () => clock });
    const json = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(json as { error: string }).error}`);
    return json;
  };
  // my own documents
  const docs = new Map<string, LocalDoc>();
  let state: SyncState = { cursor: 0, known: {} };
  const store: LocalStore = {
    list: () => [...docs.values()],
    apply: ({ upserts, deletes }) => {
      for (const d of upserts) docs.set(docKey(d.kind, d.id), d);
      for (const d of deletes) docs.delete(docKey(d.kind, d.id));
    },
  };
  // shared teams
  const sharedTeams: Record<string, Team> = {};
  const local: SharedLocal = {
    teams: () => ({ ...sharedTeams }),
    apply: (ups, dels) => {
      for (const id of dels) delete sharedTeams[id];
      for (const t of ups) sharedTeams[t.id] = t;
    },
  };
  const api: SharedApi = { shared: () => call('GET', '/api/shared'), push: (owner, d) => call('POST', '/api/shared', { owner, docs: d }) };
  let folders: Record<string, SharedFolder> = {};
  const fmt = getFormat('champions-vgc-reg-mc');
  return {
    email,
    docs,
    sharedTeams,
    tick: (ms: number) => (clock += ms),
    now: () => clock,
    call,
    own: async () => {
      const r = await syncOnce({ store, api: { pull: (s) => call('GET', `/api/sync?since=${s}`), push: (b) => call('POST', '/api/sync', { docs: b }) }, state, save: (s) => (state = s), deviceName: 'Laptop', now: () => clock });
      state = r.state;
      return r.stats;
    },
    shared: async (): Promise<SharedOutcome> => {
      const out = await syncSharedOnce({ local, api, folders, save: (f) => (folders = f), deviceName: 'Laptop', now: () => clock });
      folders = out.folders;
      return out;
    },
    addTeam: (name: string, groupId?: string, from?: Team) => {
      const base = from ? cloneTeam(from, name, { groupId }) : { ...createTeam(fmt, name), groupId };
      const t = { ...base, createdAt: clock, updatedAt: clock };
      docs.set(docKey('team', t.id), { id: t.id, kind: 'team', updatedAt: clock, json: t });
      return t;
    },
    edit: (id: string, patch: Partial<Team>) => {
      const cur = docs.get(docKey('team', id))!;
      docs.set(docKey('team', id), { ...cur, updatedAt: clock, json: { ...(cur.json as Team), ...patch, updatedAt: clock } });
    },
    editShared: (id: string, patch: Partial<Team>) => {
      sharedTeams[id] = { ...sharedTeams[id], ...patch, updatedAt: clock };
    },
    myTeam: (id: string) => docs.get(docKey('team', id))?.json as Team | undefined,
  };
}

async function setup(role: 'view' | 'edit') {
  const env = makeEnv();
  const ash = person(env, 'ash@example.com');
  const misty = person(env, 'misty@example.com');
  await ash.call('POST', '/api/shares', { op: 'profile', displayName: 'Ash' });
  await misty.call('POST', '/api/shares', { op: 'profile', displayName: 'Misty' });
  const root = ash.addTeam('Rain M-C');
  ash.tick(1000);
  const sun = ash.addTeam('Rain M-C', root.id, root);
  ash.edit(sun.id, { variationLabel: 'vs Sun' });
  await ash.own();
  await ash.call('POST', '/api/shares', { op: 'share', folderId: root.id, grantee: 'misty@example.com', role });
  return { env, ash, misty, root, sun };
}

describe('a folder I can only view', () => {
  it('arrives marked with its owner, read-only, and nothing is notified the first time', async () => {
    const { ash, misty, root, sun } = await setup('view');
    const out = await misty.shared();
    expect(out.added.map((f) => f.folderId)).toEqual([root.id]);
    expect(out.notices).toEqual([]);
    expect(Object.keys(misty.sharedTeams).sort()).toEqual([root.id, sun.id].sort());
    expect(misty.sharedTeams[root.id].shared).toEqual({ owner: 'ash@example.com', ownerName: 'Ash', folderId: root.id, role: 'view' });
    expect(misty.sharedTeams[sun.id].groupId).toBe(root.id);
    expect(ash.sharedTeams).toEqual({}); // the owner's own copy is just their team
  });

  it("follows the owner's changes and says who changed what, skipping what is new to me", async () => {
    const { ash, misty, root, sun } = await setup('view');
    await misty.shared();
    ash.tick(3_600_000);
    ash.edit(sun.id, { name: 'Rain M-C v2' });
    const extra = ash.addTeam('Rain M-C', root.id, root);
    await ash.own();
    misty.tick(7_200_000);
    const out = await misty.shared();
    expect(misty.sharedTeams[sun.id].name).toBe('Rain M-C v2');
    expect(misty.sharedTeams[extra.id]).toBeDefined();
    expect(out.notices).toEqual([{ teamId: sun.id, teamName: 'Rain M-C v2', who: 'Ash', updatedAt: ash.now() }]);
    // Nothing changed since: nothing to say.
    expect((await misty.shared()).notices).toEqual([]);
  });

  it('removes teams the owner deleted, and everything once the share is revoked', async () => {
    const { ash, misty, root, sun } = await setup('view');
    await misty.shared();
    ash.tick(1000);
    ash.docs.delete(docKey('team', sun.id));
    await ash.own();
    await misty.shared();
    expect(Object.keys(misty.sharedTeams)).toEqual([root.id]);

    await ash.call('POST', '/api/shares', { op: 'unshare', folderId: root.id, grantee: 'misty@example.com' });
    const out = await misty.shared();
    expect(misty.sharedTeams).toEqual({});
    expect(out.removed).toEqual(['Rain M-C']);
  });

  it('keeps my own teams out of it: shared teams are never sent as my documents', async () => {
    const { misty } = await setup('view');
    await misty.shared();
    misty.addTeam('Mine');
    const stats = await misty.own();
    expect(stats.pushed).toBe(1);
    const pulled = (await misty.call('GET', '/api/sync?since=0')) as { docs: { json: Team }[] };
    expect(pulled.docs.map((d) => d.json.name)).toEqual(['Mine']);
  });
});

describe('a folder I can edit', () => {
  it('sends my edit to the owner, who sees who made it', async () => {
    const { ash, misty, root, sun } = await setup('edit');
    await misty.shared();
    expect(misty.sharedTeams[root.id].shared?.role).toBe('edit');
    misty.tick(60_000);
    misty.editShared(sun.id, { name: 'Rain M-C (Misty)' });
    const out = await misty.shared();
    expect(out.pushed).toBe(1);

    ash.tick(120_000);
    const stats = await ash.own();
    expect(ash.myTeam(sun.id)!.name).toBe('Rain M-C (Misty)');
    expect(stats.received.find((d) => d.id === sun.id)?.by).toBe('Misty');
    // And my own edit coming back from the server is not news to me.
    expect((await misty.shared()).notices).toEqual([]);
  });

  it("an editor's new variation lands in the folder and reaches the owner", async () => {
    const { ash, misty, root } = await setup('edit');
    await misty.shared();
    misty.tick(60_000);
    const copy = { ...cloneTeam(misty.sharedTeams[root.id], 'Rain M-C', { groupId: root.id, variationLabel: 'Misty idea', shared: misty.sharedTeams[root.id].shared }), updatedAt: misty.now() };
    misty.sharedTeams[copy.id] = copy;
    await misty.shared();
    ash.tick(1000);
    await ash.own();
    expect(ash.myTeam(copy.id)).toMatchObject({ groupId: root.id, variationLabel: 'Misty idea' });
  });

  it('if we both change the same team, the older change is kept as a conflict copy inside the folder', async () => {
    const { ash, misty, sun } = await setup('edit');
    await misty.shared();
    ash.tick(10_000);
    ash.edit(sun.id, { notes: 'Ash was here' });
    await ash.own();
    misty.tick(20_000);
    misty.editShared(sun.id, { notes: 'Misty was here' });
    const out = await misty.shared();
    expect(out.conflicts).toBe(1);
    const copies = Object.values(misty.sharedTeams).filter((t) => t.variationLabel?.startsWith('Conflict copy'));
    expect(copies).toHaveLength(1);
    expect(copies[0].shared?.role).toBe('edit');
    expect(copies[0].groupId).toBe(sun.groupId);
    // Both versions exist for the owner too; nothing was lost.
    ash.tick(1000);
    await ash.own();
    const notes = [...ash.docs.values()].map((d) => (d.json as Team).notes);
    expect(notes).toContain('Ash was here');
    expect(notes).toContain('Misty was here');
  });

  it('becoming an editor later starts from what I already have (no copies, no duplicate pushes)', async () => {
    const { ash, misty, root, sun } = await setup('view');
    await misty.shared();
    await ash.call('POST', '/api/shares', { op: 'share', folderId: root.id, grantee: 'misty@example.com', role: 'edit' });
    const out = await misty.shared();
    expect(out.conflicts).toBe(0);
    expect(out.pushed).toBe(0);
    expect(misty.sharedTeams[sun.id].shared?.role).toBe('edit');
    expect(Object.keys(misty.sharedTeams)).toHaveLength(2);
  });

  it('losing edit access mid-way is not lost work: the viewer mirror takes over without errors', async () => {
    const { ash, misty, root } = await setup('edit');
    await misty.shared();
    await ash.call('POST', '/api/shares', { op: 'share', folderId: root.id, grantee: 'misty@example.com', role: 'view' });
    await expect(misty.shared()).resolves.toBeDefined();
    expect(misty.sharedTeams[root.id].shared?.role).toBe('view');
  });
});

describe("a friend's match log", () => {
  it('is only there while they share it', async () => {
    const env = makeEnv();
    const ash = person(env, 'ash@example.com');
    const misty = person(env, 'misty@example.com');
    const m = { ...createMatch('2026-10-01'), updatedAt: T - 1000 };
    ash.docs.set(docKey('match', m.id), { id: m.id, kind: 'match', updatedAt: m.updatedAt, json: m });
    await ash.own();
    expect((await misty.shared()).friends).toEqual([]);
    await ash.call('POST', '/api/shares', { op: 'shareMatches', grantee: 'misty@example.com', enabled: true });
    const out = await misty.shared();
    expect(out.friends).toHaveLength(1);
    expect(out.friends[0].owner).toBe('ash@example.com');
    expect(out.friends[0].matches.map((x) => x.id)).toEqual([m.id]);
    await ash.call('POST', '/api/shares', { op: 'shareMatches', grantee: 'misty@example.com', enabled: false });
    expect((await misty.shared()).friends).toEqual([]);
  });
});
