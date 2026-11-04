import { useState } from 'react';
import { Target } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { formatMechanics } from '@/domain/games';
import { investmentForTarget } from '@/domain/stats';
import { type FormatRules, type Pokemon, type PokemonSet, type StatId } from '@/domain/types';
import { Button } from '../ui/primitives';

export function SpeedBenchmark({
  altLabel,
  set,
  species,
  format,
  dex,
  onSpread,
  speed,
  unit,
}: {
  altLabel?: string;
  set: PokemonSet;
  species: Pokemon;
  format: FormatRules;
  dex: Dex;
  onSpread: (stat: StatId, value: number) => void;
  speed: number;
  unit: string;
}) {
  const [target, setTarget] = useState('');
  const mech = formatMechanics(format);
  const nature = mech.natures ? dex.nature(set.nature) : undefined;
  const t = parseInt(target, 10);
  const need = Number.isFinite(t) ? investmentForTarget('spe', species.baseStats, t, set, format, nature) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
      <span className="font-mono tabular-nums">
        <span className="text-muted">{altLabel ? `${altLabel} Spe` : 'Spe'}</span> <b>{speed}</b>
        {mech.tailwind && mech.battleSim && (
          <>
            <span className="text-muted"> · Tailwind </span>
            <b>{speed * 2}</b>
          </>
        )}
        {mech.gen >= 4 && mech.heldItems && (
          <>
            <span className="text-muted"> · Scarf </span>
            <b>{Math.floor(speed * 1.5)}</b>
          </>
        )}
        <span className="text-muted"> · −1 </span>
        <b>{Math.floor((speed * 2) / 3)}</b>
        {mech.gen < 7 && mech.battleSim && (
          <>
            <span className="text-muted"> · Paralyzed </span>
            <b>{Math.floor(speed / 4)}</b>
          </>
        )}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Target size={12} className="text-muted" />
        <span className="text-muted">Hit Spe ≥</span>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))}
          placeholder="e.g. 150"
          aria-label="Target speed"
          inputMode="numeric"
          className="h-6 w-20 rounded border border-border bg-surface px-1.5 font-mono outline-none focus:border-accent pointer-coarse:h-11"
        />
        {need !== undefined &&
          (need === null ? (
            <span className="text-bad">unreachable</span>
          ) : (
            <Button size="sm" onClick={() => onSpread('spe', need)}>
              Set {need.toLocaleString()} {unit}
            </Button>
          ))}
      </span>
    </div>
  );
}
