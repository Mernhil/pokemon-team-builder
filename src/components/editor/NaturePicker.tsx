import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Leaf } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { STAT_LABELS, type StatId } from '@/domain/types';
import { usePickerPrefs, usePrefsStore } from '@/store/prefsStore';
import { cn } from '../ui/styles';
import { STAT_COLOR_VAR } from '../ui/color';

/** The five stats a nature can raise/lower, in the same order the games' Mint grid uses. */
const GRID_STATS: StatId[] = ['atk', 'def', 'spa', 'spd', 'spe'];

/**
 * Nature picker as the games show Mints: a 5×5 grid of "+stat / −stat" instead of an alphabetical
 * list of 25 names, so the effect is a glance instead of a read.
 */
export function NaturePicker({ dex, value, onChange }: { dex: Dex; value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = dex.nature(value);
  const neutral = !current?.plus && !current?.minus;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const natureAt = (plus: StatId, minus: StatId) => dex.natures.find((n) => n.plus === plus && n.minus === minus);
  const recent = usePickerPrefs('natures').recent.map((n) => dex.nature(n)).filter((n) => !!n);
  const pick = (name: string) => {
    usePrefsStore.getState().addRecent('natures', name);
    onChange(name);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className="flex h-9 w-full items-center gap-1.5 rounded-full border-2 border-accent/50 bg-accent/10 px-2.5 pointer-coarse:h-11 text-left text-sm outline-none hover:border-accent/70 focus:border-accent focus:ring-2 focus:ring-accent/25"
      >
        <Leaf size={14} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <b className="font-semibold">{current?.name ?? value}</b>{' '}
          {neutral ? (
            <span className="text-muted">(neutral)</span>
          ) : (
            <span className="text-muted">
              <span style={{ color: STAT_COLOR_VAR[current!.plus!] }}>+{STAT_LABELS[current!.plus!]}</span>{' '}
              <span style={{ color: STAT_COLOR_VAR[current!.minus!] }}>−{STAT_LABELS[current!.minus!]}</span>
            </span>
          )}
        </span>
        <ChevronDown size={14} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute z-40 mt-1 rounded-lg border border-border bg-surface p-2.5 shadow-xl">
          {recent.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1" role="group" aria-label="Recent natures">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Recent</span>
              {recent.map((n) => (
                <button
                  key={n.name}
                  type="button"
                  onClick={() => pick(n.name)}
                  aria-current={current?.name === n.name}
                  className={cn(
                    'rounded-md border px-1.5 py-0.5 text-[10px] font-semibold',
                    current?.name === n.name ? 'border-accent bg-accent/15' : 'border-border/60 hover:border-muted',
                  )}
                >
                  {n.name}
                  {n.plus && n.plus !== n.minus && (
                    <span className="ml-1 font-normal text-muted">
                      +{STAT_LABELS[n.plus]} −{STAT_LABELS[n.minus!]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          <table className="border-separate [border-spacing:2px]">
            <thead>
              <tr>
                {/* Two leading spacer cells, matching the body's "lowers" label column (rowSpan from row 0) and each row's own stat-label column. */}
                <th className="w-4 p-0" />
                <th className="w-10 p-0" />
                <th colSpan={GRID_STATS.length} className="pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-good">
                  <span className="inline-flex items-center gap-0.5">
                    <ArrowUp size={10} aria-hidden /> raises
                  </span>
                </th>
              </tr>
              <tr>
                <th className="p-0" />
                <th className="p-0" />
                {GRID_STATS.map((s) => (
                  <th key={s} className="px-1 pb-1 text-center text-[10px] font-bold" style={{ color: STAT_COLOR_VAR[s] }}>
                    {STAT_LABELS[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GRID_STATS.map((minus, ri) => (
                <tr key={minus}>
                  {ri === 0 && (
                    <th rowSpan={GRID_STATS.length} className="w-4 p-0 align-middle text-bad">
                      <span className="flex flex-col items-center gap-0.5">
                        <ArrowDown size={10} aria-hidden />
                        <span className="text-[10px] font-semibold uppercase tracking-wider [writing-mode:vertical-lr]">
                          <span className="rotate-180">lowers</span>
                        </span>
                      </span>
                    </th>
                  )}
                  <th className="px-1 text-right text-[10px] font-bold" style={{ color: STAT_COLOR_VAR[minus] }}>
                    {STAT_LABELS[minus]}
                  </th>
                  {GRID_STATS.map((plus) => {
                    if (plus === minus) {
                      const isCurrent = neutral && ri === 0;
                      return (
                        <td key={plus}>
                          <button
                            type="button"
                            onClick={() => pick('Hardy')}
                            title="Neutral: no stat is raised or lowered"
                            aria-current={isCurrent}
                            className={cn(
                              'flex h-9 w-12 items-center justify-center rounded-md border text-[10px] text-muted',
                              isCurrent ? 'border-accent bg-accent/15 text-fg' : 'border-border/60 hover:border-muted',
                            )}
                          >
                            •
                          </button>
                        </td>
                      );
                    }
                    const n = natureAt(plus, minus);
                    if (!n) return <td key={plus} />;
                    const isCurrent = current?.name === n.name;
                    return (
                      <td key={plus}>
                        <button
                          type="button"
                          onClick={() => pick(n.name)}
                          title={`${n.name}: +${STAT_LABELS[plus]} −${STAT_LABELS[minus]}`}
                          aria-current={isCurrent}
                          className={cn(
                            'flex h-9 w-12 items-center justify-center rounded-md border text-[10px] font-semibold leading-tight',
                            isCurrent ? 'border-accent bg-accent/15 text-fg' : 'border-border/60 hover:border-muted',
                          )}
                        >
                          {n.name}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 max-w-56 text-center text-[10px] text-muted">Column = stat raised 10%, row = stat lowered 10%. Center dot = a neutral nature.</p>
        </div>
      )}
    </div>
  );
}
