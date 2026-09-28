import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatMoveEffect } from '@/domain/moveEffect';
import { CATEGORY_ICON } from './categoryIcon';
import type { Move } from '@/domain/types';
import { TypeBadge } from './primitives';
import { cn } from './styles';
import { useTooltipTrigger } from './tooltipTrigger';


const FLAG_TAGS: { key: keyof Move['flags']; label: string }[] = [
  { key: 'sound', label: 'Sound' },
  { key: 'punch', label: 'Punch' },
  { key: 'bite', label: 'Bite' },
  { key: 'slicing', label: 'Slicing' },
  { key: 'pulse', label: 'Pulse' },
];

const WIDTH = 272;

/**
 * Wraps a trigger element (a type badge, a move name, …) and shows a Champions-style move info
 * card on hover (~150 ms), keyboard focus, or long-press on touch. Pass `move: undefined` to make
 * this a no-op wrapper (e.g. an empty move slot).
 */
export function MoveTooltip({ move, children, className }: { move: Move | undefined; children: ReactNode; className?: string }) {
  const { open, pos, id, triggerProps } = useTooltipTrigger(WIDTH, { label: move ? `${move.name} details` : undefined, room: 240 });

  if (!move) return <>{children}</>;

  const tags = [
    ...(move.contact ? ['Contact'] : []),
    ...FLAG_TAGS.filter((f) => move.flags[f.key]).map((f) => f.label),
    ...(move.spread ? ['Spread'] : []),
    ...(move.breaksProtect ? ['Bypasses Protect'] : []),
  ];
  const CategoryIcon = CATEGORY_ICON[move.category];

  return (
    <span {...triggerProps} className={cn('hit inline-flex cursor-help rounded', className)}>
      {children}
      {open &&
        pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="fixed z-50 rounded-xl border border-border bg-surface p-3 shadow-2xl"
            style={{ top: pos.top, left: pos.left, width: WIDTH, transform: pos.above ? 'translateY(-100%)' : undefined }}
          >
            <div className="mb-1.5 flex items-center gap-1.5">
              <TypeBadge type={move.type} size="xs" />
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                <CategoryIcon size={11} /> {move.category}
              </span>
              {move.priority !== 0 && (
                <span
                  className={cn(
                    'ml-auto rounded px-1.5 py-0.5 text-[10px] font-bold',
                    move.priority > 0 ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad',
                  )}
                >
                  Priority {move.priority > 0 ? '+' : ''}
                  {move.priority}
                </span>
              )}
            </div>
            <div className="mb-1.5 text-sm font-semibold text-fg">{move.name}</div>
            <div className="mb-1.5 flex items-center gap-3 font-mono text-[11px] text-muted">
              <span>
                <b className="text-fg">{move.basePower || '—'}</b> BP
              </span>
              <span>
                <b className="text-fg">{move.accuracy === true ? '—' : `${move.accuracy}%`}</b> Acc
              </span>
              <span>
                <b className="text-fg">{move.pp}</b> PP
              </span>
            </div>
            <p className="text-xs leading-relaxed text-fg">{formatMoveEffect(move)}</p>
            {tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {tags.map((label) => (
                  <span key={label} className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
