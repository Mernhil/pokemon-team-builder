import type { MoveType } from '@/domain/types';
import { TypeBadge } from './primitives';
import { cn } from './styles';

/**
 * A row of type badges to filter by: tap one to filter, tap it again (or "All types") to clear.
 * `wrap` lays them out over several lines instead of one scrolling row.
 */
export function TypeFilter<T extends MoveType>({
  types,
  value,
  onChange,
  label,
  noun = 'Pokémon',
  wrap,
}: {
  types: readonly T[];
  value: T | null;
  onChange: (type: T | null) => void;
  label: string;
  /** What is being filtered, for the buttons' accessible names ("Fire moves"). */
  noun?: string;
  wrap?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex gap-1', wrap ? 'flex-wrap' : 'scrollbar-thin items-center gap-1.5 overflow-x-auto py-1')}>
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange(null)}
        className={cn(
          'inline-flex h-5 shrink-0 items-center rounded-md border px-1.5 text-[11px] font-semibold uppercase tracking-wide pointer-coarse:h-8',
          !value ? 'border-accent bg-accent/15 text-fg' : 'border-border text-muted hover:text-fg',
        )}
      >
        All types
      </button>
      {types.map((type) => (
        <button
          key={type}
          type="button"
          aria-pressed={value === type}
          aria-label={`${type} ${noun}`}
          onClick={() => onChange(value === type ? null : type)}
          className={cn(
            'inline-flex shrink-0 items-center rounded-md border p-0.5 transition-opacity pointer-coarse:p-1.5',
            value === type ? 'border-accent ring-1 ring-accent' : value ? 'border-transparent opacity-50 hover:opacity-100' : 'border-transparent hover:opacity-80',
          )}
        >
          <TypeBadge type={type} size="xs" />
        </button>
      ))}
    </div>
  );
}
