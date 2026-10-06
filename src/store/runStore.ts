import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createRun, defaultRules, sanitizeRun, type Run, type RunRules } from '@/domain/runs';
import { safeStorage } from './storage';

/** Playthroughs and Nuzlocke runs: several per game, one of them active per game. Persisted as 'ptb:runs:v1'. */
export interface RunState {
  runs: Record<string, Run>;
  /** Display order (newest first). */
  order: string[];
  /** The run shown on each game's Run page. */
  active: Record<string, string>;

  newRun: (game: string, name?: string, rules?: RunRules) => string;
  selectRun: (game: string, id: string) => void;
  /** Applies one of the pure run functions (domain/runs.ts) to a run. */
  update: (id: string, fn: (run: Run, now: number) => Run) => void;
  setRules: (id: string, rules: Partial<RunRules>) => void;
  rename: (id: string, name: string) => void;
  deleteRun: (id: string) => void;
}

/** v0 (never released, a flat list of runs under `runs`) → v1 (a record by id plus `order` and `active`). */
function migrateRunState(persisted: unknown, version: number): RunState {
  const p = (persisted ?? {}) as Partial<RunState> & { runs?: unknown };
  if (version < 1 && Array.isArray(p.runs)) {
    const runs: Record<string, unknown> = {};
    for (const raw of p.runs) {
      const r = sanitizeRun(raw);
      if (r) runs[r.id] = r;
    }
    return { ...p, runs, order: Object.keys(runs) } as unknown as RunState;
  }
  return persisted as RunState;
}

/** Whatever was stored, loaded through the sanitiser: never a broken run, a dangling `active`, or an order that misses a run. */
function mergeRunState(persisted: unknown, current: RunState): RunState {
  const p = (persisted ?? {}) as Partial<RunState>;
  const runs: Record<string, Run> = {};
  for (const raw of Object.values(p.runs && typeof p.runs === 'object' ? p.runs : {})) {
    const r = sanitizeRun(raw);
    if (r) runs[r.id] = r;
  }
  const order = [...new Set([...(Array.isArray(p.order) ? p.order : []), ...Object.keys(runs)])].filter((id) => runs[id]);
  const active: Record<string, string> = {};
  if (p.active && typeof p.active === 'object') for (const [game, id] of Object.entries(p.active)) if (typeof id === 'string' && runs[id]?.game === game) active[game] = id;
  return { ...current, runs, order, active };
}

export const useRunStore = create<RunState>()(
  persist(
    (set) => ({
      runs: {},
      order: [],
      active: {},
      newRun: (game, name, rules) => {
        const run = createRun({ game, name, rules: rules ?? defaultRules(true) });
        set((s) => ({ runs: { ...s.runs, [run.id]: run }, order: [run.id, ...s.order], active: { ...s.active, [game]: run.id } }));
        return run.id;
      },
      selectRun: (game, id) => set((s) => (s.runs[id]?.game === game ? { active: { ...s.active, [game]: id } } : s)),
      update: (id, fn) =>
        set((s) => {
          const run = s.runs[id];
          if (!run) return s;
          const next = fn(run, Date.now());
          return next === run ? s : { runs: { ...s.runs, [id]: next } };
        }),
      setRules: (id, rules) =>
        set((s) => (s.runs[id] ? { runs: { ...s.runs, [id]: { ...s.runs[id], rules: { ...s.runs[id].rules, ...rules }, updatedAt: Date.now() } } } : s)),
      rename: (id, name) => set((s) => (s.runs[id] && name.trim() ? { runs: { ...s.runs, [id]: { ...s.runs[id], name: name.trim().slice(0, 60), updatedAt: Date.now() } } } : s)),
      deleteRun: (id) =>
        set((s) => {
          const run = s.runs[id];
          if (!run) return s;
          const runs = { ...s.runs };
          delete runs[id];
          const active = { ...s.active };
          if (active[run.game] === id) {
            const other = s.order.find((o) => o !== id && runs[o]?.game === run.game);
            if (other) active[run.game] = other;
            else delete active[run.game];
          }
          return { runs, order: s.order.filter((o) => o !== id), active };
        }),
    }),
    {
      name: 'ptb:runs:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ runs: s.runs, order: s.order, active: s.active }),
      migrate: migrateRunState,
      merge: mergeRunState,
    },
  ),
);

/** The active run of a game, if any. */
export const useActiveRun = (game: string): Run | undefined => useRunStore((s) => (s.active[game] ? s.runs[s.active[game]] : undefined));
