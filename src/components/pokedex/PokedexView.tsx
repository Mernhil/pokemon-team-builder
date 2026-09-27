import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { toID, type Dex } from '@/data/dex';
import { usePokedexData } from '@/data/pokedex';
import { useDex } from '@/data/useDex';
import { GENERATIONS, genInfo } from '@/domain/generations';
import type { PokedexData } from '@/domain/pokedex';
import type { FormatRules, Pokemon, SpriteSetId, TypeName } from '@/domain/types';
import { usePokedexStore } from '@/store/pokedexStore';
import { GenBadge } from '../ui/GenBadge';
import { Sprite } from '../ui/Sprite';
import { Select, TYPE_COLORS, cn } from '../ui/primitives';
import { PokedexDetail } from './PokedexDetail';

/**
 * Pokédex for one generation: every species that generation's games had, numbered the way its
 * regional Pokédexes numbered them, with entries, stats, learnsets and where to find it (Area).
 */
export function PokedexView({ format }: { format: FormatRules }) {
  const storedGen = usePokedexStore((s) => s.gen);
  const gen = storedGen ?? (format.datasetId === 'champions' ? 9 : format.generation);
  const { setGen } = usePokedexStore.getState();
  const dexState = useDex(`gen${gen}`);
  const data = usePokedexData(gen);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2" role="group" aria-label="Generation">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Pokédex</span>
        {GENERATIONS.map((g) => (
          <button
            key={g.gen}
            type="button"
            aria-pressed={g.gen === gen}
            onClick={() => setGen(g.gen)}
            title={`${g.region} · ${g.games}`}
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors',
              g.gen === gen ? 'bg-surface-2 ring-1 ring-border' : 'opacity-50 hover:opacity-100',
            )}
          >
            <GenBadge gen={g.gen} size="xs" />
            <span className="hidden text-xs font-medium md:inline">{g.region}</span>
          </button>
        ))}
      </div>
      {dexState.status === 'ready' && data ? (
        <PokedexBody key={gen} gen={gen} dex={dexState.dex} data={data.dex} learn={data.learn} format={format} />
      ) : (
        <p className="p-10 text-center text-sm text-muted">{dexState.status === 'error' ? dexState.error : `Loading the ${genInfo(gen).region} Pokédex…`}</p>
      )}
    </div>
  );
}

function PokedexBody({ gen, dex, data, learn, format }: { gen: number; dex: Dex; data: PokedexData; learn: Parameters<typeof PokedexDetail>[0]['learn']; format: FormatRules }) {
  const selected = usePokedexStore((s) => s.species[gen]);
  const { select } = usePokedexStore.getState();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeName | ''>('');
  const [order, setOrder] = useState<string>('national');
  const [wildOnly, setWildOnly] = useState(false);
  const spriteSet = `gen${gen}` as SpriteSetId;

  const all = useMemo(() => dex.selectableSpecies(), [dex]);
  const number = useCallback((s: Pokemon) => (order === 'national' ? s.num : data.entries[s.num]?.dex?.[order]), [order, data]);
  const list = useMemo(() => {
    const q = toID(query);
    return all
      .filter((s) => number(s) !== undefined)
      .filter((s) => !type || s.types.includes(type))
      .filter((s) => !wildOnly || data.encounters[s.id]?.length)
      .filter((s) => !q || s.id.includes(q) || String(s.num) === q || toID(data.entries[s.num]?.genus).includes(q))
      .sort((a, b) => number(a)! - number(b)! || a.name.localeCompare(b.name));
  }, [all, query, type, number, wildOnly, data]);

  const current = (selected && dex.species(selected)) || undefined;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current?.id]);

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className={cn('rounded-xl border border-border bg-surface lg:sticky lg:top-[68px] lg:self-start', current && 'hidden lg:block')}>
        <div className="space-y-2 border-b border-border p-3">
          <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 focus-within:border-accent">
            <Search size={14} className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, number or category…"
              aria-label="Search the Pokédex"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </label>
          <div className="flex gap-1.5">
            <Select aria-label="Numbering" className="h-8 text-xs" value={order} onChange={(e) => setOrder(e.target.value)}>
              <option value="national">National Dex</option>
              {data.dexes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} Dex
                </option>
              ))}
            </Select>
            <Select aria-label="Type" className="h-8 text-xs" value={type} onChange={(e) => setType(e.target.value as TypeName | '')}>
              <option value="">All types</option>
              {dex.types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={wildOnly} onChange={(e) => setWildOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
            Found in the wild in {genInfo(gen).games.split(' · ').length > 1 ? 'these games' : 'this game'}
            <span className="ml-auto font-mono">{list.length}</span>
          </label>
        </div>
        <div ref={listRef} className="scrollbar-thin max-h-[calc(100vh-260px)] min-h-64 overflow-y-auto p-1.5" role="listbox" aria-label="Pokémon">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={s.id === current?.id}
              aria-current={s.id === current?.id}
              onClick={() => select(gen, s.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-1.5 py-0.5 text-left text-sm',
                s.id === current?.id ? 'bg-accent/15 text-fg' : 'hover:bg-surface-2',
              )}
            >
              <span className="w-10 font-mono text-[11px] text-muted">{String(number(s)).padStart(3, '0')}</span>
              <Sprite speciesId={s.id} name={s.name} types={s.types} set={spriteSet} size={32} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="flex gap-0.5">
                {s.types.map((t) => (
                  <span key={t} className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[t] }} title={t} aria-label={t} />
                ))}
              </span>
            </button>
          ))}
          {!list.length && <p className="p-4 text-center text-xs text-muted">No Pokémon match.</p>}
        </div>
      </aside>

      <div className={cn('min-w-0', !current && 'hidden lg:block')}>
        {current ? (
          <>
            <button type="button" onClick={() => select(gen, undefined)} className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg lg:hidden">
              <ArrowLeft size={14} /> All Pokémon
            </button>
            <PokedexDetail key={current.id} species={current} dex={dex} data={data} learn={learn} gen={gen} format={format} onSelect={(id) => select(gen, id)} />
          </>
        ) : (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted">
            Pick a Pokémon to see its entry, moves and where to find it.
          </div>
        )}
      </div>
    </div>
  );
}
