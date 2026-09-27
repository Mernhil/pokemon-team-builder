import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { DEFAULT_FORMAT_ID, getFormat } from '@/domain/formats';
import { withSpreadValue } from '@/domain/stats';
import { sanitizeTeam } from '@/domain/sanitize';
import { cloneTeam, createTeam } from '@/domain/team';
import type { PokemonSet, StatId, Team, TeamSlots } from '@/domain/types';
import { defaultField, defaultSide, type FieldConditions, type SideConditions } from '@/domain/battle/conditions';

export type Theme = 'dark' | 'light';
export type View = 'builder' | 'calc' | 'dex';

/** Advanced-details state for one team member (keyed by set uid). */
export interface SlotBattleState {
  side: SideConditions;
  field: FieldConditions;
  crit: boolean;
}

interface TeamState {
  teams: Record<string, Team>;
  /** Display order of saved teams (most recent first). */
  order: string[];
  activeTeamId: string;
  activeSlot: number;
  theme: Theme;
  view: View;
  battle: Record<string, SlotBattleState>;

  // teams
  newTeam: (formatId?: string) => string;
  selectTeam: (id: string) => void;
  updateTeam: (id: string, patch: Partial<Pick<Team, 'name' | 'category' | 'notes' | 'replicaCode' | 'formatId'>>) => void;
  duplicateTeam: (id: string) => string;
  deleteTeam: (id: string) => void;
  addTeams: (teams: Team[], activate?: boolean) => void;

  // slots
  setActiveSlot: (i: number) => void;
  setSlot: (i: number, set: PokemonSet | null) => void;
  updateSet: (i: number, patch: Partial<PokemonSet>) => void;
  setMove: (i: number, moveIndex: number, moveId: string) => void;
  setSpread: (i: number, kind: 'sp' | 'evs' | 'ivs', stat: StatId, value: number) => void;
  resetSpread: (i: number, kind: 'sp' | 'evs') => void;
  moveSlot: (from: number, to: number) => void;

  setTheme: (t: Theme) => void;
  setView: (v: View) => void;
  setBattle: (uid: string, state: SlotBattleState) => void;
}


const firstTeam = createTeam(getFormat(DEFAULT_FORMAT_ID), 'My Champions Team');

export const useTeamStore = create<TeamState>()(
  persist(
    (set, get) => {
      /** Immutable update of the active team with updatedAt bump. */
      const mutateActive = (fn: (t: Team) => Team) =>
        set((s) => {
          const t = s.teams[s.activeTeamId];
          if (!t) return s;
          return { teams: { ...s.teams, [t.id]: { ...fn(t), updatedAt: Date.now() } } };
        });
      const mutateSlot = (i: number, fn: (p: PokemonSet) => PokemonSet) =>
        mutateActive((t) => {
          const cur = t.slots[i];
          if (!cur) return t;
          const slots = [...t.slots] as TeamSlots;
          slots[i] = fn(cur);
          return { ...t, slots };
        });

      return {
        teams: { [firstTeam.id]: firstTeam },
        order: [firstTeam.id],
        activeTeamId: firstTeam.id,
        activeSlot: 0,
        theme: 'dark',
        view: 'builder',
        battle: {},

        newTeam: (formatId = DEFAULT_FORMAT_ID) => {
          const t = createTeam(getFormat(formatId));
          set((s) => ({ teams: { ...s.teams, [t.id]: t }, order: [t.id, ...s.order], activeTeamId: t.id, activeSlot: 0 }));
          return t.id;
        },
        selectTeam: (id) => get().teams[id] && set({ activeTeamId: id, activeSlot: 0 }),
        updateTeam: (id, patch) =>
          set((s) => (s.teams[id] ? { teams: { ...s.teams, [id]: { ...s.teams[id], ...patch, updatedAt: Date.now() } } } : s)),
        duplicateTeam: (id) => {
          const src = get().teams[id];
          if (!src) return id;
          const t = cloneTeam(src);
          set((s) => ({ teams: { ...s.teams, [t.id]: t }, order: [t.id, ...s.order], activeTeamId: t.id, activeSlot: 0 }));
          return t.id;
        },
        deleteTeam: (id) =>
          set((s) => {
            const teams = { ...s.teams };
            delete teams[id];
            let order = s.order.filter((x) => x !== id);
            if (order.length === 0) {
              const t = createTeam(getFormat(DEFAULT_FORMAT_ID));
              teams[t.id] = t;
              order = [t.id];
            }
            return { teams, order, activeTeamId: s.activeTeamId === id ? order[0] : s.activeTeamId, activeSlot: 0 };
          }),
        addTeams: (incoming, activate = true) =>
          set((s) => {
            const teams = { ...s.teams };
            const ids: string[] = [];
            for (const t of incoming) {
              const copy = teams[t.id] ? cloneTeam(t, t.name) : t; // never overwrite silently
              teams[copy.id] = copy;
              ids.push(copy.id);
            }
            return {
              teams,
              order: [...ids, ...s.order.filter((x) => !ids.includes(x))],
              ...(activate && ids[0] ? { activeTeamId: ids[0], activeSlot: 0 } : {}),
            };
          }),

        setActiveSlot: (i) => set({ activeSlot: Math.max(0, Math.min(5, i)) }),
        setSlot: (i, p) =>
          mutateActive((t) => {
            const slots = [...t.slots] as TeamSlots;
            slots[i] = p;
            return { ...t, slots };
          }),
        updateSet: (i, patch) => mutateSlot(i, (p) => ({ ...p, ...patch })),
        setMove: (i, mi, moveId) =>
          mutateSlot(i, (p) => {
            const moves = [...p.moves] as PokemonSet['moves'];
            moves[mi] = moveId;
            return { ...p, moves };
          }),
        setSpread: (i, kind, stat, value) => {
          const team = get().teams[get().activeTeamId];
          const sys = getFormat(team.formatId).statSystem;
          mutateSlot(i, (p) => withSpreadValue(p, sys, kind, stat, value));
        },
        resetSpread: (i, kind) =>
          mutateSlot(i, (p) => ({ ...p, [kind]: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } })),
        moveSlot: (from, to) =>
          mutateActive((t) => {
            const slots = [...t.slots];
            const [x] = slots.splice(from, 1);
            slots.splice(to, 0, x);
            return { ...t, slots: slots as TeamSlots };
          }),

        setTheme: (theme) => set({ theme }),
        setView: (view) => set({ view }),
        setBattle: (uid, state) => set((s) => ({ battle: { ...s.battle, [uid]: state } })),
      };
    },
    {
      name: 'ptb:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ teams: s.teams, order: s.order, activeTeamId: s.activeTeamId, theme: s.theme, view: s.view, battle: s.battle }),
      // Stored state may be stale or corrupted: never let it leave the app without a valid active team.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<TeamState>;
        const teams: Record<string, Team> = {};
        for (const raw of Object.values(p.teams && typeof p.teams === 'object' ? p.teams : {})) {
          const t = sanitizeTeam(raw);
          if (t) teams[t.id] = t;
        }
        const ids = Object.keys(teams);
        if (ids.length === 0) return current;
        const order = [...new Set([...(Array.isArray(p.order) ? p.order : []), ...ids])].filter((id) => Object.hasOwn(teams, id));
        return {
          ...current,
          teams,
          order,
          activeTeamId: typeof p.activeTeamId === 'string' && Object.hasOwn(teams, p.activeTeamId) ? p.activeTeamId : order[0],
          theme: p.theme === 'light' ? 'light' : 'dark',
          view: p.view === 'calc' ? 'calc' : 'builder',
          battle: p.battle && typeof p.battle === 'object' ? p.battle : {},
        };
      },
    },
  ),
);

export const useActiveTeam = () => useTeamStore((s) => s.teams[s.activeTeamId]);

export const defaultSlotBattle = (hasMega: boolean): SlotBattleState => ({ side: defaultSide(hasMega), field: defaultField(), crit: false });

/**
 * Battle state of one team member (Mega on/off, conditions, crits), shared by the Stat Point
 * calculator's Base/Mega switch and Advanced details so the two never disagree.
 */
export function useSlotBattle(uid: string, hasMega: boolean) {
  const saved = useTeamStore((s) => s.battle[uid]);
  const state = useMemo(() => saved ?? defaultSlotBattle(hasMega), [saved, hasMega]);
  const update = (p: Partial<SlotBattleState>) => useTeamStore.getState().setBattle(uid, { ...state, ...p });
  return [state, update] as const;
}
