import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { safeStorage } from '@/store/storage';
import type { Match } from '@/domain/matches';
import type { Known } from '@/domain/sync';
import type { SharesResponse, ShareRole } from '@/domain/syncProtocol';

/** One folder someone shared with me, as last synced. */
export interface SharedFolder {
  owner: string;
  ownerName?: string;
  folderId: string;
  role: ShareRole;
  /** What was last synced in it (the base for merging my edits when I can edit). */
  known: Record<string, Known>;
}

/** A friend who shares their match log with me. Their matches are kept in memory only: fetched on each sync, never saved here. */
export interface SharedMatches {
  owner: string;
  name?: string;
  matches: Match[];
}

interface SharedStoreState {
  /** Keyed by `owner|folderId`. Persisted, so a sync after a restart knows what it already has. */
  folders: Record<string, SharedFolder>;
  friends: SharedMatches[];
  /** My own sharing settings, as the server last said (not persisted: fetched when Settings or the share dialog opens). */
  mine?: SharesResponse;
  /** Why the last attempt to change sharing failed. */
  error?: string;

  setFolders: (f: Record<string, SharedFolder>) => void;
  setFriends: (f: SharedMatches[]) => void;
  setMine: (m: SharesResponse | undefined) => void;
  setError: (e: string | undefined) => void;
  reset: () => void;
}

export const useSharedStore = create<SharedStoreState>()(
  persist(
    (set) => ({
      folders: {},
      friends: [],
      setFolders: (folders) => set({ folders }),
      setFriends: (friends) => set({ friends }),
      setMine: (mine) => set({ mine }),
      setError: (error) => set({ error }),
      reset: () => set({ folders: {}, friends: [], mine: undefined, error: undefined }),
    }),
    {
      name: 'ptb:shared:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ folders: s.folders }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as { folders?: Record<string, SharedFolder> };
        const folders: Record<string, SharedFolder> = {};
        for (const [k, f] of Object.entries(p.folders && typeof p.folders === 'object' ? p.folders : {})) {
          if (!f || typeof f.owner !== 'string' || typeof f.folderId !== 'string' || (f.role !== 'view' && f.role !== 'edit')) continue;
          const known: Record<string, Known> = {};
          if (f.known && typeof f.known === 'object') for (const [id, v] of Object.entries(f.known)) if (v && typeof v.updatedAt === 'number' && /^team:/.test(id)) known[id] = { updatedAt: v.updatedAt };
          folders[k] = { owner: f.owner, ownerName: typeof f.ownerName === 'string' ? f.ownerName : undefined, folderId: f.folderId, role: f.role, known };
        }
        return { ...current, folders };
      },
    },
  ),
);
