import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { parseMetaFile, type MetaFile } from '@/domain/meta';

/** Where the deployed app serves its copy of the meta data (vite.config.ts emits it). */
export const META_URL = 'meta/latest.json';
/** A hung request must not leave the Meta tab spinning. */
const FETCH_TIMEOUT_MS = 15_000;

interface MetaState {
  /**
   * A newer copy of the meta data than the one built into the app, fetched from the deployed site
   * and validated. Absent until the player refreshes (the built-in snapshot is always there).
   */
  refreshed?: MetaFile;
  refreshedAt?: number;
  status: 'idle' | 'loading' | 'error' | 'ok';
  error?: string;
  refresh: () => Promise<void>;
}

/**
 * v1 cached championsbattledata.com responses per regulation (a third-party API the app no longer
 * uses). They were a cache, not the player's data, so v2 simply drops them.
 */
export function migrateMetaState(persisted: unknown, version: number): Partial<MetaState> {
  if (version < 2) return {};
  const p = (persisted ?? {}) as Partial<MetaState>;
  try {
    return p.refreshed ? { refreshed: parseMetaFile(p.refreshed), refreshedAt: typeof p.refreshedAt === 'number' ? p.refreshedAt : undefined } : {};
  } catch {
    return {};
  }
}

export const useMetaStore = create<MetaState>()(
  persist(
    (set) => ({
      status: 'idle',
      refresh: async () => {
        set({ status: 'loading', error: undefined });
        try {
          const res = await fetch(`${import.meta.env.BASE_URL ?? './'}${META_URL}`.replace(/^\/\//, '/'), {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`The server answered HTTP ${res.status}.`);
          const file = parseMetaFile(await res.json());
          set({ refreshed: file, refreshedAt: Date.now(), status: 'ok' });
        } catch (e) {
          const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
          set({ status: 'error', error: offline ? 'You’re offline.' : (e as Error).message || 'The refresh failed.' });
        }
      },
    }),
    {
      name: 'ptb:meta:v1',
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ refreshed: s.refreshed, refreshedAt: s.refreshedAt }) as MetaState,
      migrate: (p, v) => migrateMetaState(p, v) as MetaState,
      // A corrupted or hand-edited cache is dropped, never trusted.
      merge: (persisted, current) => ({ ...current, ...migrateMetaState(persisted, 2) }),
    },
  ),
);
