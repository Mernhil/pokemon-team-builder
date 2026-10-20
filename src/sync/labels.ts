import { labelTeams, unlabelled } from '@/domain/deviceStamp';
import { useTeamStore } from '@/store/teamStore';
import { whileApplying } from './applying';
import { currentStamp } from './local';
import { syncNow } from './runner';
import { useSyncStore } from './syncStore';

/**
 * Settings → Sync → "Label unlabelled teams as this device". Marks every own team that has no device stamp (made
 * before 0.33) as made and last edited on this device. A label is not an edit: `updatedAt` is untouched, so the
 * labelled team can't win a later conflict, and it is sent once at its unchanged version (the server takes a team at
 * the same version only when the one change is added labels, `onlyAddsStamps`; the other devices take the labels
 * without a conflict, `adoptStamps`). Returns how many teams were labelled.
 */
export function labelUnlabelledAsThisDevice(): number {
  const todo = unlabelled(Object.values(useTeamStore.getState().teams));
  if (!todo.length) return 0;
  const labelled = labelTeams(todo, currentStamp());
  // Written like a sync write: not an edit, so no 5-second debounce and no `updatedAt` change.
  whileApplying(() => useTeamStore.getState().applySynced(labelled, []));
  const sync = useSyncStore.getState();
  sync.force(labelled.map((t) => `team:${t.id}`));
  sync.setDirty(true);
  void syncNow();
  return labelled.length;
}
