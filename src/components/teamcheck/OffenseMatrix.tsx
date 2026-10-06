import { useMemo, useState } from 'react';
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
export function OffenseMatrix({ team, dex, mega = false }: { team: Team; dex: Dex; /** The game has Megas: a stone holder uses its Mega's ability. */ mega?: boolean }) {
  const rows = useMemo(() => offensiveCoverage(team, dex, mega), [team, dex, mega]);
  const suggestions = useMemo(() => offensiveSuggestions(rows), [rows]);
  const fix = useMemo(() => offensiveFixSuggestion(dex, suggestions), [dex, suggestions]);
  const [open, setOpen] = useState<string | null>(null);
  if (!rows[0]?.hits.length) return null;

  return (
    <Panel
      title="Offensive type matrix"
      help={
        <>
        Count of members hitting each defending type <span className="text-good">super-effectively</span> /{' '}
        <span className="text-bad">only resisted</span> / <span className="text-accent">no effect at all</span>, from their damaging moves and abilities (Pixilate, Scrappy, Tinted Lens). Tap or focus a cell (Enter or Space) to see each member's best move.
        </>
      }
    >
      <div className="grid grid-cols-6 gap-1 sm:grid-cols-9">
        {rows.map(({ defType, hits, superEffective, walled, noEffect }) => {
          // No super-effective hit on this type, and most of the team can't even hit it neutrally.
          const gap = superEffective === 0 && walled * 2 >= hits.length;
          return (
            <button
              key={defType}
              type="button"
              aria-pressed={open === defType}
              aria-label={`${defType}: ${superEffective} hit it super-effectively, ${walled - noEffect} only resisted, ${noEffect} no effect${gap ? ', a gap in coverage' : ''}`}
              onClick={() => setOpen(open === defType ? null : defType)}
              className={cn(
                'ui-cell rounded-md border p-1 text-center pointer-coarse:min-h-11',
                gap ? 'border-bad/60 bg-bad/10' : superEffective === 0 ? 'border-warn/50 bg-warn/5' : 'border-border',
                open === defType && 'ring-2 ring-accent',
              )}
              title={hits.map((h) => `${h.name}: ${h.mult === 0 ? 'no effect (×0)' : `×${h.mult}`} (${h.move})`).join('\n')}
            >
              <div aria-hidden className="truncate rounded text-3xs font-bold uppercase" style={{ background: TYPE_BADGE[defType].fill, color: TYPE_BADGE[defType].text }}>
                {defType.slice(0, 4)}
              </div>
              <div aria-hidden className="mt-0.5 flex justify-center gap-1.5 font-mono text-2xs">
                <span className={superEffective ? 'font-bold text-good' : 'text-muted'}>{superEffective}</span>
                <span className={walled - noEffect ? 'font-bold text-bad' : 'text-muted'}>{walled - noEffect}</span>
                <span className={noEffect ? 'font-bold text-accent' : 'text-muted'}>{noEffect}</span>
              </div>
            </button>
          );
        })}
      </div>
      {open && (
        <p role="status" className="mt-2 text-xs">
          <b>{open}</b> is hit by:{' '}
          {rows
            .find((r) => r.defType === open)
            ?.hits.map((h) => `${h.name} ${h.mult === 0 ? 'no effect (×0)' : `×${h.mult}`} (${h.move})`)
            .join(', ')}
        </p>
      )}
      <SuggestionList suggestions={suggestions} fix={fix} />
    </Panel>
  );
}
