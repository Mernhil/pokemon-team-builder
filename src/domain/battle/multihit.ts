/**
 * How many hits to calculate for a multi-hit move. Pure.
 *
 * Fixed-hit moves (Dual Wingbeat, Double Kick) always land every hit. 2–5 hit moves default to the
 * calculator's 3 (Skill Link 5, Loaded Dice 4). Moves that check accuracy on every hit (Population Bomb,
 * Triple Axel, Triple Kick) stop at the first miss, so they are calculated at the expected number of hits
 * (rounded) given the move's accuracy, Wide Lens (×1.1) and Compound Eyes (×1.3); Skill Link and No Guard
 * land them all.
 */
export interface HitsInput {
  /** Move accuracy: a percentage, or true for a move that never misses. */
  accuracy: number | true;
  multihit?: number | [number, number];
  /** Accuracy is rolled for each hit (the move stops at its first miss). */
  multiaccuracy?: boolean;
  ability?: string;
  item?: string;
}

/** Hits to hand the calculator, or undefined to keep its default. */
export function hitsFor(m: HitsInput): number | undefined {
  if (m.multihit === undefined) return undefined;
  if (Array.isArray(m.multihit)) return m.item === 'Loaded Dice' && m.ability !== 'Skill Link' ? 4 : undefined;
  const n = m.multihit;
  if (!m.multiaccuracy) return undefined;
  if (m.ability === 'Skill Link' || m.ability === 'No Guard' || m.accuracy === true) return n;
  const p = Math.min(1, (m.accuracy / 100) * (m.item === 'Wide Lens' ? 1.1 : 1) * (m.ability === 'Compound Eyes' ? 1.3 : 1));
  let expected = 0;
  for (let k = 1; k <= n; k++) expected += p ** k;
  return Math.max(1, Math.round(expected));
}
