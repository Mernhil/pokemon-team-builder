import { useMemo, type ReactNode } from 'react';
import type { Dex } from '@/data/dex';
import { orderItems, orderMoves, type PickerGroup, type PickerKey } from '@/domain/pickerOrder';
import type { FormatRules, Item, Move, PokemonSet } from '@/domain/types';
import { usePickerPrefs, usePrefsStore } from '@/store/prefsStore';
import type { ComboGroup, ComboOption } from '../ui/Combobox';
import { ItemSprite } from '../ui/ItemSprite';
import { CATEGORY_ICON } from '../ui/categoryIcon';
import { MoveTooltip } from '../ui/MoveTooltip';
import { ListModeToggle } from './ListModeToggle';
import { TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';

/** Everything a Combobox needs for one ordered picker, plus `remember` to record a pick as recent. */
export interface PickerProps {
  groups: ComboGroup[];
  favorites: readonly string[];
  onToggleFavorite: (id: string) => void;
  toolbar?: ReactNode;
  remember: (id: string | undefined) => void;
}

function usePickerActions(key: PickerKey) {
  const prefs = usePickerPrefs(key);
  const { addRecent, toggleFavorite } = usePrefsStore.getState();
  return {
    prefs,
    favorites: prefs.favorites,
    onToggleFavorite: (id: string) => toggleFavorite(key, id),
    remember: (id: string | undefined) => id && addRecent(key, id),
  };
}

const toGroups = <T,>(groups: PickerGroup<T>[], toOption: (e: T) => ComboOption): ComboGroup[] =>
  groups.map((g) => ({ id: g.id, label: g.label, options: g.entries.map(toOption) }));

const itemOption = (i: Item, speciesId?: string): ComboOption => ({
  id: i.id,
  label: i.name,
  keywords: i.shortDesc,
  render: (
    <span className="flex items-center gap-2">
      <ItemSprite itemId={i.id} name={i.name} size={20} />
      <span className="flex min-w-0 flex-col">
        <span className={cn(speciesId && i.megaStone?.[speciesId] && 'font-semibold text-accent')}>{i.name}</span>
        <span className="truncate text-xs text-muted">{i.shortDesc}</span>
      </span>
    </span>
  ),
});

/**
 * Held items legal in the format, in the curated order (src/domain/pickerOrder.ts); the set's own
 * Mega Stone is highlighted and sorts first among the stones.
 */
export function useItemPicker(dex: Dex, format: FormatRules, speciesId?: string): PickerProps {
  const { prefs, ...actions } = usePickerActions('items');
  const alphabetical = usePrefsStore((s) => s.listMode.items === 'az');
  const groups = useMemo(
    () =>
      toGroups(orderItems(dex.items(format.regulationId), { prefs, caps: format.capabilities, speciesId, alphabetical }), (i) =>
        itemOption(i, speciesId),
      ),
    // prefs' arrays are stable store references.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dex, format.regulationId, format.capabilities, speciesId, alphabetical, prefs.favorites, prefs.recent],
  );
  return { groups, ...actions, toolbar: <ListModeToggle list="items" /> };
}

const moveOption = (m: Move, taken: string[]): ComboOption => {
  const Icon = CATEGORY_ICON[m.category];
  return {
    id: m.id,
    label: m.name,
    keywords: `${m.type} ${m.category}`,
    disabled: taken.includes(m.id),
    render: (
      <MoveTooltip move={m}>
        <span className="flex items-center gap-2">
          <TypeBadge type={m.type} size="xs" />
          <span className="flex-1 truncate">{m.name}</span>
          <Icon size={12} className="shrink-0 text-muted" aria-label={m.category} />
          <span className="w-8 text-right font-mono text-2xs text-muted">{m.basePower || '—'}</span>
          <span className="w-9 text-right font-mono text-2xs text-muted">{m.accuracy === true ? '—' : `${m.accuracy}%`}</span>
        </span>
      </MoveTooltip>
    ),
  };
};

/**
 * A set's learnset limited to the format's regulation: STAB attacks, coverage (strongest first),
 * setup, support, then fixed/variable-power attacks. With its Mega Stone held (and Megas in the
 * game), the Mega's types count as STAB too.
 */
export function useMovePicker(dex: Dex, format: FormatRules, set: Pick<PokemonSet, 'speciesId' | 'itemId' | 'moves'> | null): PickerProps {
  const { prefs, ...actions } = usePickerActions('moves');
  const alphabetical = usePrefsStore((s) => s.listMode.moves === 'az');
  // Depend on species, item and moves only, so dragging a stat slider doesn't rebuild the learnset.
  const speciesId = set?.speciesId;
  const itemId = set?.itemId;
  const movesKey = set?.moves.join(',') ?? '';
  const groups = useMemo(() => {
    if (!speciesId) return [];
    const species = dex.species(speciesId);
    const mega = format.capabilities.mega ? dex.megaFor(speciesId, itemId) : undefined;
    const stabTypes = [...(species?.types ?? []), ...(mega?.types ?? [])];
    const taken = movesKey.split(',');
    return toGroups(orderMoves(dex.learnset(speciesId, format.regulationId), { prefs, stabTypes, alphabetical }), (m) => moveOption(m, taken));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dex, speciesId, itemId, movesKey, format.regulationId, format.capabilities, alphabetical, prefs.favorites, prefs.recent]);
  return { groups, ...actions, toolbar: <ListModeToggle list="moves" /> };
}

/** Number of distinct entries across groups (the "N legal" counts). */
export const optionCount = (groups: ComboGroup[]) => new Set(groups.flatMap((g) => g.options.map((o) => o.id))).size;

/** The Combobox props of a picker (everything but `remember`). */
export const comboProps = ({ groups, favorites, onToggleFavorite, toolbar }: PickerProps) => ({ groups, favorites, onToggleFavorite, toolbar });
