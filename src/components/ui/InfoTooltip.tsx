import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './primitives';

const WIDTH = 288;
const GAP = 8;

/**
 * Generic hover/focus/long-press info card — same interaction model as MoveTooltip (which keeps its
 * own move-specific layout) but for arbitrary title/summary/bullet-list content: weather, terrain,
 * ability and item mechanics. Pass no content props to make this a no-op wrapper.
 */
export function InfoTooltip({
  title,
  summary,
  effects,
  interactions,
  children,
  className,
}: {
  title?: string;
  summary?: string;
  effects?: string[];
  interactions?: string[];
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scheduleOpen = (delay: number) => {
    clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => setOpen(true), delay);
  };
  const close = () => {
    clearTimeout(openTimer.current);
    clearTimeout(pressTimer.current);
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    let left = rect.left;
    if (left + WIDTH > window.innerWidth - GAP) left = window.innerWidth - WIDTH - GAP;
    if (left < GAP) left = GAP;
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < 260 && rect.top > spaceBelow;
    setPos({ top: above ? rect.top - GAP : rect.bottom + GAP, left, above });
  }, [open]);

  if (!title && !summary && !effects?.length && !interactions?.length) return <>{children}</>;

  return (
    <span
      ref={anchorRef}
      tabIndex={0}
      className={cn('inline-flex cursor-help outline-none', className)}
      onMouseEnter={() => scheduleOpen(150)}
      onMouseLeave={close}
      onFocus={() => setOpen(true)}
      onBlur={close}
      onTouchStart={() => {
        pressTimer.current = setTimeout(() => setOpen(true), 500);
      }}
      onTouchEnd={() => clearTimeout(pressTimer.current)}
      onTouchMove={() => clearTimeout(pressTimer.current)}
    >
      {children}
      {open &&
        pos &&
        createPortal(
          <div
            role="tooltip"
            className="fixed z-50 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-2xl"
            style={{ top: pos.top, left: pos.left, width: WIDTH, transform: pos.above ? 'translateY(-100%)' : undefined }}
          >
            {title && <div className="mb-1 text-sm font-semibold text-fg">{title}</div>}
            {summary && <p className="mb-1.5 text-[11px] italic text-muted">{summary}</p>}
            {effects && effects.length > 0 && (
              <ul className="mb-1.5 list-disc space-y-1 pl-3.5 text-[11px] leading-snug text-fg">
                {effects.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {interactions && interactions.length > 0 && (
              <div className="border-t border-border pt-1.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Interactions</p>
                <ul className="list-disc space-y-1 pl-3.5 text-[11px] leading-snug text-muted">
                  {interactions.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
