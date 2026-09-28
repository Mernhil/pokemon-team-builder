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

/**
 * v2: Terastallization exists only in Scarlet/Violet. The calculator's two sides are scratch sets
 * not tied to a format (and Champions sets used to get a default Tera Type), so v2 clears the Tera
 * toggle and Tera Type on both; a Scarlet/Violet user just re-picks it.
 */
export function migrateCalcState(persisted: unknown, version: number): CalcState {
  const p = (persisted ?? {}) as Partial<CalcState>;
  if (version < 2) {
    for (const k of ['attacker', 'defender'] as const) {
      const side = p[k];
      if (!side || typeof side !== 'object') continue;
      if (side.cond && typeof side.cond === 'object') side.cond = { ...side.cond, tera: false };
      if (side.set && typeof side.set === 'object') {
        const { teraType: _dropped, ...rest } = side.set;
        side.set = rest;
      }
    }
  }
  return p as CalcState;
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
    { name: 'ptb:calc:v1', version: 2, storage: createJSONStorage(() => safeStorage), migrate: migrateCalcState },
  ),
);
