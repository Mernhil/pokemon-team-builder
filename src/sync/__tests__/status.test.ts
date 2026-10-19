import { beforeEach, describe, expect, it } from 'vitest';
import { diagnosticsText, scrub } from '../diagnostics';
import { RECENT_MS, syncDot } from '../status';
import { useSyncStore } from '../syncStore';

const NOW = Date.UTC(2026, 9, 19, 12);

describe('the header dot', () => {
  it('green when recent, amber when old, never or offline, red for an error', () => {
    expect(syncDot({ lastSyncAt: NOW - 60_000 }, NOW)).toBe('good');
    expect(syncDot({ lastSyncAt: NOW - RECENT_MS - 1 }, NOW)).toBe('warn');
    expect(syncDot({}, NOW)).toBe('warn');
    expect(syncDot({ lastSyncAt: NOW, lastErrorKind: 'offline' }, NOW)).toBe('warn');
    for (const kind of ['signin', 'setup', 'other'] as const) expect(syncDot({ lastSyncAt: NOW, lastErrorKind: kind }, NOW)).toBe('bad');
  });
});

describe('diagnostics', () => {
  const input = { appVersion: '0.32.0', cursor: 42, knownDocs: 7, lastAttemptAt: NOW - 1000, lastSyncAt: NOW - 600_000, lastStats: { pulled: 3, pushed: 2, updated: 3, deleted: 0, conflicts: 0, changed: [] } };

  it('has the cursor, counts, times, last error with its HTTP status and the last run', () => {
    const text = diagnosticsText({ ...input, lastError: 'Your sign-in has expired. Tap Sign in again.', lastErrorKind: 'signin', lastErrorStatus: 401, server: 'Server ready', online: true }, NOW);
    expect(text).toContain('Cursor: 42');
    expect(text).toContain('Known documents: 7');
    expect(text).toContain('Last attempt: 2026-10-19T11:59:59.000Z');
    expect(text).toContain('pulled 3, applied 3, deleted 0, pushed 2');
    expect(text).toContain('(signin, HTTP 401)');
    expect(text).toContain('Server: Server ready');
    expect(diagnosticsText({ ...input, lastError: 'x', lastErrorKind: 'signin', lastErrorStatus: 0 }, NOW)).toContain('redirected to the sign-in page');
  });

  it('never carries an e-mail address or a device token', () => {
    const text = diagnosticsText({ ...input, lastError: 'denied for ash@example.com with ptbd_AbC-123_x', lastErrorKind: 'other', lastErrorStatus: 403 }, NOW);
    expect(text).not.toMatch(/@|ptbd_/);
    expect(scrub('write to me.name+tag@sub.example.org now')).toBe('write to [e-mail] now');
  });
});

describe('the sign-in banner state', () => {
  beforeEach(() => useSyncStore.setState({ enabled: true, lastError: undefined, lastErrorKind: undefined, lastErrorStatus: undefined, bannerDismissed: false }));

  it('keeps the kind and status, and stays dismissed through repeated sign-in failures', () => {
    const s = useSyncStore.getState();
    s.fail('Your sign-in has expired. Tap Sign in again.', 'signin', 401);
    expect(useSyncStore.getState()).toMatchObject({ lastErrorKind: 'signin', lastErrorStatus: 401, bannerDismissed: false });
    useSyncStore.getState().dismissBanner();
    useSyncStore.getState().begin();
    expect(useSyncStore.getState().lastErrorKind).toBe('signin'); // not cleared while the next try runs
    useSyncStore.getState().fail('Your sign-in has expired. Tap Sign in again.', 'signin', 401);
    expect(useSyncStore.getState().bannerDismissed).toBe(true);
  });

  it('comes back after a different failure or a success in between', () => {
    useSyncStore.getState().fail('x', 'signin', 401);
    useSyncStore.getState().dismissBanner();
    useSyncStore.getState().fail('down', 'offline');
    useSyncStore.getState().fail('x', 'signin', 401);
    expect(useSyncStore.getState().bannerDismissed).toBe(false);
    useSyncStore.getState().dismissBanner();
    useSyncStore.getState().succeed({ pulled: 0, pushed: 0, updated: 0, deleted: 0, conflicts: 0, changed: [] });
    expect(useSyncStore.getState()).toMatchObject({ lastErrorKind: undefined, bannerDismissed: false });
  });
});
