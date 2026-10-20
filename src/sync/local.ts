import { makeStamp } from '@/domain/deviceStamp';
import type { DocKind } from '@/domain/syncProtocol';
import { useShareStore } from './shareStore';
import { useSyncStore } from './syncStore';

/**
 * The `updatedAt` for an edit made now: never at or before the version this device last synced of that document.
 * A clock that runs behind another device's would otherwise stamp an edit older than the version it edits (the other
 * device's, pulled a moment ago); the server would refuse it as stale and the merge would take it for "unchanged",
 * silently dropping the edit. Stamping at least one millisecond past the synced version keeps edits ordered after
 * what they were made on, whatever the clocks say.
 */
export function editTime(kind: DocKind, id: string, now: number = Date.now()): number {
  const key = `${kind}:${id}`;
  const base = Math.max(useSyncStore.getState().known[key]?.updatedAt ?? 0, useShareStore.getState().known[key]?.updatedAt ?? 0);
  return Math.max(now, base + 1);
}

/** What this device writes into `createdOn` / `updatedOn` of the teams it makes or edits: its stable id and its name now. */
export function currentStamp(): string {
  const s = useSyncStore.getState();
  return makeStamp(s.deviceId || s.ensureDeviceId(), s.deviceName);
}
