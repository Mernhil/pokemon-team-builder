import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { metaFor } from '@/data/meta';
import { defensiveCoverage } from '@/domain/coverage';
import { metaPartners } from '@/domain/meta';
import type { FormatRules, Team } from '@/domain/types';
import type { Issue } from '@/domain/validation';
import { useMetaStore } from '@/store/metaStore';
import { Sprite } from '../ui/Sprite';
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
  const refreshed = useMetaStore((s) => s.refreshed);
  const meta = useMemo(() => (format.regulationId ? metaFor(format.regulationId, refreshed) : undefined), [format.regulationId, refreshed]);
  const partners = useMemo(() => {
    const species = team.slots.flatMap((s) => (s ? [s.speciesId] : []));
    return meta && species.length < 6 ? metaPartners(meta, species).filter((p) => dex.species(p.speciesId)) : [];
  }, [meta, team.slots, dex]);

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
        {partners.length > 0 && (
          <div className="space-y-2">
            <Label>Often paired with your team</Label>
            <ul className="space-y-1">
              {partners.map((p) => {
                const sp = dex.species(p.speciesId);
                return (
                  <li key={p.speciesId} className="flex items-center gap-2 text-sm">
                    <Sprite speciesId={p.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{sp?.name}</span>
                      <span className="block truncate text-xs text-muted">
                        with {p.with.slice(0, 2).map((w) => `${dex.species(w.speciesId)?.name ?? w.speciesId} ${Math.round(w.pct)}%`).join(' · ')}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted">% of teams with that member that also run it. {meta?.source.name}
              {meta?.source.month ? `, ${new Date(`${meta.source.month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : ''}; more on the Meta
              tab.</p>
          </div>
        )}
      </div>
    </Panel>
  );
}
