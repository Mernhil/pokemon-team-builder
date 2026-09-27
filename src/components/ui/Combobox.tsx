import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { toID } from '@/data/dex';
import { cn } from './primitives';

export interface ComboOption {
  id: string;
  label: string;
  /** Extra text used for matching (e.g. type, category). */
  keywords?: string;
  render?: ReactNode;
  disabled?: boolean;
}

interface Props {
  options: ComboOption[];
  value?: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
  invalid?: boolean;
  limit?: number;
  /** Icon for the currently selected option, shown inside the closed input (e.g. an item sprite). */
  icon?: ReactNode;
  'aria-label'?: string;
}

/** Lightweight accessible autocomplete (ARIA combobox pattern). */
export function Combobox({ options, value, onChange, placeholder, allowClear, className, invalid, limit = 80, icon, ...aria }: Props) {
  const selected = options.find((o) => o.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filtered = useMemo(() => {
    const q = toID(query);
    if (!q) return options.slice(0, limit);
    const starts: ComboOption[] = [];
    const contains: ComboOption[] = [];
    for (const o of options) {
      const id = toID(o.label);
      if (id.startsWith(q)) starts.push(o);
      else if (id.includes(q) || (o.keywords && toID(o.keywords).includes(q))) contains.push(o);
    }
    return [...starts, ...contains].slice(0, limit);
  }, [options, query, limit]);

  useEffect(() => setHi(0), [query, open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const commit = (o?: ComboOption) => {
    if (o && !o.disabled) onChange(o.id);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  };

  return (
    <div className={cn('relative', className)}>
      {icon && !open && value && (
        <div className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2">{icon}</div>
      )}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={aria['aria-label']}
        className={cn(
          'h-9 w-full rounded-md border bg-surface-2 px-2.5 pr-7 text-sm outline-none placeholder:text-muted',
          'focus:border-accent focus:ring-2 focus:ring-accent/25',
          icon && !open && value && 'pl-8',
          invalid ? 'border-bad' : 'border-border',
        )}
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : selected?.label ?? ''}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.min(filtered.length - 1, h + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(0, h - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            commit(filtered[hi]);
          } else if (e.key === 'Escape') {
            setOpen(false);
            setQuery('');
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
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="scrollbar-thin absolute z-40 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-lg border border-border bg-surface p-1 shadow-xl"
        >
          {filtered.length === 0 && <li className="px-2 py-1.5 text-sm text-muted">No matches</li>}
          {filtered.map((o, i) => (
            <li
              key={o.id}
              data-idx={i}
              role="option"
              aria-selected={o.id === value}
              aria-disabled={o.disabled}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(o);
              }}
              onMouseEnter={() => setHi(i)}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1.5 text-sm',
                i === hi && 'bg-surface-2',
                o.id === value && 'font-semibold text-accent',
                o.disabled && 'cursor-not-allowed opacity-40',
              )}
            >
              {o.render ?? o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
