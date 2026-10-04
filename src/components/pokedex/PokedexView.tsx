import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Search } from 'lucide-react';
import { toID, type Dex } from '@/data/dex';
import { usePokedexData } from '@/data/pokedex';
import { useDex } from '@/data/useDex';
import { REGULATION_MANIFEST, currentRegulation } from '@/domain/formats';
import { BOOKS, bookForFormat, bookInfo, type DexBook } from '@/domain/games';
import { introducedIn, megaList, megaStoneName, type PokedexData } from '@/domain/pokedex';
import type { FormatRules, Pokemon, TypeName } from '@/domain/types';
import { usePokedexStore } from '@/store/pokedexStore';
import { ChipRow, Toggle } from '../ui/chips';
import { GenBadge } from '../ui/GenBadge';
import { Sprite } from '../ui/Sprite';
import { Button, EmptyState, LoadingState, Select } from '../ui/primitives';
import { TypeFilter } from '../ui/TypeFilter';
import { cn } from '../ui/styles';
import { TYPE_COLORS } from '../ui/color';
import { PokedexDetail } from './PokedexDetail';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions').sort((a, b) => b.start.localeCompare(a.start));
const champRegsOldestFirst = [...champRegs].reverse().map((r) => r.id);
const regName = (id: string) => champRegs.find((r) => r.id === id)?.shortName ?? id;

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
      {/* Which game's Pokédex: one scrollable row on phones, wrapping on wider screens. */}
      <div className="scrollbar-thin -mx-3 flex items-center gap-1 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:rounded-xl sm:border sm:border-border sm:bg-surface sm:p-2" role="group" aria-label="Pokédex">
        {BOOKS.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={b.id === book.id}
            onClick={() => setBook(b.id)}
            title={`${b.region} · ${b.games}`}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 transition-colors pointer-coarse:h-11',
              b.id === book.id ? 'bg-accent/15 text-fg ring-1 ring-accent' : 'text-muted hover:bg-surface-2 hover:text-fg',
              ((b.game && b.gen === 7) || b.id === 'gen1') && 'sm:ml-1',
            )}
          >
            {b.id === 'champions' ? (
              <span className="text-sm font-semibold">Champions</span>
            ) : (
              <>
                <GenBadge gen={b.gen} size="xs" />
                <span className="text-sm font-medium">{b.label}</span>
              </>
            )}
          </button>
        ))}
      </div>
      {dexState.status === 'ready' && data ? (
        <PokedexBody key={book.id} book={book} dex={dexState.dex} data={data.dex} learn={data.learn} format={format} />
      ) : (
        dexState.status === 'error' ? <p role="alert" className="p-10 text-center text-sm text-bad">{dexState.error}</p> : <LoadingState label={`Loading the ${book.region} Pokédex…`} />
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
  const [megaOnly, setMegaOnly] = useState(false);
  const spriteSet = book.spriteSet;
  const champions = book.id === 'champions';

  // The Champions book is regulation-scoped (its roster changes every regulation); every other book
  // shows the full generation/game roster regardless of the active team's clauses. The book can be
  // picked independently of the active team's own format (e.g. browsing Champions while your team is
  // a Gen 9 one), so its regulation comes from the active team's format only when that IS a Champions
  // format — otherwise from whichever regulation is currently live.
  const defaultRegulationId = format.datasetId === 'champions' ? format.regulationId : currentRegulation()?.id;
  // The Champions book can also be browsed as it was in an older regulation.
  const [pickedRegulation, setPickedRegulation] = useState<string | undefined>();
  const championsRegulationId = pickedRegulation ?? defaultRegulationId;
  const all = useMemo(
    () => (champions && megaOnly ? megaList(dex, championsRegulationId) : dex.selectableSpecies(champions ? championsRegulationId : undefined)),
    [dex, champions, megaOnly, championsRegulationId],
  );
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
      <aside className={cn('rounded-xl border border-border bg-surface lg:sticky lg:top-[72px] lg:self-start', current && 'hidden lg:block')}>
        <div className="space-y-2 border-b border-border p-3">
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border-strong/60 pointer-coarse:h-11 bg-surface-2 px-2.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
            <Search size={15} className="text-muted" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, number or category…"
              aria-label="Search the Pokédex"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted focus-visible:outline-none sm:text-sm"
            />
          </label>
          <div className="flex gap-1.5">
            <Select aria-label="Numbering" value={order} onChange={(e) => setOrder(e.target.value)}>
              <option value="national">National Dex</option>
              {data.dexes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} Dex
                </option>
              ))}
            </Select>
          </div>
          <TypeFilter types={dex.types} value={type || null} onChange={(t) => setType(t ?? '')} label="Filter by type" noun="Pokémon" wrap />
          <label className="flex min-h-8 items-center gap-2 text-sm text-muted">
            {data.areas.length > 0 && (
              <>
                <input type="checkbox" checked={wildOnly} onChange={(e) => setWildOnly(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                Found in the wild in {book.games.split(' · ').length > 1 ? 'these games' : 'this game'}
              </>
            )}
            <span className="ml-auto font-mono text-xs" aria-label={`${list.length} Pokémon listed`}>{list.length}</span>
          </label>
          {champions && (
            <div className="space-y-2">
              <ChipRow label="Show">
                <Toggle pressed={!megaOnly} onClick={() => setMegaOnly(false)}>Pokémon</Toggle>
                <Toggle pressed={megaOnly} onClick={() => setMegaOnly(true)} title="Mega Evolutions, a Pokémon's Megas side by side">Mega Evolutions</Toggle>
              </ChipRow>
              <Select aria-label="Regulation" value={championsRegulationId ?? ''} onChange={(e) => setPickedRegulation(e.target.value)}>
                {champRegs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.id === currentRegulation()?.id ? ' (live)' : ''}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        <div ref={listRef} className="scrollbar-thin max-h-[calc(100dvh-280px)] min-h-64 overflow-y-auto p-1.5" role="listbox" aria-label="Pokémon">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={s.id === current?.id}
              aria-current={s.id === current?.id}
              onClick={() => select(book.id, s.id)}
              className={cn(
                'flex min-h-10 w-full items-center gap-2 rounded-lg px-1.5 py-0.5 text-left text-sm pointer-coarse:min-h-12',
                s.id === current?.id ? 'bg-accent/15 text-fg' : 'hover:bg-surface-2',
              )}
            >
              <span className="w-10 font-mono text-xs text-muted">{String(number(s)).padStart(3, '0')}</span>
              <Sprite speciesId={s.id} name={s.name} types={s.types} set={spriteSet} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{s.name}</span>
                {s.isMega && (
                  <span className="block truncate text-[11px] text-muted">
                    {megaStoneName(dex, s)} · since {regName(introducedIn(s, champRegsOldestFirst) ?? '')}
                  </span>
                )}
              </span>
              <span className="flex gap-0.5">
                {s.types.map((t) => (
                  <span key={t} role="img" className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_COLORS[t] }} title={t} aria-label={t} />
                ))}
              </span>
            </button>
          ))}
          {!list.length && <p className="p-4 text-center text-sm text-muted">No {megaOnly ? 'Mega Evolutions' : 'Pokémon'} match these filters.</p>}
        </div>
      </aside>

      <div className={cn('min-w-0', !current && 'hidden lg:block')}>
        {current ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => select(book.id, undefined)} className="mb-2 -ml-2 lg:hidden">
              <ArrowLeft size={15} aria-hidden /> All Pokémon
            </Button>
            <PokedexDetail key={current.id} species={current} dex={dex} data={data} learn={learn} book={book} format={format} onSelect={(id) => select(book.id, id)} />
          </>
        ) : (
          <EmptyState icon={BookOpen} title="Pick a Pokémon" className="h-64 justify-center">
            See its Pokédex entry, moves and where to find it.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
