import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import type { FormatRules, PokemonSet } from '@/domain/types';
import type { ComboOption } from '../ui/Combobox';
import { TypeBadge, cn } from '../ui/primitives';

/** Held-item options legal in the format; the set's own Mega Stone is highlighted. */
export function useItemOptions(dex: Dex, format: FormatRules, speciesId?: string): ComboOption[] {
  return useMemo(
    () =>
      dex.items(format.regulationId).map((i) => ({
        id: i.id,
        label: i.name,
        keywords: i.shortDesc,
        render: (
          <span className="flex flex-col">
            <span className={cn(speciesId && i.megaStone?.[speciesId] && 'font-semibold text-accent')}>{i.name}</span>
            <span className="truncate text-[11px] text-muted">{i.shortDesc}</span>
          </span>
        ),
      })),
    [dex, format.regulationId, speciesId],
  );
}

/** Learnset options for a set, limited to the format's regulation. */
export function useMoveOptions(dex: Dex, format: FormatRules, set: PokemonSet | null): ComboOption[] {
  return useMemo(() => {
    if (!set) return [];
    return dex.learnset(set.speciesId, format.regulationId).map((m) => ({
      id: m.id,
      label: m.name,
      keywords: `${m.type} ${m.category}`,
      disabled: set.moves.includes(m.id),
      render: (
        <span className="flex items-center gap-2">
          <TypeBadge type={m.type} size="xs" />
          <span className="flex-1 truncate">{m.name}</span>
          <span className="w-12 text-[10px] text-muted">{m.category.slice(0, 4)}</span>
          <span className="w-8 text-right font-mono text-[11px] text-muted">{m.basePower || '—'}</span>
          <span className="w-9 text-right font-mono text-[11px] text-muted">{m.accuracy === true ? '—' : `${m.accuracy}%`}</span>
        </span>
      ),
    }));
  }, [dex, set, format.regulationId]);
}
