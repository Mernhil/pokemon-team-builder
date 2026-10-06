import type { TeamImpact } from '@/domain/regulationImpact';

/** "2 break · 1 changes · 1 new" for a summary line. */
export function impactSummary(counts: TeamImpact['counts']): string {
  const parts = [counts.breaks && `${counts.breaks} ${counts.breaks === 1 ? 'problem' : 'problems'}`, counts.changes && `${counts.changes} ${counts.changes === 1 ? 'change' : 'changes'}`, counts.opportunity && `${counts.opportunity} new ${counts.opportunity === 1 ? 'option' : 'options'}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'nothing changes for this team';
}
