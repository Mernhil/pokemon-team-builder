import { genInfo } from '@/domain/generations';
import { readableOn } from './color';
import { cn } from './styles';

/**
 * Generation symbol: the Roman numeral on a chevron-cut tag in the generation's flagship colour.
 * `label` adds the region name for roomier spots.
 */
export function GenBadge({ gen, label, size = 'sm', className }: { gen: number; label?: boolean; size?: 'xs' | 'sm'; className?: string }) {
  const g = genInfo(gen);
  const { fill, text } = readableOn(g.color);
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 align-middle', className)}
      title={`Generation ${g.numeral} · ${g.region} (${g.games})`}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center font-bold tracking-tight',
          size === 'xs' ? 'h-4 min-w-[1.35rem] px-1 text-3xs' : 'h-5 min-w-[1.75rem] px-1.5 text-2xs',
        )}
        style={{
          background: fill,
          color: text,
          clipPath: 'polygon(0 0, 100% 0, calc(100% - 4px) 50%, 100% 100%, 0 100%, 4px 50%)',
        }}
      >
        {g.numeral}
      </span>
      {label && <span className="text-xs font-medium text-muted">{g.region}</span>}
    </span>
  );
}
