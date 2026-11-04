import type { StateStorage } from 'zustand/middleware';
import { toast } from './toastStore';

/** What the player made (teams, matches, runs, game day): a failed write of these is told, once; caches and preferences are not worth a notice. */
const USER_DATA_KEYS = new Set(['ptb:v1', 'ptb:matches:v1', 'ptb:runs:v1', 'ptb:gameday:v1']);
let told = false;
const saveFailed = (key: string) => {
  if (told || !USER_DATA_KEYS.has(key)) return;
  told = true;
  toast('Couldn’t save on this device: the browser’s storage is full or blocked. Export a JSON backup (Import / Export) so nothing is lost.');
};
/** For tests. */
export const resetSaveNotice = () => {
  told = false;
};

/** localStorage that never throws (private mode, blocked storage, sandboxed previews). */
export const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      saveFailed(k);
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};
