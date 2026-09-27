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
export type View = 'builder' | 'calc' | 'dex' | 'matches' | 'meta';

/** Advanced-details state for one team member (keyed by set uid). */
export interface SlotBattleState {
  side: SideConditions;
  field: FieldConditions;
  crit: boolean;
}

export interface TeamState {
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
  updateTeam: (id: string, patch: Partial<Pick<Team, 'name' | 'category' | 'notes' | 'replicaCode' | 'formatId' | 'variationLabel'>>) => void;
  duplicateTeam: (id: string) => string;
  /** Explicitly commits the current in-progress build as a new, distinctly-named top-level entry. */
  saveAsNew: (name: string) => string;
  /** Duplicates `id` (or its group) and nests the copy as a variation under the same group. */
  addVariation: (id: string) => string;
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

/**
 * v1 stored teams as a flat list. v2 adds optional `groupId`/`variationLabel` for folder-style
 * grouping; a flat v1 team has neither, which already reads as a top-level group with no
 * variations, so there is nothing to transform here — `mergeTeamState` below (re)normalises
 * `order` and drops any dangling `groupId` regardless of the stored version.
 */
export function migrateTeamState(persisted: unknown, _version: number): TeamState {
  return persisted as TeamState;
}

// Stored state may be stale or corrupted: never let it leave the app without a valid active team.
export function mergeTeamState(persisted: unknown, current: TeamState): TeamState {
  const p = (persisted ?? {}) as Partial<TeamState>;
  const teams: Record<string, Team> = {};
  for (const raw of Object.values(p.teams && typeof p.teams === 'object' ? p.teams : {})) {
    const t = sanitizeTeam(raw);
    if (t) teams[t.id] = t;
  }
  const ids = Object.keys(teams);
  if (ids.length === 0) return current;
  // A variation whose parent group didn't survive sanitising becomes a top-level group itself,
  // rather than silently disappearing from the saved-teams list.
  for (const t of Object.values(teams)) {
    if (t.groupId && !Object.hasOwn(teams, t.groupId)) t.groupId = undefined;
  }
  // Battle state is keyed by set uid and never pruned when a set is removed: drop entries whose set
  // no longer exists (and anything malformed) so it doesn't grow in localStorage forever.
  const liveUids = new Set(Object.values(teams).flatMap((t) => t.slots.map((s) => s?.uid)));
  const battle: Record<string, SlotBattleState> = {};
  if (p.battle && typeof p.battle === 'object') {
    for (const [uid, b] of Object.entries(p.battle)) {
      if (liveUids.has(uid) && b && typeof b === 'object' && b.side && b.field) battle[uid] = b;
    }
  }
  const topLevelIds = ids.filter((id) => !teams[id].groupId);
  const order = [...new Set([...(Array.isArray(p.order) ? p.order : []), ...topLevelIds])].filter((id) => topLevelIds.includes(id));
  return {
    ...current,
    teams,
    order,
    activeTeamId: typeof p.activeTeamId === 'string' && Object.hasOwn(teams, p.activeTeamId) ? p.activeTeamId : order[0],
    theme: p.theme === 'light' ? 'light' : 'dark',
    view: p.view === 'calc' || p.view === 'dex' || p.view === 'matches' || p.view === 'meta' ? p.view : 'builder',
    battle,
  };
}

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
          const t = cloneTeam(src); // always a new top-level group, even if `src` was a variation
          set((s) => ({ teams: { ...s.teams, [t.id]: t }, order: [t.id, ...s.order], activeTeamId: t.id, activeSlot: 0 }));
          return t.id;
        },
        saveAsNew: (name) => {
          const src = get().teams[get().activeTeamId];
          if (!src) return get().activeTeamId;
          const t = cloneTeam(src, name.trim() || src.name);
          set((s) => ({ teams: { ...s.teams, [t.id]: t }, order: [t.id, ...s.order], activeTeamId: t.id, activeSlot: 0 }));
          return t.id;
        },
        addVariation: (id) => {
          const src = get().teams[id];
          if (!src) return id;
          const groupId = src.groupId ?? src.id;
          const siblings = Object.values(get().teams).filter((t) => t.groupId === groupId).length;
          const t = cloneTeam(src, src.name, { groupId, variationLabel: `Variation ${siblings + 2}` });
          set((s) => ({ teams: { ...s.teams, [t.id]: t }, activeTeamId: t.id, activeSlot: 0 }));
          return t.id;
        },
        deleteTeam: (id) =>
          set((s) => {
            const target = s.teams[id];
            if (!target) return s;
            const teams = { ...s.teams };
            delete teams[id];
            // Deleting a top-level group takes its variations with it; deleting a variation only removes itself.
            if (!target.groupId) {
              for (const t of Object.values(s.teams)) if (t.groupId === id) delete teams[t.id];
            }
            let order = s.order.filter((x) => x !== id);
            if (order.length === 0) {
              const t = createTeam(getFormat(DEFAULT_FORMAT_ID));
              teams[t.id] = t;
              order = [t.id];
            }
            const activeTeamId = teams[s.activeTeamId] ? s.activeTeamId : order[0];
            return { teams, order, activeTeamId, activeSlot: 0 };
          }),
        addTeams: (incoming, activate = true) =>
          set((s) => {
            const teams = { ...s.teams };
            const idMap = new Map<string, string>(); // original incoming id -> id actually used, when remapped to avoid a collision
            const prepared = incoming.map((t) => {
              if (teams[t.id]) {
                const copy = cloneTeam(t, t.name, { groupId: t.groupId, variationLabel: t.variationLabel });
                idMap.set(t.id, copy.id);
                return copy;
              }
              return { ...t };
            });
            // A variation's groupId must resolve to another team in this same import (or the existing
            // store) — anything else (missing parent, self-reference) is promoted to a top-level group.
            const validGroupIds = new Set([...Object.keys(s.teams), ...prepared.map((p) => p.id)]);
            const ids: string[] = [];
            const orderAdds: string[] = [];
            for (const t of prepared) {
              const mapped = t.groupId ? (idMap.get(t.groupId) ?? t.groupId) : undefined;
              const groupId = mapped && mapped !== t.id && validGroupIds.has(mapped) ? mapped : undefined;
              const copy = { ...t, groupId };
              teams[copy.id] = copy;
              ids.push(copy.id);
              if (!groupId) orderAdds.push(copy.id);
            }
            return {
              teams,
              order: [...orderAdds, ...s.order.filter((x) => !orderAdds.includes(x))],
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
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ teams: s.teams, order: s.order, activeTeamId: s.activeTeamId, theme: s.theme, view: s.view, battle: s.battle }),
      migrate: migrateTeamState,
      merge: mergeTeamState,
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
