import type { StatId } from './types';

/** Held items that raise one finished stat by 50% (the ones that always apply, whatever the move or field). */
const ITEM_STAT_BOOST: Record<string, { stat: StatId; label: string }> = {
  choiceband: { stat: 'atk', label: 'Choice Band' },
  choicespecs: { stat: 'spa', label: 'Choice Specs' },
  choicescarf: { stat: 'spe', label: 'Choice Scarf' },
  assaultvest: { stat: 'spd', label: 'Assault Vest' },
};

/** The stat an item boosts and the stat's value with it, or undefined for an item that changes no stat. */
export function itemStatBoost(itemId: string | undefined, stats: Record<StatId, number>): { stat: StatId; label: string; value: number } | undefined {
  const b = itemId ? ITEM_STAT_BOOST[itemId] : undefined;
  return b ? { ...b, value: Math.floor(stats[b.stat] * 1.5) } : undefined;
}
