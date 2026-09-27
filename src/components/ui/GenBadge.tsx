import { genInfo } from '@/domain/generations';
import { cn } from './primitives';

/**
 * Generation symbol: the Roman numeral on a chevron-cut tag in the generation's flagship colour.
 * `label` adds the region name for roomier spots.
 */
export function GenBadge({ gen, label, size = 'sm', className }: { gen: number; label?: boolean; size?: 'xs' | 'sm'; className?: string }) {
  const g = genInfo(gen);
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 align-middle', className)}
      title={`Generation ${g.numeral} · ${g.region} (${g.games})`}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center font-bold tracking-tight text-white',
          size === 'xs' ? 'h-4 min-w-[1.35rem] px-1 text-[9px]' : 'h-5 min-w-[1.75rem] px-1.5 text-[10px]',
        )}
        style={{
          background: g.color,
          clipPath: 'polygon(0 0, 100% 0, calc(100% - 4px) 50%, 100% 100%, 0 100%, 4px 50%)',
          textShadow: '0 1px 1px rgb(0 0 0 / .3)',
        }}
      >
        {g.numeral}
      </span>
      {label && <span className="text-[11px] font-medium text-muted">{g.region}</span>}
    </span>
  );
}
