import { X } from 'lucide-react';
import { useNow } from '@/sync/useNow';
import { SIGNIN_MESSAGE, signInAgain } from '@/sync/http';
import { DOT_LABEL, syncDot, type SyncDot } from '@/sync/status';
import { isDesktopApp } from '@/sync/deviceStore';
import { useAccountStore } from '@/sync/accountStore';
import { syncAvailable, useSyncStore } from '@/sync/syncStore';
import { Button } from '../ui/primitives';
import { buttonClass, cn } from '../ui/styles';

const DOT_CLASS: Record<SyncDot, string> = { good: 'bg-good', warn: 'bg-warn', bad: 'bg-bad' };

/**
 * At the very top of the app: a sign-in that has expired is said here, not only in Settings. When this device's
 * account session ended, "Sign in again" opens the login dialog in place (no navigation). A Cloudflare Access session
 * that expired is renewed inside the app's own window (src/sync/http.ts); the desktop app is re-linked in Settings.
 */
export function SyncBanner({ onOpenSyncSettings, onOpenLogin }: { onOpenSyncSettings: () => void; onOpenLogin: () => void }) {
  const accountEnded = useAccountStore((s) => !!s.user && s.expired && !s.bannerDismissed);
  const dismissAccount = useAccountStore((s) => s.dismissBanner);
  const show = useSyncStore((s) => s.enabled && s.lastErrorKind === 'signin' && !s.bannerDismissed);
  const dismiss = useSyncStore((s) => s.dismissBanner);
  const status = useSyncStore((s) => s.lastErrorStatus);
  const accountKnown = useAccountStore((s) => !!s.user || s.availability === 'on');
  if (accountEnded && syncAvailable()) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-bad/40 bg-bad/8 px-3 py-2 text-sm sm:px-4">
        <span className="min-w-0 flex-1 font-semibold text-bad">{SIGNIN_MESSAGE}</span>
        <Button variant="primary" size="sm" onClick={onOpenLogin}>
          Sign in again
        </Button>
        <button type="button" className={buttonClass('ghost', 'icon-sm')} aria-label="Dismiss" onClick={dismissAccount}>
          <X size={15} aria-hidden />
        </button>
      </div>
    );
  }
  if (!show || !syncAvailable()) return null;
  const desktop = isDesktopApp();
  // Which sign-in ended: Cloudflare Access (a redirect to its login, status 0) is renewed in the app's window; the
  // account's is the login dialog; a desktop app with only a pairing link goes to Settings.
  const viaAccount = accountKnown && status !== 0;
  const action = viaAccount ? onOpenLogin : desktop ? onOpenSyncSettings : signInAgain;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-bad/40 bg-bad/8 px-3 py-2 text-sm sm:px-4">
      <span className="min-w-0 flex-1 font-semibold text-bad">{desktop && !viaAccount ? 'This desktop app is signed out. Log in again in Settings → Account.' : SIGNIN_MESSAGE}</span>
      <Button variant="primary" size="sm" onClick={action}>
        {desktop && !viaAccount ? 'Open Settings' : 'Sign in again'}
      </Button>
      <button type="button" className={buttonClass('ghost', 'icon-sm')} aria-label="Dismiss" onClick={dismiss}>
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}

/** The header's small sync light (green recent, amber old or offline, red error), and a "Sync problem" chip for errors that are not about signing in. */
export function SyncStatus({ onOpen }: { onOpen: () => void }) {
  const enabled = useSyncStore((s) => s.enabled);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const lastErrorKind = useSyncStore((s) => s.lastErrorKind);
  const now = useNow(30_000);
  if (!enabled || !syncAvailable()) return null;
  const dot = syncDot({ lastSyncAt, lastErrorKind }, now);
  const chip = lastErrorKind === 'other' || lastErrorKind === 'setup';
  return (
    <button type="button" className={buttonClass('default', chip ? 'md' : 'icon', 'gap-1.5')} onClick={onOpen} aria-label={chip ? 'Sync problem' : `Sync status: ${DOT_LABEL[dot].toLowerCase()}`} title={`${DOT_LABEL[dot]} · open Sync settings`}>
      <span aria-hidden className={cn('size-2.5 shrink-0 rounded-full', DOT_CLASS[dot])} />
      {chip && <span className="text-xs font-semibold">Sync problem</span>}
    </button>
  );
}
