import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from '@/store/storage';
import { DEVICE_ID_RE, deviceKind, newDeviceId } from '@/domain/deviceStamp';
import { isDesktopApp } from './deviceStore';
import type { SyncErrorKind } from './http';
import type { SyncState } from './engine';
import type { SyncStats } from './engine';

/**
 * Where cloud sync stands on this device. Opt-in (off by default), and kept apart from teams and
 * matches: turning sync off leaves them exactly as they are. Not synced itself.
 */
interface SyncStoreState extends SyncState {
  enabled: boolean;
  /** Names this device in "Conflict copy (<device>, <date>)" and on the teams it makes. */
  deviceName: string;
  /** This install's stable id (kind letter + 7 characters), stamped on the teams it makes or edits (src/domain/deviceStamp.ts). Made on first use, kept when sync is turned off or forgotten. */
  deviceId: string;
  /** Teams labelled without an edit, to send once at their unchanged version (Settings → Sync → Label unlabelled teams). */
  forced: string[];
  /** Ids of teams that arrived through sync and haven't been opened yet ("New from <device>"). */
  unseen: string[];
  lastSyncAt?: number;
  /** Local edits the server may not have yet. Set at the edit, cleared only once a push confirmed everything (persisted, so a killed app still pushes on its next start). */
  dirty: boolean;
  /** When the app last sent edits on its way to the background (a keepalive push). */
  lastFlushAt?: number;
  lastError?: string;
  /** What kind of failure `lastError` was; the banner, the header dot and the retries go by it. */
  lastErrorKind?: SyncErrorKind;
  /** The HTTP status of the failure (0: a redirect to the Access login), when there was one. */
  lastErrorStatus?: number;
  /** When the last run started (successful or not). */
  lastAttemptAt?: number;
  /** The sign-in banner was dismissed; it comes back with the next new sign-in failure. */
  bannerDismissed: boolean;
  lastStats?: SyncStats;
  status: 'idle' | 'syncing';

  setEnabled: (enabled: boolean) => void;
  setDeviceName: (name: string) => void;
  /** This install's device id, made on first use. */
  ensureDeviceId: () => string;
  markUnseen: (ids: string[]) => void;
  markSeen: (id: string) => void;
  /** Queue labelled teams for a one-off push at their unchanged version. */
  force: (keys: string[]) => void;
  saveState: (s: SyncState) => void;
  begin: () => void;
  setDirty: (dirty: boolean) => void;
  succeed: (stats: SyncStats, stillDirty?: boolean) => void;
  /** A background flush ended well: `stillDirty` when some edits did not fit it. */
  endFlush: (stillDirty: boolean) => void;
  fail: (message: string, kind?: SyncErrorKind, status?: number) => void;
  dismissBanner: () => void;
  /** Forget what was synced (the next run merges everything again); local data is untouched. */
  forget: () => void;
}

const randomName = () => `Device ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

export const useSyncStore = create<SyncStoreState>()(
  persist(
    (set, get) => ({
      enabled: false,
      deviceName: randomName(),
      cursor: 0,
      known: {},
      status: 'idle',
      bannerDismissed: false,
      dirty: false,
      deviceId: '',
      forced: [],
      unseen: [],
      setEnabled: (enabled) => set({ enabled, lastError: undefined, lastErrorKind: undefined, lastErrorStatus: undefined, bannerDismissed: false }),
      setDeviceName: (deviceName) => set({ deviceName: deviceName.slice(0, 40) || randomName() }),
      ensureDeviceId: () => {
        const cur = get().deviceId;
        if (cur) return cur;
        const id = newDeviceId(deviceKind({ userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent, maxTouchPoints: typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints, desktopApp: isDesktopApp() }));
        set({ deviceId: id });
        return id;
      },
      markUnseen: (ids) => set((s) => (ids.length ? { unseen: [...new Set([...s.unseen, ...ids])].slice(-200) } : s)),
      markSeen: (id) => set((s) => (s.unseen.includes(id) ? { unseen: s.unseen.filter((x) => x !== id) } : s)),
      force: (keys) => set((s) => ({ forced: [...new Set([...s.forced, ...keys])] })),
      saveState: ({ cursor, known, forced }) => set({ cursor, known, ...(forced ? { forced } : { forced: [] }) }),
      // The previous error stays visible while the next try runs, so a banner doesn't blink on every retry.
      begin: () => set({ status: 'syncing', lastAttemptAt: Date.now() }),
      setDirty: (dirty) => set({ dirty }),
      endFlush: (dirty) => set({ status: 'idle', dirty, lastFlushAt: Date.now(), lastError: undefined, lastErrorKind: undefined, lastErrorStatus: undefined, bannerDismissed: false }),
      succeed: (lastStats, dirty = false) => set({ status: 'idle', dirty, lastSyncAt: Date.now(), lastError: undefined, lastErrorKind: undefined, lastErrorStatus: undefined, bannerDismissed: false, lastStats }),
      fail: (lastError, lastErrorKind = 'other', lastErrorStatus) =>
        set((s) => ({ status: 'idle', lastError, lastErrorKind, lastErrorStatus, bannerDismissed: lastErrorKind === 'signin' && s.lastErrorKind === 'signin' ? s.bannerDismissed : false })),
      dismissBanner: () => set({ bannerDismissed: true }),
      forget: () => set({ dirty: false, forced: [], unseen: [], cursor: 0, known: {}, lastSyncAt: undefined, lastStats: undefined, lastError: undefined, lastErrorKind: undefined, lastErrorStatus: undefined, lastAttemptAt: undefined, bannerDismissed: false }),
    }),
    {
      name: 'ptb:sync:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ enabled: s.enabled, deviceName: s.deviceName, deviceId: s.deviceId, forced: s.forced, unseen: s.unseen, cursor: s.cursor, known: s.known, lastSyncAt: s.lastSyncAt, dirty: s.dirty }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SyncStoreState>;
        const known: SyncState['known'] = {};
        if (p.known && typeof p.known === 'object') for (const [k, v] of Object.entries(p.known)) if (v && typeof v.updatedAt === 'number' && /^(team|match):/.test(k)) known[k] = { updatedAt: v.updatedAt };
        return {
          ...current,
          enabled: p.enabled === true,
          deviceName: typeof p.deviceName === 'string' && p.deviceName ? p.deviceName.slice(0, 40) : current.deviceName,
          cursor: typeof p.cursor === 'number' && p.cursor >= 0 ? p.cursor : 0,
          known,
          lastSyncAt: typeof p.lastSyncAt === 'number' ? p.lastSyncAt : undefined,
          dirty: p.dirty === true,
          deviceId: typeof p.deviceId === 'string' && DEVICE_ID_RE.test(p.deviceId) ? p.deviceId : '',
          forced: Array.isArray(p.forced) ? p.forced.filter((k): k is string => typeof k === 'string' && /^team:/.test(k)).slice(0, 2000) : [],
          unseen: Array.isArray(p.unseen) ? p.unseen.filter((k): k is string => typeof k === 'string').slice(-200) : [],
        };
      },
    },
  ),
);

/**
 * Sync needs the hosted web app (signed in through Access) or the desktop app (linked with a pairing
 * code, src/sync/deviceStore.ts).
 */
export const syncAvailable = (): boolean =>
  typeof window !== 'undefined' && (isDesktopApp() || /^https?:$/.test(location.protocol));
