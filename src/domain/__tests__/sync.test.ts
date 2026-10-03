import { describe, expect, it } from 'vitest';
import { getFormat } from '@/domain/formats';
import { SKEW_MS, conflictCopy, conflictLabel, docKey, localChanges, resolveDocument, sameContent, type LocalDoc } from '@/domain/sync';
import type { DocKind, RemoteDocument } from '@/domain/syncProtocol';
import { createSet, createTeam } from '@/domain/team';
import type { Dex } from '@/data/dex';

const T0 = 1_000_000;
const local = (updatedAt: number, json: unknown = { v: 'local' }, kind: DocKind = 'team'): LocalDoc => ({ id: 'a', kind, updatedAt, json: { ...(json as object), updatedAt } });
const remote = (updatedAt: number, over: Partial<RemoteDocument> = {}): RemoteDocument => ({ id: 'a', kind: 'team', updatedAt, deleted: false, json: { v: 'remote', updatedAt }, seq: 1, ...over });
const base = (updatedAt: number) => ({ updatedAt });
const NOW = T0 + 100_000;

describe('first sync and plain updates', () => {
  it('a new device takes what the server has, and skips a delete it never saw', () => {
    expect(resolveDocument({ remote: remote(T0), now: NOW })).toEqual({ action: 'apply-remote' });
    expect(resolveDocument({ remote: remote(T0, { deleted: true, json: undefined }), now: NOW })).toEqual({ action: 'noop' });
  });

  it('merges with what is already there on first sync (same id on both sides): identical adopts, different conflicts', () => {
    expect(resolveDocument({ local: local(T0 + 5, { v: 'same' }), remote: remote(T0, { json: { v: 'same', updatedAt: T0 } }), now: NOW })).toEqual({ action: 'apply-remote' });
    expect(resolveDocument({ local: local(T0 + 50_000), remote: remote(T0), now: NOW })).toEqual({ action: 'conflict', winner: 'local', copy: true });
  });

  it('ignores a version it already has (its own push coming back)', () => {
    expect(resolveDocument({ local: local(T0), remote: remote(T0), base: base(T0), now: NOW })).toEqual({ action: 'noop' });
    expect(resolveDocument({ local: local(T0), remote: remote(T0 - 5), base: base(T0), now: NOW })).toEqual({ action: 'noop' });
  });

  it('takes a remote edit when nothing changed here, and keeps a local edit the server hasn\'t changed', () => {
    expect(resolveDocument({ local: local(T0), remote: remote(T0 + 10_000), base: base(T0), now: NOW })).toEqual({ action: 'apply-remote' });
    expect(resolveDocument({ local: local(T0 + 10_000), remote: remote(T0), base: base(T0), now: NOW })).toEqual({ action: 'noop' });
  });
});

describe('concurrent edits', () => {
  it('both changed: the later one wins and the other is kept as a conflict copy (teams)', () => {
    expect(resolveDocument({ local: local(T0 + 60_000), remote: remote(T0 + 20_000), base: base(T0), now: NOW })).toEqual({ action: 'conflict', winner: 'local', copy: true });
    expect(resolveDocument({ local: local(T0 + 20_000), remote: remote(T0 + 60_000), base: base(T0), now: NOW })).toEqual({ action: 'conflict', winner: 'remote', copy: true });
  });

  it('clocks within a few seconds are a tie: the server\'s version wins and nothing is lost', () => {
    for (const delta of [-SKEW_MS, -1, 0, 1, SKEW_MS]) {
      const r = resolveDocument({ local: local(T0 + 20_000 + delta), remote: remote(T0 + 20_000), base: base(T0), now: NOW });
      expect(r).toEqual({ action: 'conflict', winner: 'remote', copy: true });
    }
    expect(resolveDocument({ local: local(T0 + 20_000 + SKEW_MS + 1), remote: remote(T0 + 20_000), base: base(T0), now: NOW })).toMatchObject({ winner: 'local' });
  });

  it('matches follow the same rule without a conflict copy', () => {
    const l = local(T0 + 60_000, { v: 'l' }, 'match');
    const r = remote(T0 + 20_000, { kind: 'match' });
    expect(resolveDocument({ local: l, remote: r, base: base(T0), now: NOW })).toEqual({ action: 'conflict', winner: 'local', copy: false });
  });
});

describe('delete versus edit', () => {
  const deleted = (updatedAt: number) => remote(updatedAt, { deleted: true, json: undefined });

  it('deleted there, untouched here: delete it', () => {
    expect(resolveDocument({ local: local(T0), remote: deleted(T0 + 30_000), base: base(T0), now: NOW })).toEqual({ action: 'delete-local' });
  });

  it('deleted there, edited here: the edit survives unless the delete is clearly later', () => {
    // Edit at +20s, delete at +30s: more than the skew later, so the delete wins.
    expect(resolveDocument({ local: local(T0 + 20_000), remote: deleted(T0 + 30_000), base: base(T0), now: NOW })).toEqual({ action: 'delete-local' });
    // Delete only 3s after the edit: clocks could be off, keep the edit.
    expect(resolveDocument({ local: local(T0 + 20_000), remote: deleted(T0 + 23_000), base: base(T0), now: NOW })).toEqual({ action: 'push-local' });
    // Delete before the edit: the edit wins.
    expect(resolveDocument({ local: local(T0 + 40_000), remote: deleted(T0 + 30_000), base: base(T0), now: NOW })).toEqual({ action: 'push-local' });
  });

  it('deleted here, edited there: the edit wins unless this delete is clearly later', () => {
    // No local copy but it was synced before: deleted here at "now".
    expect(resolveDocument({ remote: remote(NOW - 2_000), base: base(T0), now: NOW })).toEqual({ action: 'apply-remote' });
    expect(resolveDocument({ remote: remote(NOW - SKEW_MS - 1_000), base: base(T0), now: NOW })).toEqual({ action: 'push-local' });
  });

  it('deleted on both sides is nothing to do', () => {
    expect(resolveDocument({ remote: deleted(T0 + 10_000), base: base(T0), now: NOW })).toEqual({ action: 'noop' });
  });
});

describe('what changed here', () => {
  const docs: LocalDoc[] = [
    { id: 'new', kind: 'team', updatedAt: 500, json: {} },
    { id: 'edited', kind: 'team', updatedAt: 900, json: {} },
    { id: 'same', kind: 'match', updatedAt: 100, json: {} },
  ];
  const known = { [docKey('team', 'edited')]: base(800), [docKey('match', 'same')]: base(100), [docKey('team', 'gone')]: base(700), [docKey('match', 'gone2')]: base(1_000_000) };

  it('lists new and edited documents, and a tombstone for each synced one that is gone', () => {
    const changes = localChanges(docs, known, 2000);
    expect(changes.map((c) => `${c.kind}:${c.id}:${c.deleted ? 'deleted' : 'live'}`).sort()).toEqual(['match:gone2:deleted', 'team:edited:live', 'team:gone:deleted', 'team:new:live']);
    expect(changes.find((c) => c.id === 'gone')!.updatedAt).toBe(2000);
    expect(changes.find((c) => c.id === 'gone')!.json).toBeUndefined();
  });

  it('a tombstone is always newer than the version it replaces, whatever the clock says', () => {
    expect(localChanges([], known, 5).find((c) => c.id === 'gone2')!.updatedAt).toBe(1_000_001);
  });

  it('nothing changed, nothing to push', () => {
    expect(localChanges([docs[2]], { [docKey('match', 'same')]: base(100) }, 5)).toEqual([]);
  });
});

describe('conflict copies', () => {
  const fmt = getFormat('champions-vgc-reg-mc');
  const mkTeam = (name: string, groupId?: string) => {
    const t = createTeam(fmt, name);
    t.slots[0] = createSet({ species: (id: string) => ({ id, abilities: { '0': 'x' } }), ability: () => undefined } as unknown as Dex, 'incineroar', fmt);
    return { ...t, groupId };
  };

  it('keeps the loser as a new variation of the winner\'s folder, labelled, with fresh ids', () => {
    const winner = mkTeam('Rain');
    const loser = mkTeam('Rain (other edit)');
    const copy = conflictCopy(loser, winner, 'this device', Date.parse('2026-10-03T10:00:00Z'));
    expect(copy.id).not.toBe(loser.id);
    expect(copy.slots[0]!.uid).not.toBe(loser.slots[0]!.uid);
    expect(copy.name).toBe(loser.name);
    expect(copy.groupId).toBe(winner.id);
    expect(copy.variationLabel).toBe('Conflict copy (this device, 2026-10-03)');
    expect(conflictLabel('Phone', Date.parse('2026-01-02T00:00:00Z'))).toBe('Conflict copy (Phone, 2026-01-02)');
    // The winner being a variation itself keeps the copy in the same folder.
    expect(conflictCopy(loser, mkTeam('V', 'folder'), 'd', 0).groupId).toBe('folder');
  });
});

describe('sameContent', () => {
  it('compares by value, ignoring key order and updatedAt', () => {
    expect(sameContent({ a: 1, b: [1, { c: 2 }], updatedAt: 1 }, { updatedAt: 99, b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameContent({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameContent({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});
