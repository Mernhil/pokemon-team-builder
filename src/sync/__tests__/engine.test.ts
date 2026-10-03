import { beforeAll, describe, expect, it } from 'vitest';
import { handleApi } from '../../../worker/api';
import { NOW as T, goodClaims, makeEnv, makeKey, signJwt, type TestKey } from '../../../worker/__tests__/helpers';
import { getFormat } from '@/domain/formats';
import { createMatch, type Match } from '@/domain/matches';
import { docKey, type LocalDoc } from '@/domain/sync';
import type { DocKind } from '@/domain/syncProtocol';
import { createTeam } from '@/domain/team';
import type { Team } from '@/domain/types';
import { syncOnce, type LocalStore, type SyncApi, type SyncState } from '../engine';

let key: TestKey;
beforeAll(async () => {
  key = await makeKey();
});

/** A device: its own documents, its own sync state and clock, talking to the real Worker handler and a real SQLite database. */
function device(env: ReturnType<typeof makeEnv>, name: string, email = 'me@example.com') {
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
    const headers = { 'Cf-Access-Jwt-Assertion': await signJwt(key, goodClaims(email)) };
    const res = await handleApi(new Request(`https://app.example${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { keys: async () => [key.jwk], now: () => clock });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const api: SyncApi = { pull: (since) => call('GET', `/api/sync?since=${since}`), push: (batch) => call('POST', '/api/sync', { docs: batch }) };
  const fmt = getFormat('champions-vgc-reg-mc');
  return {
    name,
    docs,
    tick: (ms: number) => (clock += ms),
    now: () => clock,
    get state() {
      return state;
    },
    sync: async () => {
      const r = await syncOnce({ store, api, state, save: (s) => (state = s), deviceName: name, now: () => clock });
      state = r.state;
      return r.stats;
    },
    addTeam: (teamName: string, groupId?: string) => {
      const t = { ...createTeam(fmt, teamName), groupId, createdAt: clock, updatedAt: clock };
      docs.set(docKey('team', t.id), { id: t.id, kind: 'team', updatedAt: t.updatedAt, json: t });
      return t;
    },
    editTeam: (id: string, patch: Partial<Team>) => {
      const cur = docs.get(docKey('team', id))!;
      const next = { ...(cur.json as Team), ...patch, updatedAt: clock };
      docs.set(docKey('team', id), { ...cur, updatedAt: clock, json: next });
    },
    addMatch: (notes = '') => {
      const m = { ...createMatch('2026-10-01'), notes, createdAt: clock, updatedAt: clock };
      docs.set(docKey('match', m.id), { id: m.id, kind: 'match', updatedAt: clock, json: m });
      return m;
    },
    editMatch: (id: string, patch: Partial<Match>) => {
      const cur = docs.get(docKey('match', id))!;
      docs.set(docKey('match', id), { ...cur, updatedAt: clock, json: { ...(cur.json as Match), ...patch, updatedAt: clock } });
    },
    remove: (kind: DocKind, id: string) => docs.delete(docKey(kind, id)),
    teams: () => [...docs.values()].filter((d) => d.kind === 'team').map((d) => d.json as Team),
    team: (id: string) => docs.get(docKey('team', id))?.json as Team | undefined,
    match: (id: string) => docs.get(docKey('match', id))?.json as Match | undefined,
  };
}

describe('two devices through the real Worker', () => {
  it('first sync on a new device merges with what is there (no wipe) and both end up with everything', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const a = phone.addTeam('Phone team');
    const b = laptop.addTeam('Laptop team');
    await phone.sync();
    const first = await laptop.sync(); // a brand-new device with its own team
    expect(first.updated).toBe(1);
    expect(first.pushed).toBe(1);
    expect(laptop.team(a.id)!.name).toBe('Phone team');
    expect(laptop.team(b.id)!.name).toBe('Laptop team');
    await phone.sync();
    expect(phone.teams().map((t) => t.name).sort()).toEqual(['Laptop team', 'Phone team']);
  });

  it('a second sync with nothing new does nothing', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    phone.addTeam('T');
    phone.addMatch('m');
    await phone.sync();
    const again = await phone.sync();
    expect(again).toMatchObject({ updated: 0, pushed: 0, deleted: 0, conflicts: 0 });
  });

  it('edits travel both ways, last write wins', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const t = phone.addTeam('v1');
    await phone.sync();
    await laptop.sync();
    laptop.tick(60_000);
    laptop.editTeam(t.id, { name: 'v2' });
    await laptop.sync();
    await phone.sync();
    expect(phone.team(t.id)!.name).toBe('v2');
    phone.tick(120_000);
    phone.editTeam(t.id, { name: 'v3' });
    await phone.sync();
    await laptop.sync();
    expect(laptop.team(t.id)!.name).toBe('v3');
  });

  it('a delete on one device removes it on the other', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const t = phone.addTeam('doomed');
    const m = phone.addMatch('also doomed');
    await phone.sync();
    await laptop.sync();
    expect(laptop.team(t.id)).toBeDefined();
    laptop.tick(60_000);
    laptop.remove('team', t.id);
    laptop.remove('match', m.id);
    const s = await laptop.sync();
    expect(s.pushed).toBe(2);
    const p = await phone.sync();
    expect(p.deleted).toBe(2);
    expect(phone.team(t.id)).toBeUndefined();
    expect(phone.match(m.id)).toBeUndefined();
    // And it stays gone on a device that syncs for the first time afterwards.
    const tablet = device(env, 'Tablet');
    await tablet.sync();
    expect(tablet.teams()).toEqual([]);
  });

  it('concurrent edits to a team keep the loser as a "Conflict copy" variation, and the devices converge', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const t = phone.addTeam('base');
    await phone.sync();
    await laptop.sync();

    phone.tick(30_000);
    phone.editTeam(t.id, { name: 'phone edit' });
    laptop.tick(90_000);
    laptop.editTeam(t.id, { name: 'laptop edit' }); // later: wins
    await laptop.sync();
    const s = await phone.sync(); // phone's edit lost
    expect(s.conflicts).toBe(1);
    expect(phone.team(t.id)!.name).toBe('laptop edit');
    const copy = phone.teams().find((x) => x.id !== t.id)!;
    expect(copy.name).toBe('phone edit');
    expect(copy.groupId).toBe(t.id);
    expect(copy.variationLabel).toMatch(/^Conflict copy \(Phone, \d{4}-\d{2}-\d{2}\)$/);

    // Everyone ends up with the same two teams, and nothing was lost.
    await phone.sync();
    await laptop.sync();
    for (const d of [phone, laptop]) expect(d.teams().map((x) => x.name).sort()).toEqual(['laptop edit', 'phone edit']);
    expect(laptop.team(copy.id)!.variationLabel).toBe(copy.variationLabel);
  });

  it('when the local edit is the later one it wins and the server\'s version becomes the copy', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const t = phone.addTeam('base');
    await phone.sync();
    await laptop.sync();
    phone.tick(30_000);
    phone.editTeam(t.id, { name: 'earlier' });
    await phone.sync();
    laptop.tick(200_000);
    laptop.editTeam(t.id, { name: 'later' });
    const s = await laptop.sync();
    expect(s.conflicts).toBe(1);
    expect(laptop.team(t.id)!.name).toBe('later');
    expect(laptop.teams().find((x) => x.id !== t.id)!.name).toBe('earlier');
    await phone.sync();
    expect(phone.team(t.id)!.name).toBe('later');
  });

  it('a clock-skewed pair (edits seconds apart) still loses nothing', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const t = phone.addTeam('base');
    await phone.sync();
    await laptop.sync();
    phone.tick(40_000);
    phone.editTeam(t.id, { name: 'phone' });
    laptop.tick(42_000); // two seconds later by its clock
    laptop.editTeam(t.id, { name: 'laptop' });
    await phone.sync();
    await laptop.sync();
    await phone.sync();
    for (const d of [phone, laptop]) expect(d.teams().map((x) => x.name).sort()).toEqual(['laptop', 'phone']);
  });

  it('delete versus edit: the edit wins when the delete is not clearly later', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const t = phone.addTeam('x');
    await phone.sync();
    await laptop.sync();
    phone.tick(30_000);
    phone.editTeam(t.id, { name: 'edited' });
    laptop.tick(31_000); // deleted a second after the edit, by another clock
    laptop.remove('team', t.id);
    await phone.sync();
    await laptop.sync();
    await phone.sync();
    expect(laptop.team(t.id)!.name).toBe('edited');
    expect(phone.team(t.id)!.name).toBe('edited');
  });

  it('delete versus edit: a clearly later delete wins', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const t = phone.addTeam('x');
    await phone.sync();
    await laptop.sync();
    phone.tick(30_000);
    phone.editTeam(t.id, { name: 'edited' });
    laptop.tick(300_000);
    laptop.remove('team', t.id);
    await phone.sync();
    await laptop.sync();
    await phone.sync();
    expect(phone.team(t.id)).toBeUndefined();
    expect(laptop.team(t.id)).toBeUndefined();
  });

  it('matches: last write wins, with no conflict copies', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const m = phone.addMatch('one');
    await phone.sync();
    await laptop.sync();
    phone.tick(30_000);
    phone.editMatch(m.id, { notes: 'phone note' });
    laptop.tick(90_000);
    laptop.editMatch(m.id, { notes: 'laptop note' });
    await laptop.sync();
    const s = await phone.sync();
    expect(s.conflicts).toBe(0);
    expect(phone.match(m.id)!.notes).toBe('laptop note');
    expect([...phone.docs.values()].filter((d) => d.kind === 'match')).toHaveLength(1);
  });

  it('a push that lost a race with another device is merged on the next pass, not dropped', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    const t = phone.addTeam('base');
    await phone.sync();
    await laptop.sync();
    laptop.tick(60_000);
    laptop.editTeam(t.id, { name: 'laptop first' });
    await laptop.sync();
    phone.tick(10_000); // the phone's edit is older than the server's by now
    phone.editTeam(t.id, { name: 'phone older' });
    await phone.sync();
    for (const d of [phone, laptop]) {
      await d.sync();
      expect(d.teams().map((x) => x.name).sort()).toEqual(['laptop first', 'phone older']);
    }
  });

  it('keeps accounts apart', async () => {
    const env = makeEnv();
    const mine = device(env, 'Phone', 'me@example.com');
    const theirs = device(env, 'Phone', 'friend@example.com');
    mine.addTeam('private');
    await mine.sync();
    const s = await theirs.sync();
    expect(s.pulled).toBe(0);
    expect(theirs.teams()).toEqual([]);
  });

  it('syncs more than a page of documents and more than one push request', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    const laptop = device(env, 'Laptop');
    for (let i = 0; i < 230; i++) phone.addMatch(`m${i}`);
    expect((await phone.sync()).pushed).toBe(230);
    expect((await laptop.sync()).updated).toBe(230);
    expect([...laptop.docs.values()].filter((d) => d.kind === 'match')).toHaveLength(230);
  });

  it('survives a failed push: the next run finishes the job', async () => {
    const env = makeEnv();
    const phone = device(env, 'Phone');
    phone.addTeam('a');
    // Break the server's database for one run.
    const real = env.DB.batch;
    env.DB.batch = async () => {
      throw new Error('D1 is down');
    };
    await expect(phone.sync()).rejects.toThrow();
    env.DB.batch = real;
    expect((await phone.sync()).pushed).toBe(1);
  });
});
