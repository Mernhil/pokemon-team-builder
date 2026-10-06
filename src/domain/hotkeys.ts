/**
 * Single-key shortcuts: `g` then a letter goes to a screen, `/` opens the search (the command
 * palette), `?` lists them. Ctrl/⌘ K stays as it was. Pure: App.tsx listens, this decides.
 */
import type { View } from './routes.ts';

export const GO_KEYS: Record<string, View> = {
  b: 'builder',
  c: 'calc',
  a: 'analyse',
  d: 'dex',
  n: 'atlas',
  m: 'matches',
  g: 'gameday',
  e: 'meta',
  r: 'reverse',
  f: 'regdiff',
};

export type HotkeyAction = { type: 'view'; view: View } | { type: 'palette' } | { type: 'help' };

/** What a key does, given whether `g` was just pressed. */
export function nextHotkey(pendingG: boolean, key: string): { action?: HotkeyAction; pendingG: boolean } {
  if (pendingG) {
    const view = GO_KEYS[key.toLowerCase()];
    return view ? { action: { type: 'view', view }, pendingG: false } : { pendingG: false };
  }
  if (key === 'g') return { pendingG: true };
  if (key === '/') return { action: { type: 'palette' }, pendingG: false };
  if (key === '?') return { action: { type: 'help' }, pendingG: false };
  return { pendingG: false };
}

/** Keys typed into a field, or while something modal is open, belong to that and not to the shortcuts. */
export function ignoresHotkeys(target: { tagName?: string; isContentEditable?: boolean; getAttribute?: (name: string) => string | null } | null, dialogOpen: boolean): boolean {
  if (dialogOpen) return true;
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!target.isContentEditable || target.getAttribute?.('role') === 'combobox';
}
