import { beforeEach, describe, expect, it } from 'vitest';
import { useTeamStore } from '@/store/teamStore';
import { editTime } from '../local';
import { useShareStore } from '../shareStore';
import { useSyncStore } from '../syncStore';

beforeEach(() => {
  useSyncStore.setState({ known: {} });
  useShareStore.setState({ known: {} });
});

describe('editTime', () => {
  it('is the clock when it is ahead of what was synced, and one millisecond past the synced version when it is behind', () => {
    useSyncStore.setState({ known: { 'team:a': { updatedAt: 5_000 } } });
    expect(editTime('team', 'a', 9_000)).toBe(9_000);
    expect(editTime('team', 'a', 4_000)).toBe(5_001); // the other device's clock ran ahead
    expect(editTime('team', 'a', 5_000)).toBe(5_001);
    expect(editTime('team', 'unknown', 4_000)).toBe(4_000);
    expect(editTime('match', 'a', 1)).toBe(1); // another kind with the same id
  });

  it('also looks at what is known of a shared team', () => {
    useShareStore.setState({ known: { 'team:s': { updatedAt: 7_000 } } });
    expect(editTime('team', 's', 1_000)).toBe(7_001);
  });

  it('a team edited on a device whose clock is behind is still stamped after the version it was synced at', () => {
    const { teams, activeTeamId } = useTeamStore.getState();
    const id = activeTeamId;
    const future = teams[id].updatedAt + 60_000;
    useSyncStore.setState({ known: { [`team:${id}`]: { updatedAt: future } } });
    useTeamStore.getState().updateTeam(id, { notes: 'edited on the phone a few seconds after the desktop' });
    expect(useTeamStore.getState().teams[id].updatedAt).toBe(future + 1);
  });
});
