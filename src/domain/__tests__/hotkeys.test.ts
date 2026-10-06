import { describe, expect, it } from 'vitest';
import { GO_KEYS, ignoresHotkeys, nextHotkey } from '../hotkeys';
import { VIEWS } from '../routes';

describe('nextHotkey', () => {
  it('g then a letter goes to that screen', () => {
    const first = nextHotkey(false, 'g');
    expect(first).toEqual({ pendingG: true });
    expect(nextHotkey(first.pendingG, 'c')).toEqual({ action: { type: 'view', view: 'calc' }, pendingG: false });
    expect(nextHotkey(true, 'g').action).toEqual({ type: 'view', view: 'gameday' });
  });
  it('an unknown second key cancels the g', () => {
    expect(nextHotkey(true, 'z')).toEqual({ pendingG: false });
    expect(nextHotkey(true, '/')).toEqual({ pendingG: false });
  });
  it('/ opens the search and ? the list, and nothing else does anything', () => {
    expect(nextHotkey(false, '/').action).toEqual({ type: 'palette' });
    expect(nextHotkey(false, '?').action).toEqual({ type: 'help' });
    expect(nextHotkey(false, 'x')).toEqual({ pendingG: false });
  });
  it('every shortcut points at a real screen, once', () => {
    const views = Object.values(GO_KEYS);
    expect(new Set(views).size).toBe(views.length);
    for (const v of views) expect(VIEWS).toContain(v);
  });
});

describe('ignoresHotkeys', () => {
  it('leaves typing and dialogs alone', () => {
    expect(ignoresHotkeys({ tagName: 'INPUT' }, false)).toBe(true);
    expect(ignoresHotkeys({ tagName: 'TEXTAREA' }, false)).toBe(true);
    expect(ignoresHotkeys({ tagName: 'DIV', isContentEditable: true }, false)).toBe(true);
    expect(ignoresHotkeys({ tagName: 'DIV', getAttribute: () => 'combobox' }, false)).toBe(true);
    expect(ignoresHotkeys({ tagName: 'BUTTON' }, true)).toBe(true);
    expect(ignoresHotkeys({ tagName: 'BUTTON' }, false)).toBe(false);
    expect(ignoresHotkeys(null, false)).toBe(false);
  });
});
