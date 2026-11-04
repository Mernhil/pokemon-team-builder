import type { ReactNode } from 'react';
import type { Dex } from '@/data/dex';
import type { Plan } from '@/domain/bringPlanner';
import type { FormatRules, PokemonSet } from '@/domain/types';
import { Sprite } from '../ui/Sprite';
import { cn } from '../ui/styles';

/**
 * One suggested plan: the six as brought / lead / back with a word under each sprite, the reasons and
 * the main risk. `action` sits at the right of the title ("Use this plan"). Shared by the planner in the
 * match form and Game day.
 */
export function PlanCard({ plan, index, dex, format, sets, action }: { plan: Plan; index: number; dex: Dex; format: FormatRules; sets: ReadonlyMap<string, PokemonSet>; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Plan {index + 1}</h3>
        {action}
      </div>
      <ul aria-label={`Plan ${index + 1} Pokémon`} className="mb-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {[...plan.brought, ...plan.back].map((uid) => {
          const set = sets.get(uid);
          if (!set) return null;
          const sp = dex.species(set.speciesId);
          const lead = plan.leads.includes(uid);
          const back = plan.back.includes(uid);
          return (
            <li key={uid} className={cn('flex flex-col items-center gap-0.5 rounded-lg border p-1.5 text-center', lead ? 'border-accent bg-accent/15' : back ? 'border-dashed border-border' : 'border-border-strong bg-surface')}>
              <Sprite speciesId={set.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={34} />
              <span className="w-full truncate text-xs font-semibold">{sp?.name}</span>
              <span className="text-2xs font-semibold text-fg">
                {lead ? '★ Lead' : back ? 'Back' : 'Brought'}
                {plan.mega === uid ? ' · Mega' : ''}
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="list-disc space-y-0.5 pl-5 text-sm">
        {plan.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-sm">
        <b>Main risk:</b> <span className="text-muted">{plan.risk}</span>
      </p>
    </div>
  );
}
