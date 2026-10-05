import { create } from 'zustand';

/** What Reverse search opens with once ("Find in Reverse search" from a teammate suggestion): one-shot these species. Not persisted. */
interface ReverseSeed {
  seed: { kind: 'ohko'; speciesIds: string[] } | null;
  set: (seed: ReverseSeed['seed']) => void;
}
export const useReverseSeed = create<ReverseSeed>()((set) => ({ seed: null, set: (seed) => set({ seed }) }));
