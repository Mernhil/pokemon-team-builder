import type { Dex } from '@/data/dex';
import type { MetaSet } from '@/domain/metaSets';
import { cn } from '../ui/styles';

/** Mega / Base switch for a threat holding its Mega Stone (nothing for the others). */
export function FormSwitch({ dex, threat, base, onChange }: { dex: Dex; threat: MetaSet; base: boolean; onChange: (base: boolean) => void }) {
  if (!dex.megaFor(threat.speciesId, threat.set.itemId)) return null;
  const name = dex.species(threat.speciesId)?.name ?? threat.speciesId;
  return (
    <span role="radiogroup" aria-label={`${name} form`} className="inline-flex overflow-hidden rounded-md border border-border text-2xs font-semibold">
      {([false, true] as const).map((b) => (
        <button
          key={String(b)}
          type="button"
          role="radio"
          aria-checked={base === b}
          onClick={() => onChange(b)}
          className={cn('px-1.5 py-0.5 pointer-coarse:px-2.5 pointer-coarse:py-1.5', base === b ? 'bg-accent text-accent-fg' : 'text-muted hover:text-fg')}
        >
          {b ? 'Base' : 'Mega'}
        </button>
      ))}
    </span>
  );
}
