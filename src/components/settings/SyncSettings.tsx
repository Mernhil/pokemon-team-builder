import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { isDesktopApp, useDeviceStore } from '@/sync/deviceStore';
import { syncAvailable, useSyncStore } from '@/sync/syncStore';
import { syncNow } from '@/sync/runner';
import { LinkDesktopFromHere, LinkThisDesktop } from './LinkDevices';
import SharingSettings from './SharingSettings';
import { Button, Checkbox, Input, Label } from '../ui/primitives';

const when = (t?: number) => (t ? new Date(t).toLocaleString() : 'never');

/** Settings → Sync: opt in to syncing teams and the match log through the account the app is signed in with. */
export default function SyncSettings() {
  const s = useSyncStore();
  const [confirmOff, setConfirmOff] = useState(false);
  const stats = s.lastStats;
  const desktop = isDesktopApp();
  const linked = useDeviceStore((d) => Boolean(d.token));

  if (!syncAvailable()) {
    return <p className="text-sm text-muted">Sync is available in the web app, the installed phone app and the desktop app, not in this build.</p>;
  }
  // The desktop app syncs once it is linked to an account with a pairing code.
  if (desktop && !linked) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-muted">Link this desktop app to your account to keep your teams and match log the same on your phone and here. Nothing is sent until you do.</p>
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

      {desktop && <LinkThisDesktop />}

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
              Last sync: {when(s.lastSyncAt)}
              {stats && s.lastSyncAt ? ` · ${stats.updated} received, ${stats.pushed} sent${stats.conflicts ? `, ${stats.conflicts} conflict ${stats.conflicts === 1 ? 'copy' : 'copies'}` : ''}` : ''}
            </span>
          </div>
          {s.lastError && (
            <p role="alert" className="rounded-lg border border-bad/40 bg-bad/8 p-2 text-bad">
              {s.lastError}
            </p>
          )}
          {!desktop && <LinkDesktopFromHere />}
          <SharingSettings />
        </div>
      )}
    </div>
  );
}
