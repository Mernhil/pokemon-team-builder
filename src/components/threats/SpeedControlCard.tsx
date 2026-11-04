import { Gauge } from 'lucide-react';
import type { SpeedDependence } from '@/domain/speedDependence';
import { Chip, Panel } from '../ui/primitives';

/** Whether the team depends on Tailwind / Trick Room, and whether one Pokémon is the only way to set it. */
export function SpeedControlCard({ result }: { result: SpeedDependence }) {
  if (!result.notable) return null;
  const shown = result.plans.filter((p) => p.verdict !== 'independent');
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Gauge size={15} aria-hidden /> Speed control
        </span>
      }
    >
      <ul className="space-y-3 text-sm">
        {shown.map((p) => (
          <li key={p.plan}>
            <p className="flex flex-wrap items-center gap-2">
              <b>{p.plan}</b>
              <Chip tone={p.verdict === 'dependent' ? 'bad' : 'warn'}>{p.verdict === 'dependent' ? 'The team depends on it' : 'Partly depends on it'}</Chip>
              {p.singleSetter && <Chip tone="bad">Single setter: {p.setters[0].name}</Chip>}
            </p>
            {p.lines.map((l) => (
              <p key={l} className="text-muted">
                {l}
              </p>
            ))}
          </li>
        ))}
        {result.noControl && (
          <li>
            <p className="flex flex-wrap items-center gap-2">
              <b>No speed control</b>
              <Chip tone="warn">Mostly outsped</Chip>
            </p>
            <p className="text-muted">{result.noControl.line}</p>
          </li>
        )}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Counts every one of your Pokémon against each Pokémon it is compared with, with the plan off and on (your slowest forme against their quickest). Ties count against you. It can’t tell whether the setter
        survives to move, so a single setter is the warning, not a verdict.
      </p>
    </Panel>
  );
}
