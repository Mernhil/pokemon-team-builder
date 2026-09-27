import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from './ui/primitives';

type Update = import('@tauri-apps/plugin-updater').Update;

/** True only inside the Tauri desktop shell; false for the plain web/artifact build. */
const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Silent update check on launch, then a small dismissible banner offering to install it.
 * No-ops entirely outside the Tauri desktop build (dynamic imports never run in the browser).
 */
export function DesktopUpdater() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [status, setStatus] = useState<'idle' | 'downloading' | 'error'>('idle');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isDesktop()) return;
    import('@tauri-apps/plugin-updater')
      .then(({ check }) => check())
      .then((u) => setUpdate(u))
      .catch(() => {
        /* offline, or the update endpoint has nothing newer yet */
      });
  }, []);

  if (!update || dismissed) return null;

  const installAndRestart = async () => {
    setStatus('downloading');
    try {
      const [{ relaunch }] = await Promise.all([import('@tauri-apps/plugin-process'), update.downloadAndInstall()]);
      await relaunch();
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-4 py-2 text-sm">
      <Download size={14} className="shrink-0 text-accent" />
      <span className="flex-1">
        Update <b>v{update.version}</b> available (currently v{update.currentVersion}).
        {status === 'error' && <span className="ml-1.5 text-bad">Update failed — try again later.</span>}
      </span>
      <Button size="sm" variant="primary" onClick={installAndRestart} disabled={status === 'downloading'}>
        {status === 'downloading' ? 'Installing…' : 'Install & Restart'}
      </Button>
      <button type="button" aria-label="Dismiss" className="shrink-0 text-muted hover:text-fg" onClick={() => setDismissed(true)}>
        <X size={14} />
      </button>
    </div>
  );
}
