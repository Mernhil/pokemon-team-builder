import { useMemo, useState } from 'react';
import type { Dex } from '@/data/dex';
import { GENERATIONS } from '@/domain/generations';
import type { FormatRules } from '@/domain/types';
import { Combobox, type ComboOption } from '../ui/Combobox';
import { GenBadge } from '../ui/GenBadge';
import { Sprite } from '../ui/Sprite';
import { TypeBadge, cn } from '../ui/primitives';

interface Props {
  dex: Dex;
  format: FormatRules;
  value?: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  /** Show the generation filter row above the search box. */
  showGenFilter?: boolean;
}

/** Species search with sprites, generation symbols and a generation filter. */
export function SpeciesPicker({ dex, format, value, onChange, placeholder, className, showGenFilter = true }: Props) {
  const [gen, setGen] = useState<number | null>(null);
  const mega = format.capabilities.mega;
  const pool = useMemo(() => dex.selectableSpecies(format.regulationId), [dex, format.regulationId]);
  const counts = useMemo(() => {
    const c = new Map<number, number>();
    for (const s of pool) c.set(s.gen, (c.get(s.gen) ?? 0) + 1);
    return c;
  }, [pool]);

  const options = useMemo<ComboOption[]>(
    () =>
      pool
        .filter((s) => gen === null || s.gen === gen)
        .map((s) => ({
          id: s.id,
          label: s.name,
          keywords: [...s.types, ...Object.values(s.abilities), mega && s.megaForms.length ? 'mega' : '', `gen${s.gen}`].join(' '),
          render: (
            <span className="flex items-center gap-2">
              <Sprite speciesId={s.id} name={s.name} types={s.types} set={format.spriteSet} size={32} />
              <span className="w-8 font-mono text-[10px] text-muted">#{s.num}</span>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {mega && s.megaForms.length > 0 && <span className="text-[10px] font-bold text-accent">MEGA</span>}
              <GenBadge gen={s.gen} size="xs" />
              <span className="hidden gap-0.5 sm:flex">
                {s.types.map((t) => (
                  <TypeBadge key={t} type={t} size="xs" />
                ))}
              </span>
            </span>
          ),
        })),
    [pool, gen, format.spriteSet, mega],
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      {showGenFilter && (
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by generation">
          <button
            type="button"
            onClick={() => setGen(null)}
            aria-pressed={gen === null}
            className={cn(
              'h-5 rounded px-1.5 text-[10px] font-semibold',
              gen === null ? 'bg-fg text-bg' : 'text-muted hover:bg-surface-2',
            )}
          >
            All
          </button>
          {GENERATIONS.filter((g) => counts.get(g.gen)).map((g) => (
            <button
              key={g.gen}
              type="button"
              onClick={() => setGen(gen === g.gen ? null : g.gen)}
              aria-pressed={gen === g.gen}
              className={cn('rounded transition-opacity', gen !== null && gen !== g.gen && 'opacity-35 hover:opacity-80')}
              title={`${g.region}: ${counts.get(g.gen)} Pokémon`}
            >
              <GenBadge gen={g.gen} size="xs" />
            </button>
          ))}
        </div>
      )}
      <Combobox
        aria-label="Species"
        options={options}
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? (gen ? `Search ${GENERATIONS[gen - 1].region} Pokémon…` : 'Search name, type, ability…')}
      />
    </div>
  );
}
