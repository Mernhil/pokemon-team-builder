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

/** Transient notices (not persisted). */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (message, action) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, action }] }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (message: string, action?: Toast['action']) => useToastStore.getState().show(message, action);
