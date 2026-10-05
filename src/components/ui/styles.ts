/**
 * Class-name helpers behind the UI primitives (kept out of primitives.tsx so that file only
 * exports components). Use them when something must look like a button or a control but can't
 * be one of the primitives (e.g. a Radix trigger or a label wrapping a file input).
 */
import clsx from 'clsx';
import type { TeraType } from '@/domain/types';
import { TYPE_COLORS } from './color';

export const cn = clsx;

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-sm';

export const buttonClass = (variant: ButtonVariant = 'default', size: ButtonSize = 'md', className?: string) =>
  cn(
    'ui-btn inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap transition-colors select-none',
    'disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px',
    // Touch screens get 44pt targets (Apple HIG); mouse users keep the denser sizes.
    size === 'sm' && 'h-8 px-2.5 text-xs pointer-coarse:h-11 pointer-coarse:text-sm',
    size === 'md' && 'h-9 px-3 text-sm pointer-coarse:h-11',
    size === 'icon' && 'h-9 w-9 text-sm pointer-coarse:h-11 pointer-coarse:w-11',
    size === 'icon-sm' && 'hit h-8 w-8 text-sm',
    variant === 'default' && 'border border-border bg-surface text-fg hover:bg-surface-2',
    variant === 'primary' && 'bg-accent text-accent-fg hover:brightness-110',
    variant === 'ghost' && 'ui-ghost text-muted hover:bg-surface-2 hover:text-fg',
    variant === 'danger' && 'ui-danger border border-bad/40 text-bad hover:bg-bad/10',
    className,
  );

/** Shared look of text inputs, selects and comboboxes: 16px on phones (no iOS zoom), 14px from sm up. */
export const controlClass = (invalid?: boolean, className?: string) =>
  cn(
    'ui-field h-9 w-full rounded-lg border bg-surface-2 px-2.5 text-sm text-fg outline-none placeholder:text-muted pointer-coarse:h-11',
    'focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60',
    invalid ? 'border-bad' : 'border-border-strong/60',
    className,
  );

/** Two-type gradient (a Pokémon's colours), for hero tiles and avatars. */
export const typeGradient = (types?: readonly (TeraType | undefined)[]) => {
  const a = types?.[0] ?? 'Normal';
  const b = types?.[1] ?? a;
  return `linear-gradient(135deg, ${TYPE_COLORS[a]}, ${TYPE_COLORS[b]})`;
};

