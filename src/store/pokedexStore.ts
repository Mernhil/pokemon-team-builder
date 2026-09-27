import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';

export type PokedexTab = 'info' | 'moves' | 'area';

interface PokedexState {
  /** Book shown (gen1…gen9, lgpe, bdsp, pla, za); undefined = follow the active team's format. */
  book?: string;
  /** Selected species per book. */
  species: Record<string, string | undefined>;
  tab: PokedexTab;
  /** Game picked on the Area tab, per book (PokeAPI version id). */
  game: Record<string, string | undefined>;
  setBook: (book: string) => void;
  select: (book: string, speciesId: string | undefined) => void;
  setTab: (tab: PokedexTab) => void;
  setGame: (book: string, game: string) => void;
}

export const usePokedexStore = create<PokedexState>()(
  persist(
    (set) => ({
      species: {},
      tab: 'info',
      game: {},
      setBook: (book) => set({ book }),
      select: (book, speciesId) => set((s) => ({ species: { ...s.species, [book]: speciesId } })),
      setTab: (tab) => set({ tab }),
      setGame: (book, game) => set((s) => ({ game: { ...s.game, [book]: game } })),
    }),
    {
      name: 'ptb:dex:v1',
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      // v1 keyed everything by generation number; start fresh.
      migrate: () => ({ species: {}, tab: 'info', game: {} }) as unknown as PokedexState,
    },
  ),
);
