import type { Dex } from '@/data/dex';
import type { FormatRules, Team, TypeName } from '@/domain/types';
import { Panel, TYPE_COLORS, cn } from '../ui/primitives';

/**
 * Compact defensive coverage: for each attacking type, how many team members are weak / resist.
 * (Uses Mega typing when the Pokémon holds its stone. Abilities like Levitate aren't applied yet.)
 */
export function DefenseMatrix({ team, dex, format }: { team: Team; dex: Dex; format: FormatRules }) {
  const mons = team.slots
    .map((s) => {
      if (!s) return null;
      const sp = dex.species(s.speciesId);
      const mega = format.capabilities.mega ? dex.megaFor(s.speciesId, s.itemId) : undefined;
      return sp ? { name: (mega ?? sp).name, types: (mega ?? sp).types } : null;
    })
    .filter((x): x is { name: string; types: TypeName[] } => !!x);

  if (!mons.length) return null;

  return (
    <Panel title="Defensive Type Matrix">
      <div className="grid grid-cols-6 gap-1 sm:grid-cols-9">
        {dex.types.map((atk) => {
          const mults = mons.map((m) => dex.effectiveness(atk, m.types));
          const weak = mults.filter((m) => m > 1).length;
          const resist = mults.filter((m) => m < 1).length;
          const danger = weak >= 3 || (weak >= 2 && resist === 0);
          return (
            <div
              key={atk}
              className={cn('rounded-md border p-1 text-center', danger ? 'border-bad/60 bg-bad/10' : 'border-border')}
              title={mons.map((m, i) => `${m.name}: ×${mults[i]}`).join('\n')}
            >
              <div className="truncate rounded text-[9px] font-bold uppercase text-white" style={{ background: TYPE_COLORS[atk] }}>
                {atk.slice(0, 4)}
              </div>
              <div className="mt-0.5 flex justify-center gap-1.5 font-mono text-[11px]">
                <span className={weak ? 'font-bold text-bad' : 'text-muted/50'}>{weak}</span>
                <span className={resist ? 'font-bold text-good' : 'text-muted/50'}>{resist}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Count of members <span className="text-bad">weak</span> / <span className="text-good">resistant or immune</span> to each attacking type. Hover a cell for multipliers.
      </p>
    </Panel>
  );
}
