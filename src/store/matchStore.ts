import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { createMatch } from '@/domain/matches';
import type { LoggedMon, Match } from '@/domain/matches';
import { sanitizeMatch } from '@/domain/sanitize';

interface MatchState {
  matches: Record<string, Match>;
  /** Display order (most recent first), independent of `date` so manual re-ordering is possible later. */
  order: string[];

  addMatch: (date?: string) => string;
  updateMatch: (id: string, patch: Partial<Omit<Match, 'id' | 'createdAt'>>) => void;
  deleteMatch: (id: string) => void;
  duplicateAsTemplate: (id: string, date?: string) => string;
  importMatches: (matches: Match[]) => void;
}

export const useMatchStore = create<MatchState>()(
  persist(
    (set, get) => ({
      matches: {},
      order: [],

      addMatch: (date) => {
        const m = createMatch(date);
        set((s) => ({ matches: { ...s.matches, [m.id]: m }, order: [m.id, ...s.order] }));
        return m.id;
      },
      updateMatch: (id, patch) =>
        set((s) => (s.matches[id] ? { matches: { ...s.matches, [id]: { ...s.matches[id], ...patch, updatedAt: Date.now() } } } : s)),
      deleteMatch: (id) =>
        set((s) => {
          const matches = { ...s.matches };
          delete matches[id];
          return { matches, order: s.order.filter((x) => x !== id) };
        }),
      /** "Clone last opponent" / "match against a previous entry": start a new match preloaded from `id`. */
      duplicateAsTemplate: (id, date = new Date().toISOString().slice(0, 10)) => {
        const src = get().matches[id];
        const m = createMatch(date);
        if (src) {
          m.opponentTeam = src.opponentTeam.map((x: LoggedMon) => ({ ...x, moves: x.moves ? [...x.moves] : undefined }));
          m.opponentArchetype = src.opponentArchetype;
          m.myTeamId = src.myTeamId;
          m.myTeam = src.myTeam?.map((x) => ({ ...x }));
          m.myArchetype = src.myArchetype;
          m.category = src.category;
        }
        set((s) => ({ matches: { ...s.matches, [m.id]: m }, order: [m.id, ...s.order] }));
        return m.id;
      },
      importMatches: (incoming) =>
        set((s) => {
          const matches = { ...s.matches };
          const ids: string[] = [];
          for (const m of incoming) {
            matches[m.id] = m;
            ids.push(m.id);
          }
          return { matches, order: [...ids, ...s.order.filter((x) => !ids.includes(x))] };
        }),
    }),
    {
      name: 'ptb:matches:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      // Stored state may be stale or corrupted — never let a bad entry crash every reload.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<MatchState>;
        const matches: Record<string, Match> = {};
        for (const raw of Object.values(p.matches && typeof p.matches === 'object' ? p.matches : {})) {
          const m = sanitizeMatch(raw);
          if (m) matches[m.id] = m;
        }
        const ids = Object.keys(matches);
        const order = [...new Set([...(Array.isArray(p.order) ? p.order : []), ...ids])].filter((id) => Object.hasOwn(matches, id));
        return { ...current, matches, order };
      },
    },
  ),
);

