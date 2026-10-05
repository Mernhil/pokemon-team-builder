import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { useMatchStore } from './matchStore';
import {
  addOpponent,
  emptyGame,
  matchFromGame,
  removeOpponent,
  sanitizeGameDay,
  setReveal,
  undoOpponent,
  type Bring,
  type GameDayState,
  type Reveal,
} from '@/domain/gameday';
import type { BringLimits, MatchResult } from '@/domain/matches';
import type { Team } from '@/domain/types';

interface GameDayStore extends GameDayState {
  setTeam: (id: string | undefined) => void;
  add: (speciesId: string) => void;
  remove: (speciesId: string) => void;
  undo: () => void;
  reveal: (speciesId: string, reveal: Reveal) => void;
  choosePlan: (index: number) => void;
  /** What I brought and led, when changed from the plan's. */
  setBring: (bring: Bring | undefined) => void;
  setOppBring: (bring: Bring) => void;
  setNotes: (notes: string) => void;
  /** Throws the game in progress away and keeps my team: "Next game". */
  nextGame: () => void;
  /**
   * Logs the game as a match and starts the next one on the same team. Returns the new match's id.
   * The match gets what I brought and led (the chosen plan unless I changed it), what they showed,
   * "Ranked Ladder", the regulation, and `archetypes` when the caller worked some out.
   */
  logMatch: (o: { result: MatchResult; team: Team; plan?: Bring; regulationId?: string; limits: BringLimits; archetypes?: { myArchetype?: string; opponentArchetype?: string } }) => string;
}

const pick = (s: GameDayStore): GameDayState => ({ myTeamId: s.myTeamId, opponents: s.opponents, reveals: s.reveals, planIndex: s.planIndex, bring: s.bring, oppBring: s.oppBring, notes: s.notes });

/** v1: the first version. Anything saved is run through the sanitiser, so a damaged save loads as what is valid in it. */
export const migrateGameDay = (persisted: unknown): GameDayState => sanitizeGameDay(persisted);

export const useGameDayStore = create<GameDayStore>()(
  persist(
    (set, get) => ({
      ...emptyGame(),
      setTeam: (myTeamId) => set((s) => (s.myTeamId === myTeamId ? s : { ...emptyGame(myTeamId), notes: s.notes })),
      add: (id) => set((s) => addOpponent(pick(s), id)),
      remove: (id) => set((s) => removeOpponent(pick(s), id)),
      undo: () => set((s) => undoOpponent(pick(s))),
      reveal: (id, r) => set((s) => setReveal(pick(s), id, r)),
      choosePlan: (planIndex) => set({ planIndex, bring: undefined }),
      setBring: (bring) => set({ bring }),
      setOppBring: (oppBring) => set({ oppBring }),
      setNotes: (notes) => set({ notes: notes.slice(0, 500) }),
      nextGame: () => set((s) => emptyGame(s.myTeamId)),
      logMatch: ({ result, team, plan, regulationId, limits, archetypes }) => {
        const { addMatch, updateMatch } = useMatchStore.getState();
        const id = addMatch();
        updateMatch(id, { ...matchFromGame(pick(get()), { team, plan, regulationId, result, limits }), ...archetypes });
        set(emptyGame(get().myTeamId));
        return id;
      },
    }),
    {
      name: 'ptb:gameday:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => pick(s),
      migrate: (persisted) => migrateGameDay(persisted) as unknown as GameDayStore,
      merge: (persisted, current) => ({ ...current, ...sanitizeGameDay(persisted) }),
    },
  ),
);
