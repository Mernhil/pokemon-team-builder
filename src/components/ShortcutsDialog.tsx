import { GO_KEYS } from '@/domain/hotkeys';
import { NAV_LABELS } from '@/domain/navigation';
import { Modal } from './ui/Modal';

const Key = ({ children }: { children: string }) => <kbd className="rounded border border-border-strong/60 bg-surface-2 px-1.5 py-0.5 font-mono text-xs">{children}</kbd>;

/** The list behind `?` and Settings → Keyboard shortcuts. */
export default function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="Single keys work when you aren't typing in a field.">
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt>Search everything (teams, Pokémon, screens)</dt>
          <dd className="flex gap-1">
            <Key>/</Key>
            <span className="text-muted">or</span>
            <Key>Ctrl</Key>
            <Key>K</Key>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt>Show this list</dt>
          <dd>
            <Key>?</Key>
          </dd>
        </div>
        {Object.entries(GO_KEYS).map(([key, view]) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <dt>Go to {NAV_LABELS[view]}</dt>
            <dd className="flex gap-1">
              <Key>g</Key>
              <span className="text-muted">then</span>
              <Key>{key}</Key>
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
