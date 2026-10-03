import { create } from 'zustand';
import type { FieldConditions } from '@/domain/battle/conditions';
import type { Goal } from '@/domain/optimizer';

/** A request to open one slot's optimiser with goals already filled in (from Speed tiers or the Threat report). */
export interface OptimizerRequest {
  /** `${teamId}:${slot}`: the Pokémon whose spread is being optimised. */
  slotKey: string;
  goals: Goal[];
  field?: FieldConditions;
  /** My side has Tailwind up (from the Speed tiers scenario). */
  tailwind?: boolean;
}

interface OptimizerState {
  request: OptimizerRequest | null;
  open: (request: OptimizerRequest) => void;
  clear: () => void;
}

/** Not persisted: it only carries a hand-off between screens. */
export const useOptimizerStore = create<OptimizerState>()((set) => ({
  request: null,
  open: (request) => set({ request }),
  clear: () => set({ request: null }),
}));
