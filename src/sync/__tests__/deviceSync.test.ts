import { beforeAll, describe, expect, it } from 'vitest';
import { handleApi } from '../../../worker/api';
import { NOW as T, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from '../../../worker/__tests__/helpers';
import { getFormat } from '@/domain/formats';
import { labelTeams, makeStamp } from '@/domain/deviceStamp';
import { docKey, type LocalDoc } from '@/domain/sync';
import { createTeam } from '@/domain/team';
import type { Team } from '@/domain/types';
import { syncOnce, type LocalStore, type SyncApi, type SyncState } from '../engine';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});

const PHONE = makeStamp('pabcdefg', 'Phone');
const DESK = makeStamp('chijklmn', 'Desktop');

function device(env: ReturnType<typeof makeEnv>, name: string, stamp: string) {
  const docs = new Map<string, LocalDoc>();
  let clock = T;
  let state: SyncState = { cursor: 0, known: {} };
  const store: LocalStore = {
    list: () => [...docs.values()],
    apply: ({ upserts, deletes }) => {
      for (const d of upserts) docs.set(docKey(d.kind, d.id), d);
      for (const d of deletes) docs.delete(docKey(d.kind, d.id));
    },
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const headers = { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims('me@example.com')) };
    const res = await handleApi(new Request(`https://app.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { keys: async () => [key.jwk], now: () => clock });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const api: SyncApi = { pull: (since) => call('GET', `/api/sync?since=${since}`), push: (batch) => call('POST', '/api/sync', { docs: batch }) };
  const fmt = getFormat('champions-vgc-reg-mc');
  return {
    docs,
    tick: (ms: number) => (clock += ms),
    get state() {
      return state;
    },
    sync: async () => {
      const r = await syncOnce({ store, api, state, save: (s) => (state = s), deviceName: name, now: () => clock });
      state = r.state;
      return r.stats;
    },
    /** A team made here: stamped like the store does. */
    make: (teamName: string, labelled = true): Team => {
      const t: Team = { ...createTeam(fmt, teamName, labelled ? stamp : undefined), createdAt: clock, updatedAt: clock };
      docs.set(docKey('team', t.id), { id: t.id, kind: 'team', updatedAt: t.updatedAt, json: t });
      return t;
    },
    edit: (id: string, patch: Partial<Team>) => {
      const cur = docs.get(docKey('team', id))!;
      const at = Math.max(clock, (state.known[docKey('team', id)]?.updatedAt ?? 0) + 1);
      docs.set(docKey('team', id), { ...cur, updatedAt: at, json: { ...(cur.json as Team), ...patch, updatedAt: at, updatedOn: stamp } });
    },
    /** The backfill, as src/sync/labels.ts does it. */
    backfill: () => {
      const todo = [...docs.values()].filter((d) => d.kind === 'team' && !(d.json as Team).createdOn);
      for (const d of todo) docs.set(docKey('team', d.id), { ...d, json: labelTeams([d.json as Team], stamp)[0] });
      state = { ...state, forced: [...(state.forced ?? []), ...todo.map((d) => docKey('team', d.id))] };
      return todo.length;
    },
    team: (id: string) => docs.get(docKey('team', id))?.json as Team | undefined,
    teams: () => [...docs.values()].filter((d) => d.kind === 'team').map((d) => d.json as Team),
  };
}

describe('device labels through sync', () => {
  it('a team made on each device arrives with its label on the other, and an edit moves updatedOn', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone', PHONE);
    const desk = device(env, 'Desktop', DESK);
    const a = phone.make('From the phone');
    const b = desk.make('From the desktop');
    await phone.sync();
    await desk.sync();
    await phone.sync();
    for (const d of [phone, desk]) {
      expect(d.team(a.id)).toMatchObject({ createdOn: PHONE, updatedOn: PHONE });
      expect(d.team(b.id)).toMatchObject({ createdOn: DESK, updatedOn: DESK });
    }
    desk.tick(20_000);
    desk.edit(a.id, { notes: 'edited on the desktop' });
    await desk.sync();
    await phone.sync();
    expect(phone.team(a.id)).toMatchObject({ createdOn: PHONE, updatedOn: DESK, notes: 'edited on the desktop' });
  });

  it('a conflict copy keeps the labels of the version it holds', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone', PHONE);
    const desk = device(env, 'Desktop', DESK);
    const t = phone.make('Base');
    await phone.sync();
    await desk.sync();
    phone.tick(30_000);
    phone.edit(t.id, { name: 'phone side' });
    desk.tick(90_000);
    desk.edit(t.id, { name: 'desktop side' });
    await phone.sync();
    await desk.sync();
    await phone.sync();
    for (const d of [phone, desk]) {
      const copy = d.teams().find((x) => x.variationLabel?.startsWith('Conflict copy'))!;
      expect(copy.name).toBe('phone side'); // the losing (earlier) version
      expect(copy.createdOn).toBe(PHONE);
      expect(copy.updatedOn).toBe(PHONE);
      expect(d.team(t.id)).toMatchObject({ name: 'desktop side', createdOn: PHONE, updatedOn: DESK });
    }
  });
});

describe('labelling old teams as this device', () => {
  it('reaches the other device without touching updatedAt and without any conflict copy', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone', PHONE);
    const desk = device(env, 'Desktop', DESK);
    const old = phone.make('Old team', false);
    await phone.sync();
    await desk.sync();
    expect(desk.team(old.id)?.createdOn).toBeUndefined();

    phone.tick(60_000);
    expect(phone.backfill()).toBe(1);
    const stats = await phone.sync();
    expect(stats.pushed).toBe(1);
    expect(phone.team(old.id)!.updatedAt).toBe(old.updatedAt);
    expect(phone.state.forced).toEqual([]);

    const got = await desk.sync();
    expect(got.conflicts).toBe(0);
    expect(desk.team(old.id)).toMatchObject({ createdOn: PHONE, updatedOn: PHONE, updatedAt: old.updatedAt });
    expect(desk.teams()).toHaveLength(1);
  });

  it('does not clobber an edit made on the other device meanwhile, and creates no conflict copy', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone', PHONE);
    const desk = device(env, 'Desktop', DESK);
    const old = phone.make('Old team', false);
    await phone.sync();
    await desk.sync();
    phone.backfill();
    desk.tick(30_000);
    desk.edit(old.id, { notes: 'edited on the desktop meanwhile' }); // newer version, stamped by the desktop
    await desk.sync();
    await phone.sync(); // pulls the edit (the phone's labelled version is the older one: not a conflict, the edit wins)
    await desk.sync();
    await phone.sync();
    for (const d of [phone, desk]) {
      expect(d.teams()).toHaveLength(1);
      expect(d.team(old.id)).toMatchObject({ notes: 'edited on the desktop meanwhile', updatedOn: DESK });
    }
  });

  it('the server takes the same version only for added labels: a different edit at the same version stays stale', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone', PHONE);
    const old = phone.make('Old team', false);
    await phone.sync();
    // Same updatedAt, different content: refused as stale (last write wins is strict).
    const cur = phone.docs.get(docKey('team', old.id))!;
    phone.docs.set(docKey('team', old.id), { ...cur, json: { ...(cur.json as Team), name: 'sneaky rename', createdOn: PHONE } });
    phone.state.forced = [docKey('team', old.id)];
    await phone.sync();
    const row = env.DB.raw.prepare("SELECT json FROM documents WHERE id = ?").get(old.id) as { json: string };
    expect(JSON.parse(row.json).name).toBe('Old team');
    expect(JSON.parse(row.json).createdOn).toBeUndefined();
  });
});

describe('size', () => {
  it('the labels are tiny next to the 64 KB document limit', () => {
    expect(PHONE.length + DESK.length).toBeLessThan(100);
  });
});
