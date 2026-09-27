import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';

export type PokedexTab = 'info' | 'moves' | 'area';

interface PokedexState {
  /** Generation shown; undefined = follow the active team's format. */
  gen?: number;
  /** Selected species per generation. */
  species: Record<number, string | undefined>;
  tab: PokedexTab;
  /** Game picked on the Area tab, per generation (PokeAPI version id). */
  game: Record<number, string | undefined>;
  setGen: (gen: number) => void;
  select: (gen: number, speciesId: string | undefined) => void;
  setTab: (tab: PokedexTab) => void;
  setGame: (gen: number, game: string) => void;
}

export const usePokedexStore = create<PokedexState>()(
  persist(
    (set) => ({
      species: {},
      tab: 'info',
      game: {},
      setGen: (gen) => set({ gen }),
      select: (gen, speciesId) => set((s) => ({ species: { ...s.species, [gen]: speciesId } })),
      setTab: (tab) => set({ tab }),
      setGame: (gen, game) => set((s) => ({ game: { ...s.game, [gen]: game } })),
    }),
    { name: 'ptb:dex:v1', version: 1, storage: createJSONStorage(() => safeStorage) },
  ),
);
