import { beforeEach, describe, expect, it } from 'vitest';
import { getFormat, DEFAULT_FORMAT_ID } from '@/domain/formats';
import { makeStamp } from '@/domain/deviceStamp';
import { createTeam } from '@/domain/team';
import { labelUnlabelledAsThisDevice } from '@/sync/labels';
import { useSyncStore } from '@/sync/syncStore';
import { useTeamStore } from '../teamStore';

const fmt = getFormat(DEFAULT_FORMAT_ID);
const PHONE = 'pabcdefg';
const DESK = 'chijklmn';
const as = (id: string, name: string) => useSyncStore.setState({ deviceId: id, deviceName: name, known: {}, forced: [] });
const s = () => useTeamStore.getState();
const stamp = (id: string, name: string) => makeStamp(id, name);

beforeEach(() => {
  as(PHONE, 'Phone');
  const t = createTeam(fmt, 'Base');
  useTeamStore.setState({ teams: { [t.id]: t }, order: [t.id], activeTeamId: t.id, activeSlot: 0, editingFrom: null, editingDraft: null, battle: {} });
});

describe('device labels on teams', () => {
  it('a new team, a duplicate, a variation, an import and a copy of a shared team are made on this device', () => {
    const id = s().newTeam();
    expect(s().teams[id].createdOn).toBe(stamp(PHONE, 'Phone'));
    expect(s().teams[id].updatedOn).toBe(stamp(PHONE, 'Phone'));

    as(DESK, 'Desktop');
    const dup = s().duplicateTeam(id);
    expect(s().teams[dup].createdOn).toBe(stamp(DESK, 'Desktop'));
    const variation = s().addVariation(id);
    expect(s().teams[variation].createdOn).toBe(stamp(DESK, 'Desktop'));
    expect(s().teams[variation].groupId).toBe(id);

    as(PHONE, 'Phone');
    const incoming = { ...createTeam(fmt, 'From a backup'), createdOn: stamp('pzzzzzzz', 'Someone else'), updatedOn: stamp('pzzzzzzz', 'Someone else') };
    s().addTeams([incoming], false);
    expect(s().teams[incoming.id].createdOn).toBe(stamp(PHONE, 'Phone'));

    const shared = { ...createTeam(fmt, 'Theirs'), createdOn: stamp('pzzzzzzz', 'Their phone'), shared: { owner: 'x@example.com', role: 'view' as const } };
    useTeamStore.setState((st) => ({ teams: { ...st.teams, [shared.id]: shared }, order: [...st.order, shared.id] }));
    const copy = s().copySharedToMine(shared.id);
    expect(s().teams[copy].createdOn).toBe(stamp(PHONE, 'Phone'));
    expect(s().teams[copy].shared).toBeUndefined();
  });

  it('an edit sets updatedOn to the editing device and keeps createdOn', () => {
    const id = s().newTeam();
    const created = s().teams[id].createdOn;
    as(DESK, 'Desktop');
    s().updateTeam(id, { notes: 'edited on the desktop' });
    expect(s().teams[id].updatedOn).toBe(stamp(DESK, 'Desktop'));
    expect(s().teams[id].createdOn).toBe(created);
    s().setSlot(id, 0, null);
    expect(s().teams[id].updatedOn).toBe(stamp(DESK, 'Desktop'));
  });

  it('the draft keeps createdOn of the saved team; the saved team\'s updatedOn changes only on Save', () => {
    const saved = s().saveAsNew('Rain'); // made on the phone
    expect(s().teams[saved].createdOn).toBe(stamp(PHONE, 'Phone'));
    as(DESK, 'Desktop');
    const draft = s().editTeam(saved);
    expect(s().teams[draft].createdOn).toBe(stamp(PHONE, 'Phone'));
    s().updateTeam(draft, { notes: 'working on it on the desktop' });
    expect(s().teams[draft].updatedOn).toBe(stamp(DESK, 'Desktop'));
    expect(s().teams[saved].updatedOn).toBe(stamp(PHONE, 'Phone')); // not saved yet
    s().saveTeam('Rain', 'overwrite', saved);
    expect(s().teams[saved].updatedOn).toBe(stamp(DESK, 'Desktop'));
    expect(s().teams[saved].createdOn).toBe(stamp(PHONE, 'Phone'));
  });

  it('a device rename shows on this device\'s teams (the stamp keeps the id) and later edits carry the new name', () => {
    const id = s().newTeam();
    useSyncStore.getState().setDeviceName('Lorenzo’s iPhone');
    s().updateTeam(id, { notes: 'x' });
    expect(s().teams[id].updatedOn).toBe(stamp(PHONE, 'Lorenzo’s iPhone'));
    expect(s().teams[id].createdOn?.slice(0, 8)).toBe(PHONE);
  });

  it('syncing teams in does not stamp them (applySynced keeps what the other device wrote)', () => {
    const remote = { ...createTeam(fmt, 'Remote'), createdOn: stamp(DESK, 'Desktop'), updatedOn: stamp(DESK, 'Desktop') };
    s().applySynced([remote], []);
    expect(s().teams[remote.id].createdOn).toBe(stamp(DESK, 'Desktop'));
    expect(s().teams[remote.id].updatedOn).toBe(stamp(DESK, 'Desktop'));
  });

  it('backfill labels only unlabelled teams, never changes updatedAt, and queues them for one push', () => {
    const old = { ...createTeam(fmt, 'Old'), updatedAt: 1_700_000_000_000 } as ReturnType<typeof createTeam>;
    delete old.createdOn;
    delete old.updatedOn;
    const known = { ...createTeam(fmt, 'Known'), createdOn: stamp(DESK, 'Desktop'), updatedOn: stamp(DESK, 'Desktop'), updatedAt: 1_700_000_000_500 };
    useTeamStore.setState((st) => ({ teams: { ...st.teams, [old.id]: old, [known.id]: known }, order: [...st.order, old.id, known.id] }));
    const before = Object.fromEntries(Object.values(s().teams).map((t) => [t.id, t.updatedAt]));
    const n = labelUnlabelledAsThisDevice();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(s().teams[old.id].createdOn).toBe(stamp(PHONE, 'Phone'));
    expect(s().teams[known.id].createdOn).toBe(stamp(DESK, 'Desktop')); // untouched
    for (const t of Object.values(s().teams)) expect(t.updatedAt).toBe(before[t.id]);
    expect(useSyncStore.getState().forced).toContain(`team:${old.id}`);
    expect(useSyncStore.getState().forced).not.toContain(`team:${known.id}`);
    expect(labelUnlabelledAsThisDevice()).toBe(0);
  });
});
