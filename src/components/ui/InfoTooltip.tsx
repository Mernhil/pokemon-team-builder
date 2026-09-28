import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './styles';
import { useTooltipTrigger } from './tooltipTrigger';

const WIDTH = 288;

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
  label,
  wrapsControl,
  children,
  className,
}: {
  title?: string;
  summary?: string;
  effects?: string[];
  interactions?: string[];
  /** Accessible name when the trigger has no text of its own (an icon). */
  label?: string;
  /** The child is itself a button or other control (see useTooltipTrigger). */
  wrapsControl?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { open, pos, id, triggerProps } = useTooltipTrigger(WIDTH, { label, room: 260, wrapsControl });

  if (!title && !summary && !effects?.length && !interactions?.length) return <>{children}</>;

  return (
    <span {...triggerProps} className={cn('inline-flex cursor-help rounded', label && 'hit', className)}>
      {children}
      {open &&
        pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="fixed z-50 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-2xl"
            style={{ top: pos.top, left: pos.left, width: WIDTH, transform: pos.above ? 'translateY(-100%)' : undefined }}
          >
            {title && <div className="mb-1 text-sm font-semibold text-fg">{title}</div>}
            {summary && <p className="mb-1.5 text-xs italic text-muted">{summary}</p>}
            {effects && effects.length > 0 && (
              <ul className="mb-1.5 list-disc space-y-1 pl-3.5 text-xs leading-snug text-fg">
                {effects.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
            {interactions && interactions.length > 0 && (
              <div className="border-t border-border pt-1.5">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Interactions</p>
                <ul className="list-disc space-y-1 pl-3.5 text-xs leading-snug text-muted">
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
