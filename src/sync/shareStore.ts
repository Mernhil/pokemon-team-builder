import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { sanitizeMatch } from '@/domain/sanitize';
import type { SharedMatch } from '@/domain/sharing';
import type { Known } from '@/domain/sync';
import type { ShareInfo, SharesResponse } from '@/domain/syncProtocol';
import { safeStorage } from '@/store/storage';

/**
 * What sharing looks like on this device: who I share with, what was shared with me, display
 * names, my friend's match log (a read-only copy) and the sync bookkeeping for shared teams (the
 * teams themselves live in the team store, marked `shared`). Kept apart from my own data.
 */
interface ShareState {
  me?: { email: string; displayName?: string };
  granted: ShareInfo[];
  received: ShareInfo[];
  names: Record<string, string>;
  /** The other person's matches shared with me, newest first. */
  matches: SharedMatch[];
  /** For each shared team last synced, the `updatedAt` of that version. */
  known: Record<string, Known>;
  setShares: (r: SharesResponse) => void;
  setNames: (names: Record<string, string>) => void;
  setMatches: (m: SharedMatch[]) => void;
  saveKnown: (known: Record<string, Known>) => void;
  /** Forget everything about sharing on this device (my own teams and matches are untouched). */
  clear: () => void;
}

export const useShareStore = create<ShareState>()(
  persist(
    (set) => ({
      granted: [],
      received: [],
      names: {},
      matches: [],
      known: {},
      setShares: (r) => set({ me: r.me, granted: r.granted, received: r.received, names: r.names }),
      setNames: (names) => set((s) => ({ names: { ...s.names, ...names } })),
      setMatches: (matches) => set({ matches }),
      saveKnown: (known) => set({ known }),
      clear: () => set({ me: undefined, granted: [], received: [], names: {}, matches: [], known: {} }),
    }),
    {
      name: 'ptb:shares:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ me: s.me, granted: s.granted, received: s.received, names: s.names, matches: s.matches, known: s.known }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ShareState>;
        const matches: SharedMatch[] = [];
        for (const raw of Array.isArray(p.matches) ? p.matches : []) {
          const m = sanitizeMatch(raw);
          const owner = (raw as { owner?: unknown })?.owner;
          if (m && typeof owner === 'string') matches.push({ ...m, owner });
        }
        const known: ShareState['known'] = {};
        if (p.known && typeof p.known === 'object') for (const [k, v] of Object.entries(p.known)) if (v && typeof v.updatedAt === 'number' && k.startsWith('team:')) known[k] = { updatedAt: v.updatedAt };
        const list = (v: unknown): ShareInfo[] => (Array.isArray(v) ? v.filter((s): s is ShareInfo => !!s && typeof s.owner === 'string' && typeof s.grantee === 'string' && typeof s.ref === 'string') : []);
        return {
          ...current,
          me: p.me && typeof p.me.email === 'string' ? { email: p.me.email, displayName: typeof p.me.displayName === 'string' ? p.me.displayName : undefined } : undefined,
          granted: list(p.granted),
          received: list(p.received),
          names: p.names && typeof p.names === 'object' ? Object.fromEntries(Object.entries(p.names).filter(([, v]) => typeof v === 'string')) : {},
          matches,
          known,
        };
      },
    },
  ),
);

/** My display name (set in Settings), or undefined. */
export const useMyName = () => useShareStore((s) => s.me?.displayName);
