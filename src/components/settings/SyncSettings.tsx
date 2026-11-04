import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { isDesktopApp, isStandalone, useDeviceStore } from '@/sync/deviceStore';
import { useAccountStore } from '@/sync/accountStore';
import { ago } from '@/domain/sharing';
import { healthLine, type HealthResponse } from '@/domain/syncHealth';
import { diagnosticsText, statusText } from '@/sync/diagnostics';
import { request, signInAgain } from '@/sync/http';
import { syncAvailable, useSyncStore } from '@/sync/syncStore';
import { syncNow } from '@/sync/runner';
import { useNow } from '@/sync/useNow';
import { toast } from '@/store/toastStore';
import { LinkDesktopFromHere, LinkThisDesktop, LinkThisPhone } from './LinkDevices';
import SharingSettings from './SharingSettings';
import { Button, Checkbox, Input, Label } from '../ui/primitives';

const when = (t?: number) => (t ? new Date(t).toLocaleString() : 'never');

/** What GET /api/health says, as one line (the phone/web app only: a linked desktop app has no such route). */
function useServerHealth(active: boolean, syncing: boolean): { ok: boolean; text: string } | undefined {
  const [line, setLine] = useState<{ ok: boolean; text: string }>();
  useEffect(() => {
    if (!active || syncing) return;
    let alive = true;
    request<HealthResponse>('GET', '/api/health').then(
      (h) => alive && setLine(healthLine(h)),
      () => alive && setLine(undefined), // offline or signed out: the sync error above says so
    );
    return () => {
      alive = false;
    };
  }, [active, syncing]);
  return line;
}

/** Settings → Sync: opt in to syncing teams and the match log through the account the app is signed in with. */
export default function SyncSettings() {
  const s = useSyncStore();
  const [confirmOff, setConfirmOff] = useState(false);
  const stats = s.lastStats;
  const desktop = isDesktopApp();
  const paired = useDeviceStore((d) => Boolean(d.token));
  const loggedIn = useAccountStore((a) => Boolean(a.token));
  const linked = paired || loggedIn;
  const phoneLinked = paired && !desktop;
  const standalone = isStandalone();
  const hasAccount = useAccountStore((a) => !!a.user || a.availability === 'on');
  const health = useServerHealth(s.enabled && !desktop && !phoneLinked && syncAvailable(), s.status === 'syncing');
  const known = Object.keys(s.known).length;
  const now = useNow(30_000);

  if (!syncAvailable()) {
    return <p className="text-sm text-muted">Sync is available in the web app, the installed phone app and the desktop app, not in this build.</p>;
  }
  // The desktop app syncs once it is logged in to the account (Settings → Account), or linked with a pairing code.
  if (desktop && !linked) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted">
          Log in to your account under <b>Account</b> above to keep your teams and match log the same on your phone and here. Nothing is sent until you do. (A pairing code from the phone still works too, for now.)
        </p>
        <LinkThisDesktop />
      </div>
    );
  }

  const toggle = (on: boolean) => {
    s.setEnabled(on);
    setConfirmOff(false);
    if (on) void syncNow();
  };

  return (
    <div className="space-y-3 text-sm">
      <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
        <Checkbox checked={s.enabled} onChange={(e) => (e.target.checked ? toggle(true) : setConfirmOff(true))} />
        <span className="font-semibold">Sync with my account</span>
      </label>
      <p className="text-muted">
        Keeps your teams (with their folders and variations) and your match log the same on every device you sign in on. Nothing else is synced: not the
        theme, preferences or the calculator. It still works offline and syncs when it can. If two devices change the same team, the older change is kept
        as a variation called “Conflict copy”, so nothing is lost.
      </p>

      {confirmOff && (
        <div role="alert" className="rounded-lg border border-border bg-surface-2 p-3">
          <p>Turning sync off keeps everything on this device as it is. It just stops sending and receiving changes.</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => toggle(false)}>
              Turn sync off
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmOff(false)}>
              Keep it on
            </Button>
          </div>
        </div>
      )}

      {desktop && paired && !loggedIn && <LinkThisDesktop />}
      {!desktop && !hasAccount && <LinkThisPhone expired={s.enabled && s.lastErrorKind === 'signin'} />}

      {s.enabled && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>This device is called</Label>
            <Input aria-label="Device name" value={s.deviceName} onChange={(e) => s.setDeviceName(e.target.value)} maxLength={40} className="max-w-xs" />
            <p className="text-xs text-muted">Used in “Conflict copy (name, date)”.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void syncNow()} disabled={s.status === 'syncing'}>
              <RefreshCw size={14} className={s.status === 'syncing' ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden /> {s.status === 'syncing' ? 'Syncing…' : 'Sync now'}
            </Button>
            <span role="status" className="text-muted">
              Last synced {s.lastSyncAt ? ago(s.lastSyncAt, now) : 'never'}
              {stats && s.lastSyncAt ? ` · ${stats.updated} received, ${stats.pushed} sent${stats.conflicts ? `, ${stats.conflicts} conflict ${stats.conflicts === 1 ? 'copy' : 'copies'}` : ''}` : ''}
            </span>
          </div>
          {s.lastError && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-bad/40 bg-bad/8 p-2 text-bad">
              <span className="min-w-0 flex-1">{s.lastError}</span>
              {/* The installed app never navigates to the Access login (iOS: separate cookies, a white page): it links with a code, below. */}
              {s.lastErrorKind === 'signin' && !desktop && !hasAccount && !phoneLinked && !standalone && (
                <Button size="sm" variant="primary" onClick={signInAgain}>
                  Sign in again
                </Button>
              )}
              {s.lastErrorKind === 'signin' && !desktop && !hasAccount && (phoneLinked || standalone) && <span className="text-xs">Link this phone with a code, above.</span>}
              {s.lastErrorKind === 'signin' && (desktop || hasAccount) && <span className="text-xs">Log in again under Account, above.</span>}
            </div>
          )}
          {health && (
            <p className={health.ok ? 'text-muted' : 'text-warn'} data-testid="server-health">
              {health.text}
            </p>
          )}
          <details className="rounded-lg border border-border p-2">
            <summary className="cursor-pointer font-semibold">Sync diagnostics</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">Cursor</dt>
              <dd>{s.cursor}</dd>
              <dt className="text-muted">Known documents</dt>
              <dd>{known}</dd>
              <dt className="text-muted">Last attempt</dt>
              <dd>{when(s.lastAttemptAt)}</dd>
              <dt className="text-muted">Last success</dt>
              <dd>{when(s.lastSyncAt)}</dd>
              <dt className="text-muted">Last run</dt>
              <dd>{stats ? `${stats.pulled} pulled, ${stats.updated} applied, ${stats.pushed} pushed` : 'none since the app started'}</dd>
              <dt className="text-muted">Last error</dt>
              <dd>{s.lastError ? `${s.lastError} (${s.lastErrorKind ?? 'other'}, ${statusText(s.lastErrorStatus)})` : 'none'}</dd>
            </dl>
            <Button
              size="sm"
              className="mt-2"
              onClick={() => {
                const text = diagnosticsText({ appVersion: __APP_VERSION__, cursor: s.cursor, knownDocs: known, lastAttemptAt: s.lastAttemptAt, lastSyncAt: s.lastSyncAt, lastError: s.lastError, lastErrorKind: s.lastErrorKind, lastErrorStatus: s.lastErrorStatus, lastStats: s.lastStats, server: health?.text, online: navigator.onLine });
                navigator.clipboard.writeText(text).then(
                  () => toast('Diagnostics copied.'),
                  () => toast('Could not copy. Select the text above instead.'),
                );
              }}
            >
              Copy diagnostics
            </Button>
          </details>
          {!desktop && !phoneLinked && <LinkDesktopFromHere />}
          <SharingSettings />
        </div>
      )}
    </div>
  );
}
