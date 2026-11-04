import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { sanitizeSet } from '@/domain/sanitize';
import type { PokemonSet } from '@/domain/types';
import { safeStorage } from './storage';

/** The most builds kept: a Pokédex's worth is already far more than anyone edits. */
const MAX_BUILDS = 1100;

interface ReverseBuildState {
  /** The player's own build of a species (by species id): used for it in Reverse search instead of the meta or default set. */
  overrides: Record<string, PokemonSet>;
  /** "Try Mega Stones": also try each Mega-capable species holding its stone. */
  tryStones: boolean;
  setBuild: (speciesId: string, set: PokemonSet) => void;
  /** Back to the meta or default set for one species. */
  resetBuild: (speciesId: string) => void;
  resetAll: () => void;
  /** Puts builds back (the Undo of a reset). */
  restore: (overrides: Record<string, PokemonSet>) => void;
  setTryStones: (on: boolean) => void;
}

/** Whatever was stored, loaded through the sanitiser: never a broken set, or one filed under another species. */
export function sanitizeReverseBuilds(persisted: unknown): Pick<ReverseBuildState, 'overrides' | 'tryStones'> {
  const p = (persisted && typeof persisted === 'object' ? persisted : {}) as { overrides?: unknown; tryStones?: unknown };
  const overrides: Record<string, PokemonSet> = {};
  if (p.overrides && typeof p.overrides === 'object' && !Array.isArray(p.overrides)) {
    for (const [id, raw] of Object.entries(p.overrides).slice(0, MAX_BUILDS)) {
      const set = sanitizeSet(raw);
      if (set && set.speciesId === id) overrides[id] = set;
    }
  }
  return { overrides, tryStones: p.tryStones === true };
}

/** Reverse search's own builds and its stone toggle. Persisted as 'ptb:reverse-builds:v1'. */
export const useReverseBuilds = create<ReverseBuildState>()(
  persist(
    (set) => ({
      overrides: {},
      tryStones: false,
      setBuild: (speciesId, build) => set((s) => ({ overrides: { ...s.overrides, [speciesId]: build } })),
      resetBuild: (speciesId) =>
        set((s) => {
          if (!(speciesId in s.overrides)) return s;
          const { [speciesId]: _gone, ...rest } = s.overrides;
          return { overrides: rest };
        }),
      resetAll: () => set({ overrides: {} }),
      restore: (overrides) => set((s) => ({ overrides: { ...s.overrides, ...overrides } })),
      setTryStones: (tryStones) => set({ tryStones }),
    }),
    {
      name: 'ptb:reverse-builds:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ overrides: s.overrides, tryStones: s.tryStones }),
      migrate: (persisted) => sanitizeReverseBuilds(persisted) as unknown as ReverseBuildState,
      merge: (persisted, current) => ({ ...current, ...sanitizeReverseBuilds(persisted) }),
    },
  ),
);
