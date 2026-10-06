import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from '@/store/storage';
import { isDesktopApp } from './deviceStore';
import type { SyncState } from './engine';
import type { SyncStats } from './engine';

/**
 * Where cloud sync stands on this device. Opt-in (off by default), and kept apart from teams and
 * matches: turning sync off leaves them exactly as they are. Not synced itself.
 */
interface SyncStoreState extends SyncState {
  enabled: boolean;
  /** Names this device in "Conflict copy (<device>, <date>)". */
  deviceName: string;
  lastSyncAt?: number;
  lastError?: string;
  lastStats?: SyncStats;
  status: 'idle' | 'syncing';

  setEnabled: (enabled: boolean) => void;
  setDeviceName: (name: string) => void;
  saveState: (s: SyncState) => void;
  begin: () => void;
  succeed: (stats: SyncStats) => void;
  fail: (message: string) => void;
  /** Forget what was synced (the next run merges everything again); local data is untouched. */
  forget: () => void;
}

const randomName = () => `Device ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

export const useSyncStore = create<SyncStoreState>()(
  persist(
    (set) => ({
      enabled: false,
      deviceName: randomName(),
      cursor: 0,
      known: {},
      status: 'idle',
      setEnabled: (enabled) => set({ enabled, lastError: undefined }),
      setDeviceName: (deviceName) => set({ deviceName: deviceName.slice(0, 40) || randomName() }),
      saveState: ({ cursor, known }) => set({ cursor, known }),
      begin: () => set({ status: 'syncing', lastError: undefined }),
      succeed: (lastStats) => set({ status: 'idle', lastSyncAt: Date.now(), lastError: undefined, lastStats }),
      fail: (lastError) => set({ status: 'idle', lastError }),
      forget: () => set({ cursor: 0, known: {}, lastSyncAt: undefined, lastStats: undefined, lastError: undefined }),
    }),
    {
      name: 'ptb:sync:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ enabled: s.enabled, deviceName: s.deviceName, cursor: s.cursor, known: s.known, lastSyncAt: s.lastSyncAt }),
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
