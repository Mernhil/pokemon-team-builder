import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { defaultField, defaultSide, type FieldConditions, type SideConditions } from '@/domain/battle/conditions';
import type { PokemonSet } from '@/domain/types';

export interface CalcSide {
  set: PokemonSet | null;
  cond: SideConditions;
  /** Per-move critical-hit toggles. */
  crits: [boolean, boolean, boolean, boolean];
  /** Where the set was loaded from, for the "from your team" label. */
  origin?: { teamName: string; slot: number };
}

export type SideKey = 'attacker' | 'defender';

interface CalcState {
  attacker: CalcSide;
  defender: CalcSide;
  field: FieldConditions;
  setSide: (k: SideKey, side: CalcSide) => void;
  patchSide: (k: SideKey, patch: Partial<CalcSide>) => void;
  patchSet: (k: SideKey, patch: Partial<PokemonSet>) => void;
  patchCond: (k: SideKey, patch: Partial<SideConditions>) => void;
  setField: (patch: Partial<FieldConditions>) => void;
  swap: () => void;
}

const emptySide = (): CalcSide => ({ set: null, cond: defaultSide(), crits: [false, false, false, false] });


export const useCalcStore = create<CalcState>()(
  persist(
    (set) => ({
      attacker: emptySide(),
      defender: emptySide(),
      field: defaultField(),
      setSide: (k, side) => set({ [k]: side } as Partial<CalcState>),
      patchSide: (k, patch) => set((s) => ({ [k]: { ...s[k], ...patch } }) as Partial<CalcState>),
      patchSet: (k, patch) =>
        set((s) => (s[k].set ? ({ [k]: { ...s[k], set: { ...s[k].set!, ...patch } } } as Partial<CalcState>) : s)),
      patchCond: (k, patch) => set((s) => ({ [k]: { ...s[k], cond: { ...s[k].cond, ...patch } } }) as Partial<CalcState>),
      setField: (patch) => set((s) => ({ field: { ...s.field, ...patch } })),
      swap: () => set((s) => ({ attacker: s.defender, defender: s.attacker })),
    }),
    { name: 'ptb:calc:v1', version: 1, storage: createJSONStorage(() => safeStorage) },
  ),
);
