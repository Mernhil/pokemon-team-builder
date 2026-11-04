import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_VIEW, sanitizeView, type ViewPrefs } from '@/domain/viewPrefs';
import { safeStorage } from './storage';

interface ViewState extends ViewPrefs {
  set: <K extends keyof ViewPrefs>(key: K, value: ViewPrefs[K]) => void;
}

/** Per-screen choices that survive a tab switch and a reload (`ptb:view:v1`); sanitised on load. */
export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      ...DEFAULT_VIEW,
      set: (key, value) => set((s) => ({ ...sanitizeView({ ...s, [key]: value }) })),
    }),
    {
      name: 'ptb:view:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ threatCount: s.threatCount, threatField: s.threatField, metaTab: s.metaTab, metaPeriod: s.metaPeriod }) as unknown as ViewState,
      merge: (persisted, current) => ({ ...current, ...sanitizeView(persisted) }),
    },
  ),
);
