import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { toast } from './toastStore';
import { DEFAULT_FORMAT_ID, getFormat } from '@/domain/formats';
import { withSpreadValue } from '@/domain/stats';
import { sanitizeTeam } from '@/domain/sanitize';
import { cloneTeam, createTeam, DEFAULT_TEAM_NAME, emptySlots, enforceCapabilities, isSavedTeam } from '@/domain/team';
import { DEFAULT_ANALYSE_TAB, DEFAULT_OHKO_MODE, routeFromSaved, type AnalyseTab, type OhkoMode, type Route, type View } from '@/domain/routes';
import type { PokemonSet, StatId, Team, TeamSlots } from '@/domain/types';
import { defaultField, defaultSide, type FieldConditions, type SideConditions } from '@/domain/battle/conditions';

export type Theme = 'dark' | 'light';
export type { View };

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
  /**
   * The saved team the builder's draft was loaded from (Edit team) or last saved into. The builder
   * only ever edits the scratch draft; a saved team changes when you Save over it, never by editing.
   */
  editingFrom: string | null;
  /** The draft `editingFrom` belongs to: once another team becomes the open one, the link no longer applies. */
  editingDraft: string | null;
  theme: Theme;
  view: View;
  /** Analyse's tab, and which way round its OHKO tab reads. Not saved: a reload opens the first tab (or the one in the URL). */
  analyseTab: AnalyseTab;
  ohkoMode: OhkoMode;
  battle: Record<string, SlotBattleState>;

  // teams
  newTeam: (formatId?: string) => string;
  selectTeam: (id: string) => void;
  /**
   * Loads a saved team into the builder's scratch draft (replacing what's in it) so it can be
   * changed without touching the saved copy; Save then updates the saved team. A view-only shared
   * team is just shown. Returns the id of the team now open.
   */
  editTeam: (id: string) => string;
  updateTeam: (id: string, patch: Partial<Pick<Team, 'name' | 'category' | 'notes' | 'replicaCode' | 'variationLabel'>>) => void;
  /**
   * Switches a team to a different format, saving its current roster under its old formatId and
   * restoring whatever roster it last had under the new one (empty, the first time). Keeps a
   * species from one format's Pokédex (e.g. Bulbasaur in Gen 9) from getting stuck, unremovable, in
   * a format whose dex doesn't have it (e.g. Champions) after switching the format selector.
   */
  switchFormat: (id: string, formatId: string) => void;
  duplicateTeam: (id: string) => string;
  /** Commits a copy of the current build as a new, distinctly-named top-level entry; the build itself stays open. */
  saveAsNew: (name: string) => string;
  /**
   * Saves a copy of the current build under `name`. When another top-level team already has that name
   * (or `targetId` names the team to update), `mode` decides: 'overwrite' replaces that team's roster,
   * 'variation' adds the build to its folder. The build stays open in the builder; returns the id of
   * the saved team.
   */
  saveTeam: (name: string, mode: SaveMode, targetId?: string) => string;
  /** Duplicates `id` (or its group) and nests the copy as a variation under the same group. */
  addVariation: (id: string) => string;
  deleteTeam: (id: string) => void;
  addTeams: (teams: Team[], activate?: boolean) => void;
  /** Copies a shared team (and, for a folder, its variations) into the player's own teams. Returns the copy's id. */
  copySharedToMine: (id: string) => string;
  /** Cloud sync: write merged teams and remove deleted ones, keeping each team's own `updatedAt`. */
  applySynced: (upserts: Team[], deletes: string[]) => void;

  // slots — take an explicit team id (not just the active team) so the same slot editor can drive
  // more than one team on screen at once (the Matches tab's Your Team / Enemy Team builders).
  setActiveSlot: (i: number) => void;
  setSlot: (id: string, i: number, set: PokemonSet | null) => void;
  updateSet: (id: string, i: number, patch: Partial<PokemonSet>) => void;
  setMove: (id: string, i: number, moveIndex: number, moveId: string) => void;
  setSpread: (id: string, i: number, kind: 'sp' | 'evs' | 'ivs', stat: StatId, value: number) => void;
  resetSpread: (id: string, i: number, kind: 'sp' | 'evs') => void;
  moveSlot: (id: string, from: number, to: number) => void;
  /** Empties a team's six slots in place (keeps its format/category/name). No-op if already empty. */
  clearTeam: (id: string) => void;
  /** Puts back a roster (the Undo of clearTeam). */
  restoreSlots: (id: string, slots: TeamSlots) => void;

  setTheme: (t: Theme) => void;
  setView: (v: View) => void;
  /** Go to a route: a view, or an Analyse tab. */
  setRoute: (r: Route) => void;
  /** Open Analyse on a tab (the OHKO tab on one of its two lists). */
  openAnalyse: (tab: AnalyseTab, ohko?: OhkoMode) => void;
  setBattle: (uid: string, state: SlotBattleState) => void;
}


export type SaveMode = 'new' | 'overwrite' | 'variation';

/** The other top-level team (not the open one, not view-only) that already goes by `name`, if any. */
export function findTeamByName(s: Pick<TeamState, 'teams' | 'order' | 'activeTeamId'>, name: string): Team | undefined {
  const key = name.trim().toLowerCase();
  if (!key) return undefined;
  return s.order.map((id) => s.teams[id]).find((t) => t && t.id !== s.activeTeamId && !t.groupId && !isLocked(t) && t.name.trim().toLowerCase() === key);
}

/** The saved team the open draft was loaded from or last saved into, if that still applies. */
export function editingTeam(s: Pick<TeamState, 'teams' | 'editingFrom' | 'editingDraft' | 'activeTeamId'>): Team | undefined {
  return s.editingFrom && s.editingDraft === s.activeTeamId ? s.teams[s.editingFrom] : undefined;
}

/** A team someone else shared read-only: it can be opened and copied, never changed. */
export const isLocked = (t: Team | undefined): boolean => !!t?.shared && t.shared.role !== 'edit';

let lastLockedToast = 0;
/** Tells the player why nothing happened (at most every couple of seconds, since a slider fires many changes). */
function lockedNotice() {
  const now = Date.now();
  if (now - lastLockedToast < 2500) return;
  lastLockedToast = now;
  toast('This team was shared with you to view only. Use “Make my own copy” to change it.');
}

const firstTeam = createTeam(getFormat(DEFAULT_FORMAT_ID), 'My Champions Team');

/** Where the pre-v3 save is copied before the v3 migration rewrites it (see migrateTeamState). */
export const TEAM_BACKUP_V2_KEY = 'ptb:v1:backup-v2';

/**
 * v1 stored teams as a flat list. v2 added optional `groupId`/`variationLabel` for folder-style
 * grouping; a flat v1 team has neither, which already reads as a top-level group with no
 * variations — `mergeTeamState` below (re)normalises `order` and drops any dangling `groupId`.
 *
 * v3: Terastallization exists only in Scarlet/Violet. Tera Types saved on teams of any other game
 * (Champions teams got one by default) are removed, per roster, against that roster's own format.
 * The untouched v1/v2 state is copied to TEAM_BACKUP_V2_KEY first, once, so it can be recovered.
 */
export function migrateTeamState(persisted: unknown, version: number): TeamState {
  const p = (persisted ?? {}) as Partial<TeamState>;
  if (version < 3 && p.teams && typeof p.teams === 'object') {
    if (safeStorage.getItem(TEAM_BACKUP_V2_KEY) === null) {
      safeStorage.setItem(TEAM_BACKUP_V2_KEY, JSON.stringify({ version, backedUpAt: new Date().toISOString(), state: persisted }));
    }
    const teams: Record<string, unknown> = {};
    for (const [id, raw] of Object.entries(p.teams)) {
      const t = sanitizeTeam(raw);
      teams[id] = t ? enforceCapabilities(t) : raw;
    }
    return { ...p, teams } as TeamState;
  }
  return persisted as TeamState;
}

// Stored state may be stale or corrupted: never let it leave the app without a valid active team.
export function mergeTeamState(persisted: unknown, current: TeamState): TeamState {
  const p = (persisted ?? {}) as Partial<TeamState>;
  const teams: Record<string, Team> = {};
  for (const raw of Object.values(p.teams && typeof p.teams === 'object' ? p.teams : {})) {
    const t = sanitizeTeam(raw);
    if (t) teams[t.id] = enforceCapabilities(t);
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
      if (!liveUids.has(uid) || !b || typeof b !== 'object' || !b.side || !b.field) continue;
      // Pre-0.12 saves: the "Mega Evolved" toggle was side.mega (boolean), now side.megaMode.
      const side = b.side as SideConditions & { mega?: boolean };
      battle[uid] = side.megaMode ? b : { ...b, side: { ...side, megaMode: side.mega ? 'both' : 'base' } };
    }
  }
  const topLevelIds = ids.filter((id) => !teams[id].groupId);
  let order = [...new Set([...(Array.isArray(p.order) ? p.order : []), ...topLevelIds])].filter((id) => topLevelIds.includes(id));
  let activeTeamId = typeof p.activeTeamId === 'string' && Object.hasOwn(teams, p.activeTeamId) ? p.activeTeamId : order[0];
  let editingFrom = typeof p.editingFrom === 'string' && Object.hasOwn(teams, p.editingFrom) ? p.editingFrom : null;
  let editingDraft = typeof p.editingDraft === 'string' && Object.hasOwn(teams, p.editingDraft) ? p.editingDraft : null;
  // Before 0.21 the builder edited the open saved team in place. It now edits a scratch draft, so a
  // saved team that was left open becomes a draft copy of itself and stays as it was.
  const open = teams[activeTeamId];
  if (open && isSavedTeam(open) && !isLocked(open)) {
    const draft = cloneTeam(open, DEFAULT_TEAM_NAME);
    teams[draft.id] = draft;
    order = [draft.id, ...order];
    editingFrom = open.id;
    editingDraft = draft.id;
    activeTeamId = draft.id;
  }
  const saved = routeFromSaved(p.view);
  return {
    ...current,
    teams,
    order,
    editingFrom,
    editingDraft,
    activeTeamId,
    theme: p.theme === 'light' ? 'light' : 'dark',
    // A view saved by an older version may have moved into Analyse: it reopens on its tab.
    view: saved.view,
    analyseTab: saved.tab ?? DEFAULT_ANALYSE_TAB,
    ohkoMode: saved.ohko ?? DEFAULT_OHKO_MODE,
    battle,
  };
}

export const useTeamStore = create<TeamState>()(
  persist(
    (set, get) => {
      /**
       * Immutable update of any one team (by id) with updatedAt bump. Every slot edit goes through
       * here, so a mechanic the team's game doesn't have (Tera outside Scarlet/Violet) can't be set.
       */
      const mutateTeam = (id: string, fn: (t: Team) => Team) =>
        set((s) => {
          const t = s.teams[id];
          if (!t) return s;
          if (isLocked(t)) {
            lockedNotice();
            return s;
          }
          return { teams: { ...s.teams, [t.id]: { ...enforceCapabilities(fn(t)), updatedAt: Date.now() } } };
        });
      const mutateSlot = (id: string, i: number, fn: (p: PokemonSet) => PokemonSet) =>
        mutateTeam(id, (t) => {
          const cur = t.slots[i];
          if (!cur) return t;
          const slots = [...t.slots] as TeamSlots;
          slots[i] = fn(cur);
          return { ...t, slots };
        });

      /** The scratch draft takes `id`'s roster (a new draft when the open team is itself saved or shared). */
      const openForEdit = (id: string): string => {
        const s = get();
        const src = s.teams[id];
        if (!src) return id;
        if (isLocked(src)) {
          set({ activeTeamId: id, activeSlot: 0, editingFrom: null, editingDraft: null });
          return id;
        }
        const active = s.teams[s.activeTeamId];
        const reuse = active && active.id !== id && !isSavedTeam(active) ? active : undefined;
        const copy = cloneTeam(src, DEFAULT_TEAM_NAME);
        let draft: Team = copy;
        if (reuse) {
          draft = { ...reuse, formatId: copy.formatId, category: copy.category, notes: copy.notes, replicaCode: copy.replicaCode, slots: copy.slots, slotsByFormat: copy.slotsByFormat, updatedAt: Date.now() };
          if (reuse.slots.some(Boolean)) {
            const prev = { team: reuse, editingFrom: s.editingFrom, editingDraft: s.editingDraft };
            toast(`Loaded “${src.name}${src.variationLabel ? ` · ${src.variationLabel}` : ''}” into the builder.`, {
              label: 'Undo',
              run: () => set((cur) => (cur.teams[prev.team.id] ? { teams: { ...cur.teams, [prev.team.id]: prev.team }, editingFrom: prev.editingFrom, editingDraft: prev.editingDraft, activeTeamId: prev.team.id, activeSlot: 0 } : cur)),
            });
          }
        }
        set((cur) => ({
          teams: { ...cur.teams, [draft.id]: draft },
          order: cur.order.includes(draft.id) ? cur.order : [draft.id, ...cur.order],
          activeTeamId: draft.id,
          activeSlot: 0,
          editingFrom: id,
          editingDraft: draft.id,
        }));
        return draft.id;
      };

      return {
        teams: { [firstTeam.id]: firstTeam },
        order: [firstTeam.id],
        activeTeamId: firstTeam.id,
        activeSlot: 0,
        editingFrom: null,
        editingDraft: null,
        theme: 'dark',
        view: 'builder',
        analyseTab: DEFAULT_ANALYSE_TAB,
        ohkoMode: DEFAULT_OHKO_MODE,
        battle: {},

        newTeam: (formatId = DEFAULT_FORMAT_ID) => {
          const t = createTeam(getFormat(formatId));
          set((s) => ({ teams: { ...s.teams, [t.id]: t }, order: [t.id, ...s.order], activeTeamId: t.id, activeSlot: 0 }));
          return t.id;
        },
        selectTeam: (id) => get().teams[id] && set({ activeTeamId: id, activeSlot: 0 }),
        editTeam: (id) => openForEdit(id),
        updateTeam: (id, patch) =>
          set((s) => (isLocked(s.teams[id]) ? (lockedNotice(), s) : s.teams[id] ? { teams: { ...s.teams, [id]: { ...s.teams[id], ...patch, updatedAt: Date.now() } } } : s)),
        switchFormat: (id, formatId) =>
          set((s) => {
            const t = s.teams[id];
            if (!t || t.formatId === formatId) return s;
            if (isLocked(t)) {
              lockedNotice();
              return s;
            }
            const slotsByFormat = { ...t.slotsByFormat, [t.formatId]: t.slots };
            const slots = slotsByFormat[formatId] ?? emptySlots();
            return {
              teams: { ...s.teams, [id]: enforceCapabilities({ ...t, formatId, category: getFormat(formatId).shortName, slots, slotsByFormat, updatedAt: Date.now() }) },
              ...(id === s.activeTeamId ? { activeSlot: 0 } : {}),
            };
          }),
        duplicateTeam: (id) => {
          const src = get().teams[id];
          if (!src) return id;
          const t = cloneTeam(src); // always a new top-level group, even if `src` was a variation
          set((s) => ({ teams: { ...s.teams, [t.id]: t }, order: [t.id, ...s.order] }));
          openForEdit(t.id);
          return t.id;
        },
        saveAsNew: (name) => {
          const src = get().teams[get().activeTeamId];
          if (!src) return get().activeTeamId;
          const t = cloneTeam(src, name.trim() || src.name);
          // The build stays open as the draft; the saved copy only changes when you Save over it.
          set((s) => ({ teams: { ...s.teams, [t.id]: t }, order: [t.id, ...s.order], editingFrom: t.id, editingDraft: s.activeTeamId }));
          return t.id;
        },
        saveTeam: (name, mode, targetId) => {
          const state = get();
          const src = state.teams[state.activeTeamId];
          const target = targetId ? state.teams[targetId] : undefined;
          if (!src) return state.activeTeamId;
          // Saving the open team under its own name: it is already stored (edits save as you go).
          if (mode === 'new' && src.name.trim().toLowerCase() === name.trim().toLowerCase() && isSavedTeam(src)) return src.id;
          if (!target || target.id === src.id || isLocked(target) || mode === 'new') return get().saveAsNew(name);
          const copy = cloneTeam(src, target.name);
          if (mode === 'overwrite') {
            const next: Team = {
              ...target,
              name: target.groupId ? target.name : name.trim() || target.name,
              formatId: copy.formatId,
              category: copy.category,
              notes: copy.notes,
              replicaCode: copy.replicaCode,
              slots: copy.slots,
              slotsByFormat: copy.slotsByFormat,
              updatedAt: Date.now(),
            };
            set((s) => ({ teams: { ...s.teams, [target.id]: next }, editingFrom: target.id, editingDraft: s.activeTeamId }));
            return target.id;
          }
          const groupId = target.groupId ?? target.id;
          const siblings = Object.values(state.teams).filter((t) => t.groupId === groupId).length;
          const v: Team = { ...copy, groupId, variationLabel: `Variation ${siblings + 2}`, shared: target.shared };
          set((s) => ({ teams: { ...s.teams, [v.id]: v }, editingFrom: v.id, editingDraft: s.activeTeamId }));
          return v.id;
        },
        addVariation: (id) => {
          const src = get().teams[id];
          if (!src) return id;
          if (isLocked(src)) {
            lockedNotice();
            return id;
          }
          const groupId = src.groupId ?? src.id;
          const siblings = Object.values(get().teams).filter((t) => t.groupId === groupId).length;
          // A variation added to a folder shared with edit rights belongs to that folder (and syncs there).
          const t = { ...cloneTeam(src, src.name, { groupId, variationLabel: `Variation ${siblings + 2}` }), shared: src.shared };
          set((s) => ({ teams: { ...s.teams, [t.id]: t } }));
          openForEdit(t.id);
          return t.id;
        },
        deleteTeam: (id) =>
          set((s) => {
            const target = s.teams[id];
            if (!target) return s;
            // Someone else's folder can't be deleted from here (only a variation of one shared with edit rights).
            if (target.shared && (target.shared.role !== 'edit' || !target.groupId)) {
              toast('This team belongs to someone else. They can stop sharing it, or you can leave from Settings → Sync.');
              return s;
            }
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
        copySharedToMine: (id) => {
          const src = get().teams[id];
          if (!src) return id;
          const rootId = src.groupId ?? src.id;
          const root = get().teams[rootId] ?? src;
          const copy = cloneTeam(root, root.name);
          const members = Object.values(get().teams).filter((t) => t.groupId === rootId);
          const variations = members.map((v) => cloneTeam(v, v.name, { groupId: copy.id, variationLabel: v.variationLabel }));
          set((s) => {
            const teams = { ...s.teams, [copy.id]: copy };
            for (const v of variations) teams[v.id] = v;
            return { teams, order: [copy.id, ...s.order] };
          });
          openForEdit(src.groupId ? (variations[members.findIndex((m) => m.id === src.id)] ?? copy).id : copy.id);
          return copy.id;
        },
        applySynced: (upserts, deletes) =>
          set((s) => {
            const teams = { ...s.teams };
            for (const id of deletes) delete teams[id];
            for (const t of upserts) teams[t.id] = enforceCapabilities(t);
            // A variation whose folder is gone becomes a folder itself, rather than vanishing.
            for (const t of Object.values(teams)) if (t.groupId && !Object.hasOwn(teams, t.groupId)) teams[t.id] = { ...t, groupId: undefined };
            if (Object.keys(teams).length === 0) {
              const fresh = createTeam(getFormat(DEFAULT_FORMAT_ID), 'My Champions Team');
              teams[fresh.id] = fresh;
            }
            const topLevel = Object.keys(teams).filter((id) => !teams[id].groupId);
            const order = [...s.order.filter((id) => topLevel.includes(id)), ...topLevel.filter((id) => !s.order.includes(id))];
            const activeTeamId = Object.hasOwn(teams, s.activeTeamId) ? s.activeTeamId : order[0];
            return { teams, order, activeTeamId, activeSlot: activeTeamId === s.activeTeamId ? s.activeSlot : 0 };
          }),
        addTeams: (incoming, activate = true) => {
          let first: string | undefined;
          set((s) => {
            const teams = { ...s.teams };
            const idMap = new Map<string, string>(); // original incoming id -> id actually used, when remapped to avoid a collision
            const prepared = incoming.map((t) => ({ ...t, shared: undefined })).map((t) => {
              if (teams[t.id]) {
                const copy = cloneTeam(t, t.name, { groupId: t.groupId, variationLabel: t.variationLabel });
                idMap.set(t.id, copy.id);
                return copy;
              }
              return { ...t };
            }).map(enforceCapabilities);
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
            first = ids[0];
            return { teams, order: [...orderAdds, ...s.order.filter((x) => !orderAdds.includes(x))] };
          });
          // An imported team is saved as it came; the builder opens a draft copy so editing never alters it.
          if (activate && first) openForEdit(first);
        },

        setActiveSlot: (i) => set({ activeSlot: Math.max(0, Math.min(5, i)) }),
        setSlot: (id, i, p) =>
          mutateTeam(id, (t) => {
            const slots = [...t.slots] as TeamSlots;
            slots[i] = p;
            return { ...t, slots };
          }),
        updateSet: (id, i, patch) => mutateSlot(id, i, (p) => ({ ...p, ...patch })),
        setMove: (id, i, mi, moveId) =>
          mutateSlot(id, i, (p) => {
            const moves = [...p.moves] as PokemonSet['moves'];
            moves[mi] = moveId;
            return { ...p, moves };
          }),
        setSpread: (id, i, kind, stat, value) => {
          const team = get().teams[id];
          if (!team) return;
          const sys = getFormat(team.formatId).statSystem;
          mutateSlot(id, i, (p) => withSpreadValue(p, sys, kind, stat, value));
        },
        resetSpread: (id, i, kind) =>
          mutateSlot(id, i, (p) => ({ ...p, [kind]: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } })),
        moveSlot: (id, from, to) =>
          mutateTeam(id, (t) => {
            const slots = [...t.slots];
            const [x] = slots.splice(from, 1);
            slots.splice(to, 0, x);
            return { ...t, slots: slots as TeamSlots };
          }),
        clearTeam: (id) => {
          if (get().teams[id]?.slots.every((s) => s === null)) return;
          mutateTeam(id, (t) => ({ ...t, slots: emptySlots() }));
        },
        restoreSlots: (id, slots) => mutateTeam(id, (t) => ({ ...t, slots: [...slots] as TeamSlots })),

        setTheme: (theme) => set({ theme }),
        setView: (view) => set({ view }),
        setRoute: (r) => set({ view: r.view, ...(r.view === 'analyse' ? { analyseTab: r.tab ?? DEFAULT_ANALYSE_TAB, ...(r.tab === 'ohko' && r.ohko ? { ohkoMode: r.ohko } : {}) } : {}) }),
        openAnalyse: (analyseTab, ohko) => set({ view: 'analyse', analyseTab, ...(ohko ? { ohkoMode: ohko } : {}) }),
        setBattle: (uid, state) => set((s) => ({ battle: { ...s.battle, [uid]: state } })),
      };
    },
    {
      name: 'ptb:v1',
      version: 3,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ teams: s.teams, order: s.order, activeTeamId: s.activeTeamId, editingFrom: s.editingFrom, theme: s.theme, view: s.view, battle: s.battle }),
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
