import { useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, Search, Star, X } from 'lucide-react';
import { rankSearch } from '@/domain/pickerOrder';
import { buttonClass, cn, overlayClass } from './styles';
import { useIsPhone } from './useMedia';

export interface ComboOption {
  id: string;
  label: string;
  /** Extra text used for matching (e.g. type, category). */
  keywords?: string;
  render?: ReactNode;
  disabled?: boolean;
}

/** A labelled section of the list (shown with a sticky header while the search box is empty). */
export interface ComboGroup {
  id: string;
  label: string;
  options: ComboOption[];
}

interface Props {
  /** Flat list, in the order to show it. Use `groups` instead for a sectioned list. */
  options?: ComboOption[];
  groups?: ComboGroup[];
  value?: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
  invalid?: boolean;
  /** Rows rendered at first; more are added as the list scrolls (long Pokédexes stay fast). */
  limit?: number;
  /** Icon for the currently selected option, shown inside the closed input (e.g. an item sprite). */
  icon?: ReactNode;
  /** Ids shown with a filled star; with `onToggleFavorite`, every row gets a star button (and Alt+F). */
  favorites?: readonly string[];
  onToggleFavorite?: (id: string) => void;
  /** Controls pinned above the list (e.g. a Grouped / A–Z switch). */
  toolbar?: ReactNode;
  'aria-label'?: string;
}

interface Section {
  id: string;
  label: string;
  options: { o: ComboOption; idx: number }[];
}

/**
 * Accessible autocomplete (ARIA combobox pattern). Empty search: the caller's groups, in order,
 * under sticky headers. Typed search: one list ranked exact > prefix > word start > substring >
 * keyword, ties keeping the caller's order. On phones it opens as a bottom sheet with the search
 * box at the top, so the on-screen keyboard never covers it.
 */
export function Combobox(props: Props) {
  return useIsPhone() ? <SheetCombobox {...props} /> : <PopoverCombobox {...props} />;
}

/** Everything both presentations share: filtering, ranking, sections and incremental rendering. */
function useComboList({ options, groups, limit = 100 }: Pick<Props, 'options' | 'groups' | 'limit'>, query: string) {
  const curated = useMemo<ComboGroup[]>(() => groups ?? [{ id: 'all', label: '', options: options ?? [] }], [groups, options]);
  const flat = useMemo(() => {
    const seen = new Set<string>();
    return curated.flatMap((g) => g.options).filter((o) => !seen.has(o.id) && (seen.add(o.id), true));
  }, [curated]);
  const [shown, setShown] = useState(limit);
  const { sections, rows, total } = useMemo(() => {
    const src: ComboGroup[] = query.trim()
      ? [{ id: 'results', label: '', options: rankSearch(flat, query, (o) => o.label, (o) => o.keywords) }]
      : curated;
    const out: Section[] = [];
    const rowList: ComboOption[] = [];
    for (const g of src) {
      if (rowList.length >= shown) break;
      const take = g.options.slice(0, shown - rowList.length);
      out.push({ id: g.id, label: g.label, options: take.map((o) => ({ o, idx: rowList.push(o) - 1 })) });
    }
    return { sections: out, rows: rowList, total: src.reduce((n, g) => n + g.options.length, 0) };
  }, [curated, flat, query, shown]);
  return { flat, sections, rows, total, shown, showMore: () => setShown((n) => n + limit), resetShown: () => setShown(limit) };
}

/** The listbox itself: sticky group headers, rows, favourite stars. */
function OptionList({
  listId,
  sections,
  rows,
  total,
  value,
  hi,
  onHover,
  onPick,
  onNearEnd,
  favorites,
  onToggleFavorite,
  label,
  className,
  listRef,
}: {
  listId: string;
  sections: Section[];
  rows: ComboOption[];
  total: number;
  value?: string;
  hi: number;
  onHover?: (i: number) => void;
  onPick: (o: ComboOption) => void;
  onNearEnd: () => void;
  favorites?: readonly string[];
  onToggleFavorite?: (id: string) => void;
  label?: string;
  className?: string;
  listRef?: Ref<HTMLUListElement>;
}) {
  const favSet = useMemo(() => new Set(favorites ?? []), [favorites]);
  return (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={label}
      className={cn('scrollbar-thin overflow-auto overscroll-contain p-1', className)}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (rows.length < total && el.scrollTop + el.clientHeight > el.scrollHeight - 200) onNearEnd();
      }}
    >
      {rows.length === 0 && <li className="px-3 py-2 text-sm text-muted">No matches</li>}
      {sections.map((sec) => (
        <li key={sec.id} role="presentation">
          {sec.label && (
            <div
              id={`${listId}-${sec.id}`}
              className="sticky top-0 z-10 -mx-1 bg-surface/95 px-3 pt-1.5 pb-1 text-2xs font-semibold tracking-wider text-muted uppercase backdrop-blur"
            >
              {sec.label}
            </div>
          )}
          <ul role="group" aria-labelledby={sec.label ? `${listId}-${sec.id}` : undefined}>
            {sec.options.map(({ o, idx }) => {
              const fav = favSet.has(o.id);
              return (
                <li
                  key={o.id}
                  id={`${listId}-o${idx}`}
                  data-idx={idx}
                  role="option"
                  aria-selected={o.id === value}
                  aria-disabled={o.disabled}
                  // Keep focus in the search box while picking.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(o)}
                  onMouseEnter={() => onHover?.(idx)}
                  className={cn(
                    'flex min-h-9 cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-sm pointer-coarse:min-h-12',
                    idx === hi && 'bg-surface-2',
                    o.id === value && 'font-semibold text-accent',
                    o.disabled && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <div className="min-w-0 flex-1">{o.render ?? o.label}</div>
                  {onToggleFavorite && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`${fav ? 'Remove' : 'Add'} ${o.label} ${fav ? 'from' : 'to'} Favorites`}
                      aria-pressed={fav}
                      className={cn('hit shrink-0 rounded p-1.5 text-muted hover:text-warn', fav ? 'text-warn' : 'opacity-50 hover:opacity-100')}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(o.id);
                      }}
                    >
                      <Star size={14} fill={fav ? 'currentColor' : 'none'} aria-hidden />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Desktop and tablet: the input is the search box; the list drops down under it. */
function PopoverCombobox({ value, onChange, placeholder, allowClear, className, invalid, icon, favorites, onToggleFavorite, toolbar, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const { flat, sections, rows, total, shown, showMore, resetShown } = useComboList(rest, query);
  const selected = flat.find((o) => o.id === value);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const moveHi = (i: number) => {
    const next = Math.max(0, Math.min(total - 1, i));
    if (next >= shown - 5) showMore();
    setHi(next);
    // Scroll after React has rendered any newly revealed rows.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' }));
  };
  const openList = () => {
    if (!open) {
      setHi(0);
      resetShown();
    }
    setOpen(true);
  };
  const commit = (o?: ComboOption) => {
    if (o && !o.disabled) onChange(o.id);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  return (
    <div className={cn('relative', className)}>
      {icon && !open && value && <div className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2">{icon}</div>}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[hi] ? `${listId}-o${hi}` : undefined}
        aria-label={rest['aria-label']}
        title={onToggleFavorite ? 'Alt+F: add or remove the highlighted entry from Favorites' : undefined}
        className={cn(
          'h-9 w-full rounded-lg border bg-surface-2 px-2.5 pr-8 text-sm outline-none placeholder:text-muted pointer-coarse:h-11',
          'focus:border-accent focus:ring-2 focus:ring-accent/25',
          icon && !open && value && 'pl-8',
          invalid ? 'border-bad' : 'border-border-strong/60',
        )}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={openList}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
          resetShown();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) openList();
            else moveHi(hi + 1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            moveHi(hi - 1);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            commit(rows[hi]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
          } else if (e.altKey && e.code === 'KeyF' && onToggleFavorite && rows[hi]) {
            e.preventDefault();
            onToggleFavorite(rows[hi].id);
          }
        }}
      />
      {allowClear && value && !open && (
        <button type="button" aria-label="Clear" className="hit absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted hover:text-fg" onClick={() => onChange('')}>
          <X size={14} aria-hidden />
        </button>
      )}
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-64 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          {toolbar && (
            // Keep focus in the input while using the toolbar, so the list stays open.
            <div className="border-b border-border px-2 py-1.5" onMouseDown={(e) => e.preventDefault()}>
              {toolbar}
            </div>
          )}
          <OptionList
            listRef={listRef}
            listId={listId}
            sections={sections}
            rows={rows}
            total={total}
            value={value}
            hi={hi}
            onHover={setHi}
            onPick={commit}
            onNearEnd={showMore}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            label={rest['aria-label']}
            className="max-h-72"
          />
        </div>
      )}
    </div>
  );
}

/**
 * Phones: a button showing the current value; tapping it opens a bottom sheet with the search box
 * at the top and the list filling the rest (it shrinks with the keyboard, never under it).
 */
function SheetCombobox({ value, onChange, placeholder, allowClear, className, invalid, icon, favorites, onToggleFavorite, toolbar, ...rest }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { flat, sections, rows, total, showMore, resetShown } = useComboList(rest, query);
  const selected = flat.find((o) => o.id === value);
  const listId = useId();
  const label = rest['aria-label'] ?? placeholder ?? 'Choose';

  const setOpenAndReset = (o: boolean) => {
    setOpen(o);
    if (!o) setQuery('');
    else resetShown();
  };
  const pick = (o: ComboOption) => {
    if (o.disabled) return;
    onChange(o.id);
    setOpenAndReset(false);
  };

  return (
    <div className={cn('relative', className)}>
      <Dialog.Root open={open} onOpenChange={setOpenAndReset}>
        <Dialog.Trigger
          className={cn(
            'flex h-11 w-full items-center gap-2 rounded-lg border bg-surface-2 px-2.5 pr-9 text-left text-base',
            invalid ? 'border-bad' : 'border-border-strong/60',
          )}
          // The accessible name includes the visible text (WCAG 2.5.3 label in name).
          aria-label={selected ? `${label}: ${selected.label}` : placeholder && placeholder !== label ? `${label}: ${placeholder}` : label}
        >
          {icon && value && <span className="shrink-0">{icon}</span>}
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-muted')}>{selected?.label ?? placeholder ?? 'Choose…'}</span>
          {!(allowClear && value) && <ChevronDown size={16} className="absolute right-3 text-muted" aria-hidden />}
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className={overlayClass} />
          <Dialog.Content
            className="ui-sheet fixed inset-x-0 bottom-0 z-50 flex h-[88dvh] flex-col rounded-t-2xl border border-border bg-surface pb-[env(safe-area-inset-bottom)] text-fg shadow-2xl"
            onOpenAutoFocus={(e) => {
              // Focus the search box (on iOS this also brings up the keyboard, since it follows a tap).
              e.preventDefault();
              (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>('input[type="search"]')?.focus();
            }}
          >
            <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border-strong/60" aria-hidden />
            <div className="flex items-center gap-2 px-4 pt-2">
              <Dialog.Title className="flex-1 text-base font-semibold">{label}</Dialog.Title>
              <Dialog.Description className="sr-only">Search, then tap an entry to choose it.</Dialog.Description>
              <Dialog.Close className={buttonClass('ghost', 'icon', '-mr-2')} aria-label="Close">
                <X size={18} aria-hidden />
              </Dialog.Close>
            </div>
            <label className="mx-4 mt-2 flex h-11 items-center gap-2 rounded-lg border border-border-strong/60 bg-surface-2 px-3 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
              <Search size={16} className="text-muted" aria-hidden />
              <input
                type="search"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-label={`Search ${label}`}
                placeholder="Search…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  resetShown();
                }}
                onKeyDown={(e) => e.key === 'Enter' && rows[0] && pick(rows[0])}
                enterKeyHint="done"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted focus-visible:outline-none"
              />
            </label>
            {toolbar && <div className="px-4 pt-2">{toolbar}</div>}
            <OptionList
              listId={listId}
              sections={sections}
              rows={rows}
              total={total}
              value={value}
              hi={-1}
              onPick={pick}
              onNearEnd={showMore}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
              label={label}
              className="mt-2 min-h-0 flex-1 px-2 pb-4"
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {allowClear && value && (
        <button type="button" aria-label={`Clear ${label}`} className="hit absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted hover:text-fg" onClick={() => onChange('')}>
          <X size={16} aria-hidden />
        </button>
      )}
    </div>
  );
}
