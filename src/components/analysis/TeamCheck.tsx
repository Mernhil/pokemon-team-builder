import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { defensiveCoverage } from '@/domain/coverage';
import type { FormatRules, Team } from '@/domain/types';
import type { Issue } from '@/domain/validation';
import { Label, Panel, TypeBadge } from '../ui/primitives';
import { IssueCounts, IssueList } from './ValidationPanel';

/**
 * The builder's right-hand summary: what still needs fixing, then the types the team is most
 * exposed to (from the same defensive coverage as the full matrix below the editor).
 */
export function TeamCheck({ team, dex, format, issues }: { team: Team; dex: Dex; format: FormatRules; issues: Issue[] }) {
  const exposed = useMemo(
    () =>
      defensiveCoverage(team, dex, format.capabilities.mega)
        .filter((r) => r.weak >= 2 || (r.weak >= 1 && r.resist === 0))
        .sort((a, b) => b.weak - a.weak || a.resist - b.resist)
        .slice(0, 6),
    [team, dex, format.capabilities.mega],
  );

  return (
    <Panel title="Team check">
      <div className="space-y-4">
        <IssueCounts issues={issues} />
        <IssueList issues={issues} />
        {exposed.length > 0 && (
          <div className="space-y-2">
            <Label>Most exposed to</Label>
            <ul className="flex flex-wrap gap-2">
              {exposed.map((r) => (
                <li key={r.atkType} className="flex items-center gap-1.5 text-sm" title={r.mults.map((m) => `${m.name}: ×${m.mult}`).join('\n')}>
                  <TypeBadge type={r.atkType} size="xs" />
                  <span className={r.danger ? 'font-semibold text-bad' : 'text-muted'}>
                    {r.weak} weak{r.resist ? ` · ${r.resist} resist` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
