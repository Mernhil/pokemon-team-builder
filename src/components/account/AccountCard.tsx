import { UserPlus, X } from 'lucide-react';
import { useAccountStore } from '@/sync/accountStore';
import { Button } from '../ui/primitives';
import { buttonClass } from '../ui/styles';

/**
 * A one-time card at the top of the app once the server has accounts switched on, for a device with no account:
 * "Make an account to sync and share". Closing it (or making an account) hides it for good on this device.
 */
export function AccountCard({ onOpenAccount }: { onOpenAccount: () => void }) {
  const show = useAccountStore((s) => s.availability === 'on' && !s.user && !s.cardDismissed);
  const dismiss = useAccountStore((s) => s.dismissCard);
  if (!show) return null;
  return (
    <aside aria-label="Make an account" className="ui-panel mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/35 bg-accent/8 px-3 py-2 text-sm">
      <UserPlus size={16} className="shrink-0 text-accent" aria-hidden />
      <p className="min-w-0 flex-1">
        <b>Make an account to sync and share.</b> <span className="text-muted">You can do this later in Settings → Account.</span>
      </p>
      <Button size="sm" variant="primary" onClick={onOpenAccount}>
        Make an account
      </Button>
      <button type="button" className={buttonClass('ghost', 'icon-sm')} aria-label="Not now" onClick={dismiss}>
        <X size={15} aria-hidden />
      </button>
    </aside>
  );
}
