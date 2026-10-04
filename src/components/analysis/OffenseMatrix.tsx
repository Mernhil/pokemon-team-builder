import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { offensiveCoverage, offensiveFixSuggestion, offensiveSuggestions } from '@/domain/coverage';
import type { Team } from '@/domain/types';
import { Panel } from '../ui/primitives';
import { cn } from '../ui/styles';
import { TYPE_BADGE } from '../ui/color';
import { SuggestionList } from './SuggestionList';

/**
 * Compact offensive coverage: for each defending type, how many team members hit it
 * super-effectively / are walled by it, based on their damaging moves.
 */
export function OffenseMatrix({ team, dex }: { team: Team; dex: Dex }) {
  const rows = useMemo(() => offensiveCoverage(team, dex), [team, dex]);
  const suggestions = useMemo(() => offensiveSuggestions(rows), [rows]);
  const fix = useMemo(() => offensiveFixSuggestion(dex, suggestions), [dex, suggestions]);
  if (!rows[0]?.hits.length) return null;

  return (
    <Panel title="Offensive type matrix">
      <div className="grid grid-cols-6 gap-1 sm:grid-cols-9">
        {rows.map(({ defType, hits, superEffective, walled, noEffect }) => {
          // No super-effective hit on this type, and most of the team can't even hit it neutrally.
          const gap = superEffective === 0 && walled * 2 >= hits.length;
          return (
            <div
              key={defType}
              className={cn(
                'rounded-md border p-1 text-center',
                gap ? 'border-bad/60 bg-bad/10' : superEffective === 0 ? 'border-warn/50 bg-warn/5' : 'border-border',
              )}
              title={hits.map((h) => `${h.name}: ${h.mult === 0 ? 'no effect (×0)' : `×${h.mult}`} (${h.move})`).join('\n')}
            >
              <div className="truncate rounded text-[10px] font-bold uppercase" style={{ background: TYPE_BADGE[defType].fill, color: TYPE_BADGE[defType].text }}>
                {defType.slice(0, 4)}
              </div>
              <div className="mt-0.5 flex justify-center gap-1.5 font-mono text-[11px]">
                <span className={superEffective ? 'font-bold text-good' : 'text-muted'}>{superEffective}</span>
                <span className={walled - noEffect ? 'font-bold text-bad' : 'text-muted'} aria-label={`${walled - noEffect} resisted`}>{walled - noEffect}</span>
                <span className={noEffect ? 'font-bold text-accent' : 'text-muted'} aria-label={`${noEffect} no effect`}>{noEffect}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted">
        Count of members hitting each defending type <span className="text-good">super-effectively</span> /{' '}
        <span className="text-bad">only resisted</span> / <span className="text-accent">no effect at all</span>, from their damaging moves. Hover a cell for each member's best
        move.
      </p>
      <SuggestionList suggestions={suggestions} fix={fix} />
    </Panel>
  );
}
