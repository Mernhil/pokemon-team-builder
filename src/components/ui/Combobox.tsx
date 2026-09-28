import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Star, X } from 'lucide-react';
import { rankSearch } from '@/domain/pickerOrder';
import { cn } from './styles';

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
 * keyword, ties keeping the caller's order.
 */
export function Combobox({
  options,
  groups,
  value,
  onChange,
  placeholder,
  allowClear,
  className,
  invalid,
  limit = 100,
  icon,
  favorites,
  onToggleFavorite,
  toolbar,
  ...aria
}: Props) {
  const curated = useMemo<ComboGroup[]>(() => groups ?? [{ id: 'all', label: '', options: options ?? [] }], [groups, options]);
  const flat = useMemo(() => {
    const seen = new Set<string>();
    return curated.flatMap((g) => g.options).filter((o) => !seen.has(o.id) && (seen.add(o.id), true));
  }, [curated]);
  const selected = flat.find((o) => o.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const [shown, setShown] = useState(limit);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const favSet = useMemo(() => new Set(favorites ?? []), [favorites]);

  // Sections with a running index over the visible rows (keyboard highlight works on that index).
  const { sections, rows, total } = useMemo(() => {
    const src: ComboGroup[] = query.trim()
      ? [{ id: 'results', label: '', options: rankSearch(flat, query, (o) => o.label, (o) => o.keywords) }]
      : curated;
    const out: Section[] = [];
    const rowList: ComboOption[] = [];
    let count = 0;
    for (const g of src) {
      if (rowList.length >= shown) break;
      const take = g.options.slice(0, shown - rowList.length);
      out.push({ id: g.id, label: g.label, options: take.map((o) => ({ o, idx: rowList.push(o) - 1 })) });
    }
    for (const g of src) count += g.options.length;
    return { sections: out, rows: rowList, total: count };
  }, [curated, flat, query, shown]);

  const optionId = (i: number) => `${listId}-o${i}`;
  const moveHi = (i: number) => {
    const next = Math.max(0, Math.min(total - 1, i));
    if (next >= shown - 5) setShown((n) => n + limit);
    setHi(next);
    // Scroll after React has rendered any newly revealed rows.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' }));
  };
  const openList = () => {
    if (!open) {
      setHi(0);
      setShown(limit);
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
        aria-activedescendant={open && rows[hi] ? optionId(hi) : undefined}
        aria-label={aria['aria-label']}
        title={onToggleFavorite ? 'Alt+F: add or remove the highlighted entry from Favorites' : undefined}
        className={cn(
          'h-9 w-full rounded-md border bg-surface-2 px-2.5 pr-7 text-sm outline-none placeholder:text-muted',
          'focus:border-accent focus:ring-2 focus:ring-accent/25',
          icon && !open && value && 'pl-8',
          invalid ? 'border-bad' : 'border-border',
        )}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : (selected?.label ?? '')}
        onFocus={openList}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
          setShown(limit);
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
        <button
          type="button"
          aria-label="Clear"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted hover:text-fg"
          onClick={() => onChange('')}
        >
          <X size={14} />
        </button>
      )}
      {open && (
        <div className="absolute z-40 mt-1 w-full min-w-64 overflow-hidden rounded-lg border border-border bg-surface shadow-xl">
          {toolbar && (
            // Keep focus in the input while using the toolbar, so the list stays open.
            <div className="border-b border-border px-2 py-1.5" onMouseDown={(e) => e.preventDefault()}>
              {toolbar}
            </div>
          )}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={aria['aria-label']}
            className="scrollbar-thin max-h-72 overflow-auto overscroll-contain p-1"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (rows.length < total && el.scrollTop + el.clientHeight > el.scrollHeight - 200) setShown((n) => n + limit);
            }}
          >
            {rows.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">No matches</li>}
            {sections.map((sec) => (
              <li key={sec.id} role="presentation">
                {sec.label && (
                  <div
                    id={`${listId}-${sec.id}`}
                    className="sticky top-0 z-10 -mx-1 bg-surface/95 px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted backdrop-blur"
                  >
                    {sec.label}
                  </div>
                )}
                <ul role="group" aria-labelledby={sec.label ? `${listId}-${sec.id}` : undefined}>
                  {sec.options.map(({ o, idx }) => (
                    <li
                      key={o.id}
                      id={optionId(idx)}
                      data-idx={idx}
                      role="option"
                      aria-selected={o.id === value}
                      aria-disabled={o.disabled}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        commit(o);
                      }}
                      onMouseEnter={() => setHi(idx)}
                      className={cn(
                        'flex cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-sm',
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
                          aria-label={`${favSet.has(o.id) ? 'Remove' : 'Add'} ${o.label} ${favSet.has(o.id) ? 'from' : 'to'} Favorites`}
                          aria-pressed={favSet.has(o.id)}
                          className={cn(
                            'shrink-0 rounded p-1 text-muted hover:text-warn',
                            favSet.has(o.id) ? 'text-warn' : 'opacity-40 hover:opacity-100',
                          )}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onToggleFavorite(o.id);
                          }}
                        >
                          <Star size={13} fill={favSet.has(o.id) ? 'currentColor' : 'none'} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
