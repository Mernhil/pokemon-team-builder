import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSaveNotice, safeStorage } from '../storage';
import { useToastStore } from '../toastStore';

describe('safeStorage', () => {
  beforeEach(() => {
    resetSaveNotice();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  const full = () =>
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });

  it('never throws, and reads as empty when storage is blocked', () => {
    full();
    expect(safeStorage.getItem('ptb:v1')).toBeNull();
    expect(() => safeStorage.setItem('ptb:v1', 'x')).not.toThrow();
    expect(() => safeStorage.removeItem('ptb:v1')).not.toThrow();
  });

  it('tells the player once when their teams or matches could not be saved', () => {
    full();
    safeStorage.setItem('ptb:v1', 'x');
    safeStorage.setItem('ptb:matches:v1', 'x');
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toMatch(/Couldn’t save/);
  });

  it('stays quiet for caches and preferences', () => {
    full();
    for (const k of ['ptb:meta:v1', 'ptb:dex:v1', 'ptb:prefs:v1', 'ptb:view:v1']) safeStorage.setItem(k, 'x');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
