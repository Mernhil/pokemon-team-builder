import { useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown, Loader2, type LucideIcon } from 'lucide-react';
import type { MoveType, TeraType } from '@/domain/types';
import { TYPE_BADGE } from './color';
import { buttonClass, cn, controlClass, typeGradient, type ButtonSize, type ButtonVariant } from './styles';

/**
 * The app's building blocks. Every screen composes these instead of hand-rolling styles, so
 * colour, radius, spacing, focus and pressed states stay the same everywhere:
 *   radius  — rounded-md (chips, badges), rounded-lg (controls), rounded-xl (panels, cards)
 *   heights — sm h-8, md h-9 (controls grow to 44px on touch screens, see index.css)
 *   text    — text-xs is the smallest size used for reading; 10–11px only for badges and labels
 */

export function TypeBadge({ type, size = 'sm' }: { type: TeraType | MoveType; size?: 'xs' | 'sm' }) {
  const { fill, text } = TYPE_BADGE[type];
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-md font-bold tracking-wide uppercase',
        size === 'xs' ? 'h-4 min-w-12 px-1 text-[10px]' : 'h-5 min-w-16 px-1.5 text-[11px]',
      )}
      style={{ background: fill, color: text }}
    >
      {type}
    </span>
  );
}

/** Deterministic, sprite-free avatar: species initials on a type gradient. */
export function MonAvatar({ name, types, size = 40 }: { name?: string; types?: TeraType[]; size?: number }) {
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
        background: name ? typeGradient(types) : 'var(--color-surface-2)',
        textShadow: '0 1px 2px rgb(0 0 0 / .5)',
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
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={controlClass(false, className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={controlClass(false, cn('h-auto resize-none py-2', className))} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={controlClass(false, cn('px-2', className))} {...props}>
      {children}
    </select>
  );
}

/** Small uppercase label used above fields and for section eyebrows. */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-[11px] font-semibold tracking-wider text-muted uppercase', className)}>{children}</span>;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  // Text hints sit in the label row. An interactive hint (an info button) sits outside the
  // <label>: inside it, tapping the hint would activate the field instead.
  const textHint = typeof hint === 'string';
  return (
    <div className={cn('relative flex min-w-0 flex-col', className)}>
      <label className="flex min-w-0 flex-col gap-1">
        <span className={cn('flex items-baseline justify-between gap-2', hint && !textHint && 'pr-8')}>
          <Label>{label}</Label>
          {textHint && <span className="text-right text-xs text-muted">{hint}</span>}
        </span>
        {children}
      </label>
      {hint && !textHint && <span className="absolute -top-1.5 right-0 flex items-center text-muted">{hint}</span>}
    </div>
  );
}

/** A section of a screen. No header rule and no inner borders: spacing separates, the card groups. */
export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  as: As = 'section',
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'aside';
}) {
  return (
    <As className={cn('rounded-xl border border-border bg-surface', className)}>
      {(title || actions) && (
        <header className="flex min-h-11 items-center justify-between gap-2 px-4 pt-3">
          {title && <h2 className="min-w-0 text-sm font-semibold">{title}</h2>}
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn('p-4', (title || actions) && 'pt-2', bodyClassName)}>{children}</div>
    </As>
  );
}

/** Collapsible section (native <details>, so it works with keyboard and screen readers as is). */
export function Disclosure({
  title,
  summary,
  children,
  defaultOpen,
  className,
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details className={cn('group rounded-xl border border-border bg-surface', className)} open={defaultOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2 [&::-webkit-details-marker]:hidden">
        <h2 className="text-sm font-semibold">{title}</h2>
        {summary && <span className="min-w-0 truncate text-xs text-muted">{summary}</span>}
        <ChevronDown size={16} className="ml-auto shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent';

/** Status chip. Always pairs its colour with an icon or words, never colour alone. */
export function Chip({ tone = 'neutral', icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 text-xs font-semibold whitespace-nowrap',
        tone === 'neutral' && 'text-muted',
        tone === 'good' && 'text-good',
        tone === 'warn' && 'text-warn',
        tone === 'bad' && 'text-bad',
        tone === 'accent' && 'text-accent',
        className,
      )}
    >
      {Icon && <Icon size={13} aria-hidden />}
      {children}
    </span>
  );
}

/**
 * Segmented tabs (ARIA tablist): arrow keys move between tabs, Home/End jump. Render the matching
 * content yourself; `idPrefix` + tab id give each tab and panel stable ids.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  tabs: readonly { id: T; label: ReactNode; icon?: LucideIcon }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    onChange(t.id);
    ref.current?.querySelector<HTMLElement>(`[data-tab="${t.id}"]`)?.focus();
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKey} className={cn('flex gap-0.5 rounded-lg bg-surface-2 p-0.5', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          data-tab={t.id}
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md font-semibold whitespace-nowrap transition-colors sm:flex-none',
            size === 'sm' ? 'h-7 px-2.5 text-xs pointer-coarse:h-10' : 'h-8 px-3 text-sm pointer-coarse:h-11',
            value === t.id ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {t.icon && <t.icon size={size === 'sm' ? 13 : 15} aria-hidden />}
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The one empty-state design: icon, one line saying what's missing, one line saying what to do. */
export function EmptyState({ icon: Icon, title, children, action, className }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center', className)}>
      {Icon && <Icon size={28} className="text-muted" aria-hidden />}
      <p className="text-sm font-semibold">{title}</p>
      {children && <p className="max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** The one loading design. Announced politely to screen readers. */
export function LoadingState({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex items-center justify-center gap-2 p-10 text-sm text-muted', className)}>
      <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />
      {label}
    </div>
  );
}

/** Inline alert for errors and notices (role=alert for errors so they're read out). */
export function Notice({ tone = 'warn', icon: Icon, title, children, className }: { tone?: 'warn' | 'bad' | 'accent'; icon?: LucideIcon; title?: string; children: ReactNode; className?: string }) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cn(
        'flex gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm',
        tone === 'warn' && 'border-warn/35 bg-warn/8',
        tone === 'bad' && 'border-bad/35 bg-bad/8',
        tone === 'accent' && 'border-accent/35 bg-accent/8',
        className,
      )}
    >
      {Icon && <Icon size={16} className={cn('mt-0.5 shrink-0', tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-bad' : 'text-accent')} aria-hidden />}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-muted">{children}</div>
      </div>
    </div>
  );
}

/** The bad/warn icon that leads a severity-ranked list row (ValidationPanel's issues): same size, colour and label everywhere one appears. */
export function SeverityIcon({ icon: Icon, tone }: { icon: LucideIcon; tone: 'bad' | 'warn' }) {
  return <Icon size={15} className={cn('mt-0.5 shrink-0', tone === 'bad' ? 'text-bad' : 'text-warn')} aria-label={tone === 'bad' ? 'error' : 'warning'} />;
}

