import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  /** Optional one-tap action, e.g. Undo. */
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, action?: Toast['action']) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
/** Long enough to read and reach Undo; toasts with an action stay while hovered or focused. */
export const TOAST_MS = 7000;
const MAX_TOASTS = 3;

/** Transient notices (not persisted). */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (message, action) => {
    const id = nextId++;
    set((s) => {
      const list = [...s.toasts, { id, message, action }];
      // Room for three: drop plain notices first so an Undo isn't pushed out by the next message.
      while (list.length > MAX_TOASTS) list.splice(Math.max(0, list.findIndex((t) => !t.action)), 1);
      return { toasts: list };
    });
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (message: string, action?: Toast['action']) => useToastStore.getState().show(message, action);
