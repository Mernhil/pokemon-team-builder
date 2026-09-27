import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { TYPE_NAMES, type FormatRules, type PokemonSet } from '@/domain/types';
import type { ComboOption } from '../ui/Combobox';
import { ItemSprite } from '../ui/ItemSprite';
import { MoveTooltip } from '../ui/MoveTooltip';
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
          <span className="flex items-center gap-2">
            <ItemSprite itemId={i.id} name={i.name} size={20} />
            <span className="flex flex-col">
              <span className={cn(speciesId && i.megaStone?.[speciesId] && 'font-semibold text-accent')}>{i.name}</span>
              <span className="truncate text-[11px] text-muted">{i.shortDesc}</span>
            </span>
          </span>
        ),
      })),
    [dex, format.regulationId, speciesId],
  );
}

/** Canonical type order; Gen 2–4's typeless '???' (Curse) sorts last. */
const typeOrder = (t: string) => {
  const i = (TYPE_NAMES as readonly string[]).indexOf(t);
  return i < 0 ? TYPE_NAMES.length : i;
};

/** Learnset options for a set, limited to the format's regulation. */
export function useMoveOptions(dex: Dex, format: FormatRules, set: PokemonSet | null): ComboOption[] {
  // Depend on species + moves only, so dragging a stat slider doesn't rebuild the whole learnset.
  const speciesId = set?.speciesId;
  const movesKey = set?.moves.join(',') ?? '';
  return useMemo(() => {
    if (!speciesId) return [];
    const moves = movesKey.split(',');
    // Grouped by type (canonical Normal → Fairy order), alphabetical within each type.
    return dex
      .learnset(speciesId, format.regulationId)
      .sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || a.name.localeCompare(b.name))
      .map((m) => ({
      id: m.id,
      label: m.name,
      keywords: `${m.type} ${m.category}`,
      disabled: moves.includes(m.id),
      render: (
        <MoveTooltip move={m}>
          <span className="flex items-center gap-2">
            <TypeBadge type={m.type} size="xs" />
            <span className="flex-1 truncate">{m.name}</span>
            <span className="w-12 text-[10px] text-muted">{m.category.slice(0, 4)}</span>
            <span className="w-8 text-right font-mono text-[11px] text-muted">{m.basePower || '—'}</span>
            <span className="w-9 text-right font-mono text-[11px] text-muted">{m.accuracy === true ? '—' : `${m.accuracy}%`}</span>
          </span>
        </MoveTooltip>
      ),
    }));
  }, [dex, speciesId, movesKey, format.regulationId]);
}
