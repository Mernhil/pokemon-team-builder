import { create } from 'zustand';

/** A species another screen wants Speed tiers or the Threat report to point at (e.g. a match-log nemesis). Not persisted. */
interface FocusState {
  speciesId: string | null;
  focus: (speciesId: string) => void;
  clear: () => void;
}

export const useFocusStore = create<FocusState>()((set) => ({
  speciesId: null,
  focus: (speciesId) => set({ speciesId }),
  clear: () => set({ speciesId: null }),
}));
