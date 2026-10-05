import { useEffect, useState } from 'react';
import { Copy, Link2, Unlink } from 'lucide-react';
import { formatCode, parsePairingInput, type DeviceInfo } from '@/domain/pairing';
import { useDeviceStore } from '@/sync/deviceStore';
import { linkThisDevice, loadDevices, pairingLink, requestPairCode, revokeLinkedDevice, unlinkThisDevice } from '@/sync/pairing';
import { useSyncStore } from '@/sync/syncStore';
import { syncNow } from '@/sync/runner';
import { Button, Input, Label } from './ui/primitives';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const when = (t: number) => new Date(t).toLocaleString();

/** Settings → Sync on the web / phone app: make a one-time code for the desktop app, and see or remove linked desktops. */
export function LinkDesktopFromHere() {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void loadDevices().then((r) => setDevices(r.devices), () => undefined);
  }, []);
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [code]);

  const secondsLeft = code ? Math.max(0, Math.round((code.expiresAt - now) / 1000)) : 0;
  const live = code && secondsLeft > 0;

  const make = async () => {
    setError('');
    setCopied(false);
    try {
      setCode(await requestPairCode());
      setNow(Date.now());
    } catch (e) {
      setError(message(e));
    }
  };
  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(pairingLink(code.code));
      setCopied(true);
    } catch {
      setError('Could not copy; type the code and address in by hand.');
    }
  };
  const remove = async (id: string) => {
    setError('');
    try {
      setDevices((await revokeLinkedDevice(id)).devices);
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <Label>Link a desktop app</Label>
      <p className="text-muted">
        The desktop app can’t sign in with your account, so you pair it from here: make a one-time code, then enter it (or paste the copied link) in the desktop app under Settings → Sync.
      </p>
      <Button size="sm" onClick={() => void make()}>
        <Link2 size={14} aria-hidden /> {code ? 'Make a new code' : 'Make a pairing code'}
      </Button>
      {code && (
        <div className="space-y-1" role="status">
          {live ? (
            <>
              <p>
                <span className="select-all font-mono text-lg font-semibold tracking-widest">{formatCode(code.code)}</span>{' '}
                <span className="text-muted">
                  · server <span className="select-all">{location.origin}</span> · expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
                </span>
              </p>
              <Button size="sm" variant="ghost" onClick={() => void copy()}>
                <Copy size={14} aria-hidden /> {copied ? 'Copied' : 'Copy link (server and code)'}
              </Button>
            </>
          ) : (
            <p className="text-muted">That code has expired. Make a new one.</p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-bad">
          {error}
        </p>
      )}
      {devices.length > 0 && (
        <div className="space-y-1">
          <Label>Linked desktop apps</Label>
          <ul className="space-y-1">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.name}</span>
                <span className="text-xs text-muted">last used {when(d.lastSeenAt)}</span>
                <Button size="sm" variant="ghost" aria-label={`Unlink ${d.name}`} onClick={() => void remove(d.id)}>
                  <Unlink size={14} aria-hidden /> Unlink
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Settings → Sync in the desktop app: enter the server and the code from the phone/website. */
export function LinkThisDesktop() {
  const device = useDeviceStore();
  const deviceName = useSyncStore((s) => s.deviceName);
  const [server, setServer] = useState(device.server ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // A pasted "https://host/#pair=CODE" fills both fields.
  const onCode = (text: string) => {
    const parsed = parsePairingInput(text);
    if (parsed?.server) {
      setServer(parsed.server);
      setCode(formatCode(parsed.code));
    } else setCode(text);
  };
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await linkThisDevice(server, code, deviceName);
      setCode('');
      void syncNow();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (device.token) {
    return (
      <div className="space-y-2 rounded-lg border border-border p-3">
        <p>
          Linked to <b>{device.owner}</b> at <span className="select-all">{device.server}</span>. You can unlink it here or from the phone app’s Settings → Sync.
        </p>
        <Button size="sm" variant="ghost" onClick={() => void unlinkThisDevice()}>
          <Unlink size={14} aria-hidden /> Unlink this desktop app
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-2 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p>
        To sync this desktop app, open the phone or web app → Settings → Sync → <b>Make a pairing code</b>, then paste the copied link below, or type the server address and the code.
      </p>
      <div className="space-y-1">
        <Label>Code (or pasted link)</Label>
        <Input aria-label="Pairing code" value={code} onChange={(e) => onCode(e.target.value)} placeholder="ABCDE-FGHJK" autoComplete="off" spellCheck={false} className="max-w-xs font-mono" />
      </div>
      <div className="space-y-1">
        <Label>Server address</Label>
        <Input aria-label="Server address" value={server} onChange={(e) => setServer(e.target.value)} placeholder="https://pokemon-team-builder.yourname.workers.dev" autoComplete="off" spellCheck={false} className="max-w-md" />
      </div>
      <div className="space-y-1">
        <Label>This device is called</Label>
        <Input aria-label="Device name" value={deviceName} onChange={(e) => useSyncStore.getState().setDeviceName(e.target.value)} maxLength={40} className="max-w-xs" />
      </div>
      <Button type="submit" variant="primary" disabled={busy || !code || !server}>
        {busy ? 'Linking…' : 'Link this desktop app'}
      </Button>
      {error && (
        <p role="alert" className="text-bad">
          {error}
        </p>
      )}
    </form>
  );
}
