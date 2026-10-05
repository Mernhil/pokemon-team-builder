import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from './storage';
import { PICKER_ORDER, pushRecent, type PickerKey, type PickerPrefs } from '@/domain/pickerOrder';

export type ListMode = 'grouped' | 'az';

interface PrefsState {
  /** Most recent first, per picker. Ids from every game; each list is filtered to the game shown. */
  recent: Partial<Record<PickerKey, string[]>>;
  favorites: Partial<Record<PickerKey, string[]>>;
  /** Item and move pickers: curated groups or plain A–Z. */
  listMode: Partial<Record<'items' | 'moves', ListMode>>;
  /** Champions: list species outside the selected regulation, greyed out. */
  showUnavailableSpecies: boolean;
  /** The app version whose "What's new" has been shown (or dismissed); absent on a first install. */
  lastSeenVersion?: string;

  addRecent: (key: PickerKey, id: string) => void;
  toggleFavorite: (key: PickerKey, id: string) => void;
  setListMode: (key: 'items' | 'moves', mode: ListMode) => void;
  setShowUnavailableSpecies: (on: boolean) => void;
  setLastSeenVersion: (version: string) => void;
}

const KEYS: PickerKey[] = ['items', 'moves', 'species', 'natures'];
/** Enough for any real use; keeps a corrupted or hand-edited save from growing unbounded. */
const MAX_FAVORITES = 100;

const idList = (v: unknown, cap: number): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && /^[a-z0-9]{1,64}$/i.test(x)))].slice(0, cap) : [];

const perKey = (v: unknown, cap: number): Partial<Record<PickerKey, string[]>> => {
  const src = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return Object.fromEntries(KEYS.map((k) => [k, idList(src[k], cap)]));
};

/**
 * Picker preferences (recents, favorites, list modes). Kept apart from teams (`ptb:v1`) so it
 * can never touch saved teams, and sanitised on load like every other store.
 */
export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      recent: {},
      favorites: {},
      listMode: {},
      showUnavailableSpecies: PICKER_ORDER.species.showUnavailableByDefault,

      addRecent: (key, id) =>
        set((s) => ({
          recent: { ...s.recent, [key]: pushRecent(s.recent[key] ?? [], id, key === 'natures' ? PICKER_ORDER.natureRecentsCap : PICKER_ORDER.recentsCap) },
        })),
      toggleFavorite: (key, id) =>
        set((s) => {
          const cur = s.favorites[key] ?? [];
          const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur].slice(0, MAX_FAVORITES);
          return { favorites: { ...s.favorites, [key]: next } };
        }),
      setListMode: (key, mode) => set((s) => ({ listMode: { ...s.listMode, [key]: mode } })),
      setShowUnavailableSpecies: (showUnavailableSpecies) => set({ showUnavailableSpecies }),
      setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
    }),
    {
      name: 'ptb:prefs:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ recent: s.recent, favorites: s.favorites, listMode: s.listMode, showUnavailableSpecies: s.showUnavailableSpecies, lastSeenVersion: s.lastSeenVersion }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PrefsState>;
        const mode = (v: unknown): ListMode | undefined => (v === 'az' || v === 'grouped' ? v : undefined);
        const lm = p.listMode && typeof p.listMode === 'object' ? p.listMode : {};
        return {
          ...current,
          recent: perKey(p.recent, PICKER_ORDER.recentsCap),
          favorites: perKey(p.favorites, MAX_FAVORITES),
          listMode: { items: mode(lm.items), moves: mode(lm.moves) },
          showUnavailableSpecies: typeof p.showUnavailableSpecies === 'boolean' ? p.showUnavailableSpecies : current.showUnavailableSpecies,
          lastSeenVersion: typeof p.lastSeenVersion === 'string' && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(p.lastSeenVersion) ? p.lastSeenVersion : undefined,
        };
      },
    },
  ),
);

const EMPTY: string[] = [];

/** Recents + favorites for one picker (stable references, for memo dependencies). */
export function usePickerPrefs(key: PickerKey): PickerPrefs {
  const favorites = usePrefsStore((s) => s.favorites[key] ?? EMPTY);
  const recent = usePrefsStore((s) => s.recent[key] ?? EMPTY);
  return { favorites, recent };
}
