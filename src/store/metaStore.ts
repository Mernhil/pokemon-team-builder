import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { fetchChampionsMeta, type MetaSnapshot } from '@/domain/meta';

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
          set((s) => ({
            loading: { ...s.loading, [regulationId]: false },
            errors: { ...s.errors, [regulationId]: (e as Error).message || 'Fetch failed.' },
          }));
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
