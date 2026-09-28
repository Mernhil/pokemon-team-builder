import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { toID, type Dex } from '@/data/dex';
import { usePokedexData } from '@/data/pokedex';
import { useDex } from '@/data/useDex';
import { currentRegulation } from '@/domain/formats';
import { BOOKS, bookForFormat, bookInfo, type DexBook } from '@/domain/games';
import type { PokedexData } from '@/domain/pokedex';
import type { FormatRules, Pokemon, TypeName } from '@/domain/types';
import { usePokedexStore } from '@/store/pokedexStore';
import { GenBadge } from '../ui/GenBadge';
import { Sprite } from '../ui/Sprite';
import { Select } from '../ui/primitives';
import { cn } from '../ui/styles';
import { TYPE_COLORS } from '../ui/color';
import { PokedexDetail } from './PokedexDetail';

/**
 * Pokédex for one generation: every species that generation's games had, numbered the way its
 * regional Pokédexes numbered them, with entries, stats, learnsets and where to find it (Area).
 */
export function PokedexView({ format }: { format: FormatRules }) {
  const stored = usePokedexStore((s) => s.book);
  const book = stored ? bookInfo(stored) : bookForFormat(format);
  const { setBook } = usePokedexStore.getState();
  const dexState = useDex(book.id);
  const data = usePokedexData(book.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2" role="group" aria-label="Pokédex">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Pokédex</span>
        {BOOKS.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={b.id === book.id}
            onClick={() => setBook(b.id)}
            title={`${b.region} · ${b.games}`}
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors',
              b.id === book.id ? 'bg-surface-2 ring-1 ring-border' : 'opacity-50 hover:opacity-100',
              ((b.game && b.gen === 7) || b.id === 'gen1') && 'ml-2 border-l border-border pl-2.5',
            )}
          >
            {b.id === 'champions' ? (
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-accent-fg">CHAMPIONS</span>
            ) : (
              <>
                <GenBadge gen={b.gen} size="xs" />
                {b.game ? (
                  <span className="text-xs font-semibold" style={{ color: b.color }}>
                    {b.label}
                  </span>
                ) : (
                  <span className="hidden text-xs font-medium md:inline">{b.label}</span>
                )}
              </>
            )}
          </button>
        ))}
      </div>
      {dexState.status === 'ready' && data ? (
        <PokedexBody key={book.id} book={book} dex={dexState.dex} data={data.dex} learn={data.learn} format={format} />
      ) : (
        <p className="p-10 text-center text-sm text-muted">{dexState.status === 'error' ? dexState.error : `Loading the ${book.region} Pokédex…`}</p>
      )}
    </div>
  );
}

function PokedexBody({ book, dex, data, learn, format }: { book: DexBook; dex: Dex; data: PokedexData; learn: Parameters<typeof PokedexDetail>[0]['learn']; format: FormatRules }) {
  const selected = usePokedexStore((s) => s.species[book.id]);
  const { select } = usePokedexStore.getState();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<TypeName | ''>('');
  const [order, setOrder] = useState<string>('national');
  const [wildOnly, setWildOnly] = useState(false);
  const spriteSet = book.spriteSet;

  // The Champions book is regulation-scoped (its roster changes every regulation); every other book
  // shows the full generation/game roster regardless of the active team's clauses. The book can be
  // picked independently of the active team's own format (e.g. browsing Champions while your team is
  // a Gen 9 one), so its regulation comes from the active team's format only when that IS a Champions
  // format — otherwise from whichever regulation is currently live.
  const championsRegulationId = format.datasetId === 'champions' ? format.regulationId : currentRegulation()?.id;
  const all = useMemo(() => dex.selectableSpecies(book.id === 'champions' ? championsRegulationId : undefined), [dex, book.id, championsRegulationId]);
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
            {data.areas.length > 0 && (
              <>
                <input type="checkbox" checked={wildOnly} onChange={(e) => setWildOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
                Found in the wild in {book.games.split(' · ').length > 1 ? 'these games' : 'this game'}
              </>
            )}
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
              onClick={() => select(book.id, s.id)}
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
            <button type="button" onClick={() => select(book.id, undefined)} className="mb-2 flex items-center gap-1 text-xs font-semibold text-muted hover:text-fg lg:hidden">
              <ArrowLeft size={14} /> All Pokémon
            </button>
            <PokedexDetail key={current.id} species={current} dex={dex} data={data} learn={learn} book={book} format={format} onSelect={(id) => select(book.id, id)} />
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
