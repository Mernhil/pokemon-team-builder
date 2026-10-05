import { create } from 'zustand';

/** A hand-off from Saved teams: which team the Team overview should open on (used once, not persisted). */
interface ShowcaseState {
  teamId?: string;
  show: (teamId: string) => void;
  clear: () => void;
}

export const useShowcaseStore = create<ShowcaseState>()((set) => ({
  show: (teamId) => set({ teamId }),
  clear: () => set({ teamId: undefined }),
}));
