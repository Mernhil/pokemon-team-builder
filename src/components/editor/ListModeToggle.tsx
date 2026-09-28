import { usePrefsStore, type ListMode } from '@/store/prefsStore';
import { cn } from '../ui/styles';

/** Grouped / A–Z switch shown above the item and move lists. */
export function ListModeToggle({ list }: { list: 'items' | 'moves' }) {
  const mode = usePrefsStore((s) => s.listMode[list] ?? 'grouped');
  const setListMode = usePrefsStore((s) => s.setListMode);
  return (
    <div className="flex items-center gap-1 text-xs" role="group" aria-label="List order">
      {(['grouped', 'az'] as ListMode[]).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setListMode(list, m)}
          className={cn('rounded px-2 py-0.5 font-semibold', mode === m ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')}
        >
          {m === 'grouped' ? 'Grouped' : 'A–Z'}
        </button>
      ))}
    </div>
  );
}
