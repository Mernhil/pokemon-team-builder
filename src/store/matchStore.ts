import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { createMatch, enforceMatchCapabilities } from '@/domain/matches';
import type { LoggedMon, Match } from '@/domain/matches';
import { sanitizeMatch } from '@/domain/sanitize';

interface MatchState {
  matches: Record<string, Match>;
  /** Display order (most recent first), independent of `date` so manual re-ordering is possible later. */
  order: string[];
  /** Teams shown in the Matches tab's "Team Builder" (Your Team / Enemy Team), by id in teamStore. */
  scoutYourTeamId?: string;
  scoutEnemyTeamId?: string;

  addMatch: (date?: string) => string;
  updateMatch: (id: string, patch: Partial<Omit<Match, 'id' | 'createdAt'>>) => void;
  deleteMatch: (id: string) => void;
  /** The Undo of deleteMatch: puts the match back at its old place in the list (stamped now, so a sync that already saw the delete lets the restore win). */
  restoreMatch: (match: Match, index: number) => void;
  duplicateAsTemplate: (id: string, date?: string) => string;
  importMatches: (matches: Match[]) => void;
  /** Cloud sync: write merged matches and remove deleted ones, keeping each match's own `updatedAt`. */
  applySynced: (upserts: Match[], deletes: string[]) => void;
  setScoutYourTeam: (id: string | undefined) => void;
  setScoutEnemyTeam: (id: string | undefined) => void;
}

/** Where the pre-v2 match log is copied before the v2 migration rewrites it. */
export const MATCH_BACKUP_V1_KEY = 'ptb:matches:v1:backup-v1';

/**
 * v2: a revealed Tera Type is only kept on matches whose regulation's game has Terastallization
 * (Scarlet/Violet) — none of the Champions regulations do. The v1 log is copied to
 * MATCH_BACKUP_V1_KEY first, once.
 * v3: matches may record what each side brought and led (myBrought, myLeads, oppBrought, oppLeads).
 * Purely additive, so a v2 log needs no rewrite beyond being run through the sanitiser (which
 * validates the new fields); no backup is made.
 */
function migrateMatchState(persisted: unknown, version: number): MatchState {
  let p = (persisted ?? {}) as Partial<MatchState>;
  if (version < 2 && p.matches && typeof p.matches === 'object') {
    if (safeStorage.getItem(MATCH_BACKUP_V1_KEY) === null) {
      safeStorage.setItem(MATCH_BACKUP_V1_KEY, JSON.stringify({ version, backedUpAt: new Date().toISOString(), state: persisted }));
    }
    const matches: Record<string, unknown> = {};
    for (const [id, raw] of Object.entries(p.matches)) {
      const m = sanitizeMatch(raw);
      matches[id] = m ? enforceMatchCapabilities(m) : raw;
    }
    p = { ...p, matches } as Partial<MatchState>;
  }
  if (version < 3 && p.matches && typeof p.matches === 'object') {
    const matches: Record<string, unknown> = {};
    for (const [id, raw] of Object.entries(p.matches)) matches[id] = sanitizeMatch(raw) ?? raw;
    p = { ...p, matches } as Partial<MatchState>;
  }
  return p as MatchState;
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
        set((s) => (s.matches[id] ? { matches: { ...s.matches, [id]: enforceMatchCapabilities({ ...s.matches[id], ...patch, updatedAt: Date.now() }) } } : s)),
      deleteMatch: (id) =>
        set((s) => {
          const matches = { ...s.matches };
          delete matches[id];
          return { matches, order: s.order.filter((x) => x !== id) };
        }),
      restoreMatch: (match, index) =>
        set((s) => {
          if (s.matches[match.id]) return s;
          const order = s.order.filter((x) => x !== match.id);
          order.splice(Math.min(Math.max(index, 0), order.length), 0, match.id);
          return { matches: { ...s.matches, [match.id]: { ...match, updatedAt: Date.now() } }, order };
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
          m.myBrought = src.myBrought && [...src.myBrought];
          m.myLeads = src.myLeads && [...src.myLeads];
          m.category = src.category;
        }
        const clean = enforceMatchCapabilities(m);
        set((s) => ({ matches: { ...s.matches, [clean.id]: clean }, order: [clean.id, ...s.order] }));
        return clean.id;
      },
      applySynced: (upserts, deletes) =>
        set((s) => {
          const matches = { ...s.matches };
          for (const id of deletes) delete matches[id];
          const added: string[] = [];
          for (const m of upserts) {
            if (!matches[m.id]) added.push(m.id);
            matches[m.id] = enforceMatchCapabilities(m);
          }
          return { matches, order: [...added, ...s.order.filter((id) => Object.hasOwn(matches, id))] };
        }),
      importMatches: (incoming) =>
        set((s) => {
          const matches = { ...s.matches };
          const ids: string[] = [];
          for (const m of incoming) {
            matches[m.id] = enforceMatchCapabilities(m);
            ids.push(m.id);
          }
          return { matches, order: [...ids, ...s.order.filter((x) => !ids.includes(x))] };
        }),
      setScoutYourTeam: (id) => set({ scoutYourTeamId: id }),
      setScoutEnemyTeam: (id) => set({ scoutEnemyTeamId: id }),
    }),
    {
      name: 'ptb:matches:v1',
      version: 3,
      storage: createJSONStorage(() => safeStorage),
      migrate: migrateMatchState,
      // Stored state may be stale or corrupted — never let a bad entry crash every reload.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<MatchState>;
        const matches: Record<string, Match> = {};
        for (const raw of Object.values(p.matches && typeof p.matches === 'object' ? p.matches : {})) {
          const m = sanitizeMatch(raw);
          if (m) matches[m.id] = enforceMatchCapabilities(m);
        }
        const ids = Object.keys(matches);
        const order = [...new Set([...(Array.isArray(p.order) ? p.order : []), ...ids])].filter((id) => Object.hasOwn(matches, id));
        return {
          ...current,
          matches,
          order,
          scoutYourTeamId: typeof p.scoutYourTeamId === 'string' ? p.scoutYourTeamId : undefined,
          scoutEnemyTeamId: typeof p.scoutEnemyTeamId === 'string' ? p.scoutEnemyTeamId : undefined,
        };
      },
    },
  ),
);

