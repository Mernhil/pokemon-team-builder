import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import type { MoveType, StatId, TeraType } from '@/domain/types';

export const cn = clsx;

export const TYPE_COLORS: Record<TeraType | '???', string> = {
  Normal: '#9fa19f', Fire: '#e62829', Water: '#2980ef', Electric: '#fac000', Grass: '#3fa129',
  Ice: '#3dcef3', Fighting: '#ff8000', Poison: '#9141cb', Ground: '#915121', Flying: '#81b9ef',
  Psychic: '#ef4179', Bug: '#91a119', Rock: '#afa981', Ghost: '#704170', Dragon: '#5060e1',
  Dark: '#624d4e', Steel: '#60a1b8', Fairy: '#ef70ef', Stellar: '#40b5a5', '???': '#68a090',
};

export const STAT_COLOR_VAR: Record<StatId, string> = {
  hp: 'var(--color-stat-hp)',
  atk: 'var(--color-stat-atk)',
  def: 'var(--color-stat-def)',
  spa: 'var(--color-stat-spa)',
  spd: 'var(--color-stat-spd)',
  spe: 'var(--color-stat-spe)',
};

export function TypeBadge({ type, size = 'sm' }: { type: TeraType | MoveType; size?: 'xs' | 'sm' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded font-semibold uppercase tracking-wide text-white',
        size === 'xs' ? 'h-4 min-w-12 px-1 text-[9px]' : 'h-5 min-w-16 px-1.5 text-[10px]',
      )}
      style={{ background: TYPE_COLORS[type], textShadow: '0 1px 1px rgb(0 0 0 / .35)' }}
    >
      {type}
    </span>
  );
}

/** Deterministic, sprite-free avatar: species initials on a type gradient. */
export function MonAvatar({ name, types, size = 40 }: { name?: string; types?: TeraType[]; size?: number }) {
  const [a, b] = [types?.[0] ?? 'Normal', types?.[1] ?? types?.[0] ?? 'Normal'];
  const initials = (name ?? '?')
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: name ? `linear-gradient(135deg, ${TYPE_COLORS[a]}, ${TYPE_COLORS[b]})` : 'var(--color-surface-2)',
        textShadow: '0 1px 2px rgb(0 0 0 / .4)',
      }}
      aria-hidden
    >
      {name ? initials : '+'}
    </div>
  );
}

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'icon' }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
        size === 'sm' && 'h-7 px-2 text-xs',
        size === 'md' && 'h-9 px-3 text-sm',
        size === 'icon' && 'h-8 w-8 text-sm',
        variant === 'default' && 'border border-border bg-surface-2 hover:bg-border/60',
        variant === 'primary' && 'bg-accent text-accent-fg hover:brightness-110',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-fg',
        variant === 'danger' && 'border border-bad/40 text-bad hover:bg-bad/10',
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-border bg-surface-2 px-2.5 text-sm outline-none placeholder:text-muted',
        'focus:border-accent focus:ring-2 focus:ring-accent/25',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
        {hint && <span className="font-normal normal-case tracking-normal">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
