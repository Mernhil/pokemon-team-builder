import { useEffect } from 'react';
import { AlertTriangle, Check, Download, RefreshCw, X } from 'lucide-react';
import { create } from 'zustand';
import { Button, cn } from './ui/primitives';

type Update = import('@tauri-apps/plugin-updater').Update;

/** True only inside the Tauri desktop shell; false for the plain web/artifact build. */
const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Background re-check interval while the app stays open. */
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

type Status = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error';

interface UpdaterState {
  status: Status;
  update: Update | null;
  error: string | null;
  /** The last check was started by the user: show its outcome (including errors) in the banner. */
  manual: boolean;
  dismissedVersion: string | null;
  check: (manual: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'Unknown error';

const useUpdater = create<UpdaterState>()((set, get) => ({
  status: 'idle',
  update: null,
  error: null,
  manual: false,
  dismissedVersion: null,

  check: async (manual) => {
    const { status } = get();
    if (status === 'checking' || status === 'installing') return;
    set({ status: 'checking', manual, error: null });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      set({ status: update ? 'available' : 'up-to-date', update });
    } catch (e) {
      // Offline, endpoint unreachable, bad signature… Never swallowed: a manual check shows it in the
      // banner, background checks leave a warning on the header button.
      set({ status: 'error', error: errorText(e) });
    }
  },

  install: async () => {
    const { update } = get();
    if (!update) return;
    set({ status: 'installing', manual: true, error: null });
    try {
      await update.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      set({ status: 'error', error: `Install failed: ${errorText(e)}` });
    }
  },

  dismiss: () => set((s) => ({ dismissedVersion: s.update?.version ?? null, manual: false })),
}));

/**
 * Update check on launch and every few hours, plus a banner offering to install. Outcomes of manual
 * checks (up to date / errors) show here too. No-ops entirely outside the Tauri desktop build.
 */
export function DesktopUpdater() {
  const { status, update, error, manual, dismissedVersion, check, install, dismiss } = useUpdater();

  useEffect(() => {
    if (!isDesktop()) return;
    void useUpdater.getState().check(false);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void useUpdater.getState().check(false);
    }, CHECK_EVERY_MS);
    return () => window.clearInterval(id);
  }, []);

  if (!isDesktop()) return null;

  const offer = update && update.version !== dismissedVersion && (status === 'available' || status === 'installing' || (status === 'error' && manual));
  const showResult = manual && !offer && (status === 'up-to-date' || status === 'error');
  if (!offer && !showResult) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b px-4 py-2 text-sm',
        status === 'error' ? 'border-bad/30 bg-bad/10' : 'border-accent/30 bg-accent/10',
      )}
      role="status"
    >
      {status === 'error' ? (
        <AlertTriangle size={14} className="shrink-0 text-bad" />
      ) : offer ? (
        <Download size={14} className="shrink-0 text-accent" />
      ) : (
        <Check size={14} className="shrink-0 text-good" />
      )}
      <span className="min-w-0 flex-1">
        {offer ? (
          <>
            Update <b>v{update.version}</b> available (currently v{update.currentVersion}).
          </>
        ) : status === 'up-to-date' ? (
          'You have the latest version.'
        ) : (
          'Could not check for updates.'
        )}
        {status === 'error' && <span className="ml-1.5 break-words text-bad">{error}</span>}
      </span>
      {offer && (
        <Button size="sm" variant="primary" onClick={install} disabled={status === 'installing'}>
          {status === 'installing' ? 'Installing…' : status === 'error' ? 'Retry install' : 'Install & Restart'}
        </Button>
      )}
      {!offer && status === 'error' && (
        <Button size="sm" onClick={() => check(true)}>
          Retry
        </Button>
      )}
      <button type="button" aria-label="Dismiss" className="shrink-0 text-muted hover:text-fg" onClick={dismiss}>
        <X size={14} />
      </button>
    </div>
  );
}

/** Header button (desktop only): check for updates now; flags a failed background check. */
export function UpdateCheckButton() {
  const { status, error, update, check } = useUpdater();
  if (!isDesktop()) return null;

  const title =
    status === 'checking'
      ? 'Checking for updates…'
      : status === 'error'
        ? `Last update check failed: ${error} (click to retry)`
        : status === 'available' && update
          ? `Update v${update.version} available`
          : 'Check for updates';

  return (
    <Button size="icon" variant="ghost" aria-label={title} title={title} onClick={() => check(true)} disabled={status === 'checking' || status === 'installing'}>
      <span className="relative">
        <RefreshCw size={16} className={cn(status === 'checking' && 'animate-spin')} />
        {(status === 'error' || status === 'available') && (
          <span className={cn('absolute -right-1 -top-1 h-2 w-2 rounded-full', status === 'error' ? 'bg-bad' : 'bg-accent')} />
        )}
      </span>
    </Button>
  );
}
