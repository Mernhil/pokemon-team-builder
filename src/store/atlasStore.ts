import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Progress } from '@/domain/atlas';
import { safeStorage } from './storage';

export type AtlasPage = 'map' | 'items' | 'trainers' | 'progress';
export type LocationTab = 'overview' | 'items' | 'npcs' | 'wild' | 'trainers' | 'events';

const EMPTY: Progress = { locations: [], items: [], trainers: [] };

interface AtlasState {
  game: string;
  page: AtlasPage;
  /** Progress tracker per game: visited locations, collected items, beaten trainers. */
  progress: Record<string, Progress>;
  /** One-shot request to open a location (from the Pokédex); not persisted. */
  focus?: { game: string; loc: string };
  setFocus: (focus?: { game: string; loc: string }) => void;
  setGame: (game: string) => void;
  setPage: (page: AtlasPage) => void;
  toggle: (game: string, kind: keyof Progress, key: string) => void;
  resetProgress: (game: string) => void;
}

export const useAtlasStore = create<AtlasState>()(
  persist(
    (set) => ({
      game: 'platinum',
      page: 'map',
      progress: {},
      setFocus: (focus) => set(focus ? { focus, game: focus.game } : { focus: undefined }),
      setGame: (game) => set({ game }),
      setPage: (page) => set({ page }),
      toggle: (game, kind, key) =>
        set((s) => {
          const cur = s.progress[game] ?? EMPTY;
          const list = cur[kind].includes(key) ? cur[kind].filter((k) => k !== key) : [...cur[kind], key];
          return { progress: { ...s.progress, [game]: { ...cur, [kind]: list } } };
        }),
      resetProgress: (game) => set((s) => ({ progress: { ...s.progress, [game]: EMPTY } })),
    }),
    {
      name: 'ptb:atlas:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ game: s.game, page: s.page, progress: s.progress }) as unknown as AtlasState,
    },
  ),
);

export const useProgress = (game: string): Progress => useAtlasStore((s) => s.progress[game] ?? EMPTY);
