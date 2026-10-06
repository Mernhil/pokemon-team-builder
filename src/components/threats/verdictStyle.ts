import type { Bucket } from '@/domain/threats';

/**
 * How a matchup verdict is drawn everywhere it appears (Threat report, Game day's matchups): blue for
 * good for you, orange for bad (a pair that stays distinguishable for colour-blind players), neutral
 * for even. Always shown with ✓/✗/~ or ▲/▼/◆ and words, never colour alone.
 */
export const VERDICT_CELL: Record<Bucket, string> = {
  good: 'border-accent/50 bg-accent/12',
  bad: 'border-warn/60 bg-warn/15',
  even: 'border-border bg-surface-2',
};
