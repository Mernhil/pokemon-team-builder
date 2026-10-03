import { useState } from 'react';
import type { Dex } from '@/data/dex';
import { bringState, cycleBring, type BringLimits, type BringSelection } from '@/domain/matches';
import type { FormatRules } from '@/domain/types';
import { Sprite } from '../ui/Sprite';
import { cn } from '../ui/styles';

export interface RosterMon {
  /** What is stored in brought/leads: a Pokémon uid (saved team) or a species id. */
  id: string;
  speciesId: string;
}

const STATE_TEXT = { none: 'Not brought', brought: 'Brought', lead: 'Lead' } as const;

/**
 * Tap a Pokémon to cycle not brought → brought → lead. The limits (doubles bring 4 / lead 2,
 * singles 3 / 1) come from the match's regulation. State is a word under each sprite, never colour alone.
 */
export function BringPicker({
  dex,
  format,
  label,
  roster,
  value,
  limits,
  onChange,
}: {
  dex: Dex;
  format: FormatRules;
  label: string;
  roster: RosterMon[];
  value: BringSelection;
  limits: BringLimits;
  onChange: (next: BringSelection) => void;
}) {
  const [hint, setHint] = useState('');
  if (roster.length === 0) return null;
  const tap = (id: string) => {
    const next = cycleBring(value, id, limits);
    setHint(next === value ? `Already bringing ${limits.bring}. Tap a brought Pokémon to change it.` : '');
    if (next !== value) onChange(next);
  };
  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
        {label}
        <span className="font-normal tracking-normal normal-case">
          Brought {value.brought.length}/{limits.bring} · Lead {value.leads.length}/{limits.lead} · tap to cycle
        </span>
      </p>
      <ul aria-label={label} className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {roster.map((m) => {
          const sp = dex.species(m.speciesId);
          const state = bringState(value, m.id);
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => tap(m.id)}
                aria-label={`${sp?.name ?? m.speciesId}: ${STATE_TEXT[state].toLowerCase()}. Tap to change.`}
                className={cn(
                  'flex min-h-20 w-full flex-col items-center gap-0.5 rounded-lg border p-1.5 text-center pointer-coarse:min-h-24',
                  state === 'lead' ? 'border-accent bg-accent/15' : state === 'brought' ? 'border-border-strong bg-surface' : 'border-dashed border-border bg-surface-2',
                )}
              >
                <Sprite speciesId={m.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={36} />
                <span className="w-full truncate text-xs font-semibold">{sp?.name ?? m.speciesId}</span>
                <span className={cn('text-[11px]', state === 'lead' ? 'font-bold text-fg' : 'text-muted')}>{state === 'lead' ? '★ Lead' : STATE_TEXT[state]}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p role="status" className="min-h-4 text-xs text-warn">
        {hint}
      </p>
    </div>
  );
}
