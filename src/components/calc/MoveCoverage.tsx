import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { moveCoverage, type MoveCoverageRow } from '@/domain/coverage';
import type { PokemonSet } from '@/domain/types';
import { TYPE_BADGE } from '../ui/color';
import { Panel } from '../ui/primitives';
import { cn } from '../ui/styles';

const label = (mult: number | undefined) => (mult === undefined ? '·' : mult === 0 ? '0' : mult === 0.5 ? '½' : mult === 0.25 ? '¼' : `${mult}`);

function Grid({ title, set, dex, against }: { title: string; set: PokemonSet; dex: Dex; against?: string[] }) {
  const moves = set.moves.join(',');
  // Recomputed whenever a move changes, so the grid follows the move slots live.
  const rows = useMemo(() => moveCoverage(dex, moves.split(',')), [dex, moves]);
  const hasAttack = rows[0]?.mult !== undefined;
  const group = (pred: (r: MoveCoverageRow) => boolean) => rows.filter(pred).map((r) => r.defType);
  const gaps = group((r) => r.mult !== undefined && r.mult < 1);
  const sup = group((r) => (r.mult ?? 0) > 1).length;
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title}
        {hasAttack && <span className="font-normal normal-case tracking-normal">hits {sup} of {rows.length} types super-effectively</span>}
      </div>
      {!hasAttack ? (
        <p className="text-xs text-muted">No damaging moves selected.</p>
      ) : (
        <>
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-9">
            {rows.map(({ defType, mult, moves: by }) => (
              <div
                key={defType}
                title={`${defType}: ${by.join(', ')} (${mult === 0 ? 'no effect' : `×${mult}`})`}
                className={cn(
                  'rounded-md border p-1 text-center',
                  (mult ?? 1) > 1 ? 'border-good/50 bg-good/10' : mult === 0 ? 'border-accent/50 bg-accent/10' : (mult ?? 1) < 1 ? 'border-bad/50 bg-bad/10' : 'border-border',
                  against?.includes(defType) && 'ring-2 ring-fg/60',
                )}
              >
                <div className="truncate rounded text-[10px] font-bold uppercase" style={{ background: TYPE_BADGE[defType].fill, color: TYPE_BADGE[defType].text }}>
                  {defType.slice(0, 4)}
                </div>
                <div className={cn('font-mono text-[11px] font-bold', (mult ?? 1) > 1 ? 'text-good' : mult === 0 ? 'text-accent' : (mult ?? 1) < 1 ? 'text-bad' : 'text-muted')}>
                  <span aria-hidden>{label(mult)}</span>
                  <span className="sr-only">{mult === 0 ? 'no effect' : `times ${mult}`}</span>
                </div>
              </div>
            ))}
          </div>
          {gaps.length > 0 && <p className="mt-1 text-xs text-muted">Resisted or blocked by: {gaps.join(', ')}.</p>}
        </>
      )}
    </div>
  );
}

/**
 * Attack coverage of the moves currently selected on each side of the calculator. Best multiplier
 * of any damaging move against each (single) defending type; it follows the move slots live.
 */
export function MoveCoverage({ dex, attacker, defender }: { dex: Dex; attacker?: PokemonSet; defender?: PokemonSet }) {
  if (!attacker && !defender) return null;
  const typesOf = (s?: PokemonSet) => (s ? dex.species(s.speciesId)?.types : undefined);
  const name = (s: PokemonSet) => dex.species(s.speciesId)?.name ?? s.speciesId;
  return (
    <Panel title="Move coverage">
      <div className="space-y-3">
        {attacker && <Grid title={`${name(attacker)}'s moves`} set={attacker} dex={dex} against={typesOf(defender)} />}
        {defender && <Grid title={`${name(defender)}'s moves`} set={defender} dex={dex} against={typesOf(attacker)} />}
      </div>
      <p className="mt-2 text-xs text-muted">
        Best multiplier of the selected damaging moves against each type; the outlined types are the opposing Pokémon's. Move types only: abilities that change a move's type aren't modelled.
      </p>
    </Panel>
  );
}
