import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { SPRITE_SETS, loadSpriteSheet } from '@/data/sprites';
import type { Pokemon, SpriteSetId } from '@/domain/types';
import { GenBadge } from '../ui/GenBadge';
import { Sprite } from '../ui/Sprite';
import { cn } from '../ui/primitives';

/**
 * "Across generations": the species' sprite in every generation's style it appears in.
 * Collapsed by default — expanding it loads the older atlases on demand.
 */
export function SpriteHistory({ species }: { species: Pokemon }) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<SpriteSetId[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setAvailable(null);
    Promise.all(SPRITE_SETS.map((s) => loadSpriteSheet(s.id).then((sheet) => (sheet?.index[species.id] !== undefined ? s.id : null)))).then(
      (ids) => alive && setAvailable(ids.filter((x): x is SpriteSetId => !!x)),
    );
    return () => {
      alive = false;
    };
  }, [open, species.id]);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted hover:text-fg"
      >
        <ChevronRight size={12} className={cn('transition-transform', open && 'rotate-90')} />
        Across generations
      </button>
      {open && (
        <div className="scrollbar-thin mt-2 flex gap-2 overflow-x-auto pb-1">
          {available === null && <span className="text-xs text-muted">Loading sprite sets…</span>}
          {available?.map((id) => {
            const meta = SPRITE_SETS.find((s) => s.id === id)!;
            return (
              <figure key={id} className="flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg bg-surface-2 p-1.5">
                <Sprite speciesId={species.id} name={species.name} types={species.types} set={id} size={64} />
                <figcaption className="flex flex-col items-center gap-0.5 text-center text-[10px] leading-tight text-muted">
                  {meta.gen ? <GenBadge gen={meta.gen} size="xs" /> : <span className="font-semibold text-accent">Champions</span>}
                  <span>{meta.label}</span>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}
