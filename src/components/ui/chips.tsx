import type { ReactNode } from 'react';
import { cn } from './styles';

/** A toggle chip: its pressed state is a border and weight, never colour alone. 44 pt on touch screens. */
export function Toggle({ pressed, onClick, children, title }: { pressed: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-xs font-semibold whitespace-nowrap transition-colors pointer-coarse:h-11 pointer-coarse:px-3',
        pressed ? 'border-accent bg-accent/15 text-fg' : 'border-border text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

/** A labelled, horizontally scrollable row of chips (a phone scrolls it instead of wrapping). */
export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-2xs font-bold tracking-wide text-muted uppercase">{label}</span>
      <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1">{children}</div>
    </div>
  );
}
