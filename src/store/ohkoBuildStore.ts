import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { sanitizeReverseBuilds } from './reverseBuildStore';
import type { PokemonSet } from '@/domain/types';
import { safeStorage } from './storage';

interface OhkoBuildState {
  /** The player's own build of an opponent (by species id): used for it in the OHKO report instead of its most-used set. */
  builds: Record<string, PokemonSet>;
  setBuild: (speciesId: string, set: PokemonSet) => void;
  /** Back to the most-used set for one species. */
  resetBuild: (speciesId: string) => void;
  resetAll: () => void;
  /** Puts builds back (the Undo of a reset). */
  restore: (builds: Record<string, PokemonSet>) => void;
}

/** Whatever was stored, loaded through the same sanitiser as the Reverse search builds: never a broken set, or one filed under another species. */
export const sanitizeOhkoBuilds = (persisted: unknown): Pick<OhkoBuildState, 'builds'> => {
  const p = (persisted && typeof persisted === 'object' ? persisted : {}) as { builds?: unknown };
  return { builds: sanitizeReverseBuilds({ overrides: p.builds }).overrides };
};

/** The OHKO report's own opponent builds. Persisted as 'ptb:ohko-builds:v1'. */
export const useOhkoBuilds = create<OhkoBuildState>()(
  persist(
    (set) => ({
      builds: {},
      setBuild: (speciesId, build) => set((s) => ({ builds: { ...s.builds, [speciesId]: build } })),
      resetBuild: (speciesId) =>
        set((s) => {
          if (!(speciesId in s.builds)) return s;
          const { [speciesId]: _gone, ...rest } = s.builds;
          return { builds: rest };
        }),
      resetAll: () => set({ builds: {} }),
      restore: (builds) => set((s) => ({ builds: { ...s.builds, ...builds } })),
    }),
    {
      name: 'ptb:ohko-builds:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ builds: s.builds }),
      migrate: (persisted) => sanitizeOhkoBuilds(persisted) as unknown as OhkoBuildState,
      merge: (persisted, current) => ({ ...current, ...sanitizeOhkoBuilds(persisted) }),
    },
  ),
);
