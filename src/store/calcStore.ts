import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { defaultField, defaultSide, type FieldConditions, type SideConditions } from '@/domain/battle/conditions';
import { sanitizeSet } from '@/domain/sanitize';
import type { PokemonSet } from '@/domain/types';

export interface CalcSide {
  set: PokemonSet | null;
  cond: SideConditions;
  /** Per-move critical-hit toggles. */
  crits: [boolean, boolean, boolean, boolean];
  /** Chosen hit counts for multi-hit moves, by move id (missing: automatic, from the move's accuracy, ability and item). */
  hits?: Record<string, number>;
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
 * v3: the "Mega Evolved" toggle (cond.mega: boolean) became a Base/Mega/Both control
 * (cond.megaMode: 'base' | 'mega' | 'both').
 */
function migrateCalcState(persisted: unknown, version: number): CalcState {
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
  if (version < 3) {
    for (const k of ['attacker', 'defender'] as const) {
      const side = p[k];
      if (!side || typeof side !== 'object' || !side.cond || typeof side.cond !== 'object') continue;
      const { mega, ...rest } = side.cond as SideConditions & { mega?: boolean };
      side.cond = { ...rest, megaMode: mega ? 'both' : 'base' };
    }
  }
  return p as CalcState;
}

const emptySide = (): CalcSide => ({ set: null, cond: defaultSide(), crits: [false, false, false, false] });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merges saved values over the defaults: a key keeps its saved value only when it has the default's type, so a field added later is never undefined. */
function overlay<T extends object>(defaults: T, saved: unknown): T {
  const out = { ...defaults } as Record<string, unknown>;
  if (!isRecord(saved)) return out as T;
  for (const [k, d] of Object.entries(defaults)) {
    const v = saved[k];
    if (isRecord(d)) out[k] = overlay(d, v);
    else if (typeof v === typeof d && (typeof v !== 'number' || Number.isFinite(v))) out[k] = v;
  }
  return out as T;
}

function sanitizeSide(raw: unknown): CalcSide {
  const base = emptySide();
  if (!isRecord(raw)) return base;
  const cond = overlay(base.cond, raw.cond);
  if (isRecord(raw.cond) && (raw.cond.statForm === 'auto' || raw.cond.statForm === 'base' || raw.cond.statForm === 'alt')) cond.statForm = raw.cond.statForm;
  const crits = Array.isArray(raw.crits) ? ([0, 1, 2, 3].map((i) => raw.crits instanceof Array && raw.crits[i] === true) as CalcSide['crits']) : base.crits;
  const side: CalcSide = { set: sanitizeSet(raw.set), cond, crits };
  if (isRecord(raw.hits)) {
    const hits = Object.fromEntries(Object.entries(raw.hits).filter(([, n]) => typeof n === 'number' && Number.isFinite(n)));
    if (Object.keys(hits).length) side.hits = hits as Record<string, number>;
  }
  if (isRecord(raw.origin) && typeof raw.origin.teamName === 'string' && typeof raw.origin.slot === 'number') side.origin = { teamName: raw.origin.teamName, slot: raw.origin.slot };
  return side;
}

/** Saved state may be stale or corrupted: sanitise both sides and the field on load, over today's defaults. */
export function mergeCalcState(persisted: unknown, current: CalcState): CalcState {
  const p = isRecord(persisted) ? persisted : {};
  return { ...current, attacker: sanitizeSide(p.attacker), defender: sanitizeSide(p.defender), field: overlay(defaultField(), p.field) };
}


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
    { name: 'ptb:calc:v1', version: 3, storage: createJSONStorage(() => safeStorage), migrate: migrateCalcState, merge: mergeCalcState },
  ),
);
