import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { fetchChampionsMeta, localMetaFromMatches, type MetaSnapshot } from '@/domain/meta';
import { useMatchStore } from './matchStore';

interface MetaState {
  /** Cached usage snapshot per regulation id — fetched on demand, not on every load. */
  snapshots: Record<string, MetaSnapshot>;
  loading: Record<string, boolean>;
  errors: Record<string, string | undefined>;
  fetchRegulation: (regulationId: string) => Promise<void>;
}

export const useMetaStore = create<MetaState>()(
  persist(
    (set) => ({
      snapshots: {},
      loading: {},
      errors: {},
      fetchRegulation: async (regulationId) => {
        set((s) => ({ loading: { ...s.loading, [regulationId]: true }, errors: { ...s.errors, [regulationId]: undefined } }));
        try {
          const snap = await fetchChampionsMeta(regulationId);
          set((s) => ({ snapshots: { ...s.snapshots, [regulationId]: snap }, loading: { ...s.loading, [regulationId]: false } }));
        } catch (e) {
          // championsbattledata.com is an unofficial third party and can be unreachable; if we don't
          // already have a cached (possibly live) snapshot, fall back to one built from the player's
          // own logged matches so the tab still shows real data instead of just an error.
          set((s) => {
            const hasSnapshot = !!s.snapshots[regulationId];
            const localSnap = hasSnapshot ? null : localMetaFromMatches(Object.values(useMatchStore.getState().matches), regulationId);
            return {
              snapshots: localSnap ? { ...s.snapshots, [regulationId]: localSnap } : s.snapshots,
              loading: { ...s.loading, [regulationId]: false },
              errors: { ...s.errors, [regulationId]: (e as Error).message || 'Fetch failed.' },
            };
          });
        }
      },
    }),
    {
      name: 'ptb:meta:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      // Only the cached snapshots are worth persisting — in-flight/error state is transient.
      partialize: (s) => ({ snapshots: s.snapshots }) as MetaState,
    },
  ),
);
