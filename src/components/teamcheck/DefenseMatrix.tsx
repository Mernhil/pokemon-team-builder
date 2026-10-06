import { useState } from 'react';
import type { Dex } from '@/data/dex';
import { defensiveCoverage, defensiveFixSuggestion, defensiveSuggestions } from '@/domain/coverage';
import type { FormatRules, Team } from '@/domain/types';
import { Panel } from '../ui/primitives';
import { cn } from '../ui/styles';
import { TYPE_BADGE } from '../ui/color';
import { SuggestionList } from './SuggestionList';

/**
 * Compact defensive coverage: for each attacking type, how many team members are weak / resist.
 * (Uses Mega typing when the Pokémon holds its stone. Abilities count: Levitate and the absorbing abilities are immune, Thick Fat resists Fire and Ice, and so on.)
 */
export function DefenseMatrix({ team, dex, format }: { team: Team; dex: Dex; format: FormatRules }) {
  const rows = defensiveCoverage(team, dex, format.capabilities.mega);
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;
  const memberCount = team.slots.filter((s) => !!s).length;
  const suggestions = defensiveSuggestions(rows, memberCount);
  const fix = defensiveFixSuggestion(dex, suggestions);

  return (
    <Panel
      title="Defensive type matrix"
      help={
        <>
          Members <span className="text-bad">weak</span> / <span className="text-good">resistant</span> / <span className="text-accent">immune (no effect)</span>{' '}
          to each attacking type; red cells need cover. Tap or focus a cell (Enter or Space) to see each member's multiplier.
        </>
      }
    >
      <div className="grid grid-cols-6 gap-1 sm:grid-cols-9">
        {rows.map(({ atkType, mults, weak, resist, immune, danger }) => (
          <button
            key={atkType}
            type="button"
            aria-pressed={open === atkType}
            aria-label={`${atkType}: ${weak} weak, ${resist - immune} resist, ${immune} immune${danger ? ', needs cover' : ''}`}
            onClick={() => setOpen(open === atkType ? null : atkType)}
            className={cn('ui-cell rounded-lg border p-1 text-center pointer-coarse:min-h-11', danger ? 'border-bad/60 bg-bad/10' : 'border-border', open === atkType && 'ring-2 ring-accent')}
            title={mults.map((m) => `${m.name}: ${m.mult === 0 ? 'immune (×0)' : `×${m.mult}`}`).join('\n')}
          >
            <div aria-hidden className="truncate rounded text-3xs font-bold uppercase" style={{ background: TYPE_BADGE[atkType].fill, color: TYPE_BADGE[atkType].text }}>
              {atkType.slice(0, 4)}
            </div>
            <div aria-hidden className="mt-0.5 flex justify-center gap-1.5 font-mono text-xs">
              <span className={weak ? 'font-bold text-bad' : 'text-muted'}>{weak}</span>
              <span className={resist - immune ? 'font-bold text-good' : 'text-muted'}>{resist - immune}</span>
              <span className={immune ? 'font-bold text-accent' : 'text-muted'}>{immune}</span>
            </div>
          </button>
        ))}
      </div>
      {open && (
        <p role="status" className="mt-2 text-xs">
          <b>{open}</b> hits:{' '}
          {rows
            .find((r) => r.atkType === open)
            ?.mults.map((m) => `${m.name} ${m.mult === 0 ? 'immune (×0)' : `×${m.mult}`}`)
            .join(', ')}
        </p>
      )}
      <SuggestionList suggestions={suggestions} fix={fix} />
    </Panel>
  );
}
