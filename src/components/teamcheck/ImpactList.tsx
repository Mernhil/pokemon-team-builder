import { AlertTriangle, ArrowRightLeft, Sparkles } from 'lucide-react';
import type { Dex } from '@/data/dex';
import type { FormatRules } from '@/domain/types';
import type { Severity, TeamImpact } from '@/domain/regulationImpact';
import { Sprite } from '../ui/Sprite';
import { cn } from '../ui/styles';

const LABEL: Record<Severity, string> = { breaks: 'Breaks', changes: 'Changes', opportunity: 'New' };
const ICON = { breaks: AlertTriangle, changes: ArrowRightLeft, opportunity: Sparkles } as const;
const TONE: Record<Severity, string> = { breaks: 'text-bad', changes: 'text-warn', opportunity: 'text-good' };


/** What a regulation does to each Pokémon of a team. The severity is a word and an icon, never colour alone. */
export function ImpactList({ impact, dex, format }: { impact: TeamImpact; dex: Dex; format: FormatRules }) {
  if (impact.slots.length === 0) return <p className="text-sm text-muted">Nothing changes for this team.</p>;
  return (
    <ul className="space-y-2">
      {impact.slots.map((s) => {
        const sp = dex.species(s.speciesId);
        return (
          <li key={s.slot} className="flex items-start gap-2">
            <Sprite speciesId={s.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                Slot {s.slot + 1}: {sp?.name ?? s.speciesId}
              </p>
              <ul className="space-y-0.5">
                {s.items.map((it, i) => {
                  const Icon = ICON[it.severity];
                  return (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      <Icon size={13} className={cn('mt-0.5 shrink-0', TONE[it.severity])} aria-hidden />
                      <span>
                        <b className={cn('mr-1', TONE[it.severity])}>{LABEL[it.severity]}:</b>
                        {it.text}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
