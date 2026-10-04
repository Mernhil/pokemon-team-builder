import type { Dex } from '@/data/dex';
import { defensiveCoverage, defensiveFixSuggestion, defensiveSuggestions } from '@/domain/coverage';
import type { FormatRules, Team } from '@/domain/types';
import { Panel } from '../ui/primitives';
import { cn } from '../ui/styles';
import { TYPE_BADGE } from '../ui/color';
import { SuggestionList } from './SuggestionList';

/**
 * Compact defensive coverage: for each attacking type, how many team members are weak / resist.
 * (Uses Mega typing when the Pokémon holds its stone. Abilities like Levitate aren't applied yet.)
 */
export function DefenseMatrix({ team, dex, format }: { team: Team; dex: Dex; format: FormatRules }) {
  const rows = defensiveCoverage(team, dex, format.capabilities.mega);
  if (!rows.length) return null;
  const memberCount = team.slots.filter((s) => !!s).length;
  const suggestions = defensiveSuggestions(rows, memberCount);
  const fix = defensiveFixSuggestion(dex, suggestions);

  return (
    <Panel title="Defensive type matrix">
      <div className="grid grid-cols-6 gap-1 sm:grid-cols-9">
        {rows.map(({ atkType, mults, weak, resist, immune, danger }) => (
          <div
            key={atkType}
            className={cn('rounded-lg border p-1 text-center', danger ? 'border-bad/60 bg-bad/10' : 'border-border')}
            title={mults.map((m) => `${m.name}: ${m.mult === 0 ? 'immune (×0)' : `×${m.mult}`}`).join('\n')}
          >
            <div className="truncate rounded text-[10px] font-bold uppercase" style={{ background: TYPE_BADGE[atkType].fill, color: TYPE_BADGE[atkType].text }}>
              {atkType.slice(0, 4)}
            </div>
            <div className="mt-0.5 flex justify-center gap-1.5 font-mono text-xs">
              <span className={weak ? 'font-bold text-bad' : 'text-muted'} aria-label={`${weak} weak`}>
                {weak}
              </span>
              <span className={resist - immune ? 'font-bold text-good' : 'text-muted'} aria-label={`${resist - immune} resist`}>
                {resist - immune}
              </span>
              <span className={immune ? 'font-bold text-accent' : 'text-muted'} aria-label={`${immune} immune`}>
                {immune}
              </span>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">
        Members <span className="text-bad">weak</span> / <span className="text-good">resistant</span> / <span className="text-accent">immune (no effect)</span>{' '}
        to each attacking type; red cells need cover. Hover or focus a cell for multipliers.
      </p>
      <SuggestionList suggestions={suggestions} fix={fix} />
    </Panel>
  );
}
