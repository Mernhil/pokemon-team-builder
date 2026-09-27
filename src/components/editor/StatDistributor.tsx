import { useState } from 'react';
import { Minus, Plus, RotateCcw, Sparkles, Target } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { calcStats, natureModifier, spendBudget, spForTarget, sumStats } from '@/domain/stats';
import {
  STAT_IDS,
  STAT_LABELS,
  type FormatRules,
  type Pokemon,
  type PokemonSet,
  type StatId,
  type StatTable,
} from '@/domain/types';
import { Button, STAT_COLOR_VAR, cn } from '../ui/primitives';

interface Props {
  set: PokemonSet;
  species: Pokemon;
  mega?: Pokemon;
  format: FormatRules;
  dex: Dex;
  onSpread: (stat: StatId, value: number) => void;
  onReplaceSpread: (spread: StatTable) => void;
  onNature: (nature: string) => void;
  /** Whether the Mega forme is the one shown (controlled; shared with the battle Mega toggle). */
  megaActive?: boolean;
  onMegaActive?: (on: boolean) => void;
}

const PRESETS: { label: string; sp: Partial<StatTable> }[] = [
  { label: 'Physical sweeper', sp: { hp: 2, atk: 32, spe: 32 } },
  { label: 'Special sweeper', sp: { hp: 2, spa: 32, spe: 32 } },
  { label: 'Bulky physical', sp: { hp: 32, atk: 32, def: 2 } },
  { label: 'Bulky special', sp: { hp: 32, spa: 32, spd: 2 } },
  { label: 'Max bulk', sp: { hp: 32, def: 17, spd: 17 } },
  { label: 'Trick Room', sp: { hp: 32, atk: 32, def: 2 } },
];

const BASE_BAR_MAX = 200;

/**
 * Champions Stat Point distributor: 0–32 SP per stat, 66 SP pool, live Lv 50 stats.
 * Inline +/− buttons on each stat set the Stat Alignment (nature) Showdown-style.
 */
export function StatDistributor({ set, species, mega, format, dex, onSpread, onReplaceSpread, onNature, megaActive, onMegaActive }: Props) {
  const [localMega, setLocalMega] = useState(true);
  const sys = format.statSystem;
  if (sys.kind !== 'champions-sp') {
    return <p className="text-sm text-muted">EV / IV distributor for {format.name} arrives in Phase 2.</p>;
  }
  const nature = dex.nature(set.nature);
  // With a Mega Stone, one forme is "shown" (base stats, main column, speed tools) and the other
  // stays visible in a smaller comparison column.
  const showMega = !!mega && (megaActive ?? localMega);
  const setShowMega = onMegaActive ?? setLocalMega;
  const shown = showMega ? mega! : species;
  const other = mega ? (showMega ? species : mega) : undefined;
  const stats = calcStats(shown.baseStats, set, format, nature);
  const otherStats = other ? calcStats(other.baseStats, set, format, nature) : undefined;
  const otherLabel = showMega ? 'Base' : 'Mega';
  const budget = spendBudget(sys, set.sp)!;
  const pct = Math.min(100, (budget.used / budget.cap) * 100);

  const toggleAlign = (stat: StatId, dir: 'plus' | 'minus') => {
    const neutral = !nature?.plus || nature.plus === nature.minus;
    let plus: StatId | undefined = neutral ? undefined : nature!.plus;
    let minus: StatId | undefined = neutral ? undefined : nature!.minus;
    // Default partner when only one side is chosen: trade away the unused attacking stat.
    const partner = (x: StatId): StatId => (x === 'spa' ? 'atk' : 'spa');
    if (dir === 'plus') {
      if (plus === stat) plus = minus = undefined;
      else {
        plus = stat;
        if (!minus || minus === stat) minus = partner(stat);
      }
    } else {
      if (minus === stat) plus = minus = undefined;
      else {
        minus = stat;
        if (!plus || plus === stat) plus = partner(stat);
      }
    }
    const match = plus
      ? dex.natures.find((n) => n.plus === plus && n.minus === minus)
      : dex.natures.find((n) => !n.plus);
    if (match) onNature(match.name);
  };

  return (
    <div className="@container space-y-3">
      {/* Budget meter */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="flex items-center gap-2">
            <span className="font-semibold uppercase tracking-wider text-muted">Stat Points</span>
            {mega && (
              <span role="group" aria-label="Stats shown for" className="inline-flex rounded-md bg-surface-2 p-0.5 text-[11px] font-semibold">
                {[false, true].map((m) => (
                  <button
                    key={String(m)}
                    type="button"
                    aria-pressed={showMega === m}
                    title={m ? `Show ${mega.name} stats` : `Show ${species.name} stats`}
                    onClick={() => setShowMega(m)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors',
                      showMega === m ? 'bg-surface shadow-sm' : 'text-muted hover:text-fg',
                      showMega === m && m && 'text-accent',
                    )}
                  >
                    {m && <Sparkles size={11} />}
                    {m ? 'Mega' : 'Base'}
                  </button>
                ))}
              </span>
            )}
          </span>
          <span className="font-mono tabular-nums">
            <span
              className={cn(
                'text-base font-bold',
                budget.status === 'over' && 'text-bad',
                budget.status === 'complete' && 'text-good',
              )}
            >
              {budget.used}
            </span>
            <span className="text-muted"> / {budget.cap} · </span>
            <span className={cn(budget.status === 'complete' ? 'text-good' : budget.status === 'over' ? 'text-bad' : 'text-fg')}>
              {budget.status === 'complete' ? 'complete' : `${budget.remaining} left`}
            </span>
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={budget.cap} aria-valuenow={budget.used} aria-label="Stat Points used">
          <div
            className={cn('h-full rounded-full transition-all', budget.status === 'complete' ? 'bg-good' : budget.status === 'over' ? 'bg-bad' : 'bg-accent')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Rows — grid when wide, two-line cards in narrow containers (phones, calc columns) */}
      <div className="text-sm">
        <div className={cn('hidden gap-x-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted @xl:grid', otherStats ? '@xl:grid-cols-[88px_120px_1fr_104px_48px_48px]' : '@xl:grid-cols-[88px_120px_1fr_104px_48px]')}>
          <span>Stat</span>
          <span>Base</span>
          <span>SP (0–{sys.perStatCap})</span>
          <span className="text-center">SP</span>
          <span className={cn('text-right', showMega && 'text-accent')}>{showMega ? 'Mega' : 'Lv50'}</span>
          {otherStats && <span className="text-right">{otherLabel}</span>}
        </div>
        <div className="divide-y divide-border/60 @xl:divide-y-0">
          {STAT_IDS.map((s) => {
            const base = shown.baseStats[s];
            const mod = natureModifier(s, nature);
            const val = set.sp[s];
            const room = Math.min(sys.perStatCap, val + Math.max(0, budget.remaining));
            const tone = cn(mod === 1.1 && 'text-bad', mod === 0.9 && 'text-accent');
            return (
              <div
                key={s}
                className={cn(
                  'grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 py-2 @xl:py-1',
                  otherStats ? '@xl:grid-cols-[88px_120px_1fr_104px_48px_48px]' : '@xl:grid-cols-[88px_120px_1fr_104px_48px]',
                )}
              >
                {/* label + alignment */}
                <div className="flex items-center gap-1">
                  <span className="w-8 font-semibold" style={{ color: STAT_COLOR_VAR[s] }}>
                    {STAT_LABELS[s]}
                  </span>
                  {s !== 'hp' && (
                    <span className="flex gap-0.5">
                      <button
                        type="button"
                        title={`Boost ${STAT_LABELS[s]} (+10%)`}
                        aria-label={`Boost ${STAT_LABELS[s]} (+10%)`}
                        aria-pressed={mod === 1.1}
                        onClick={() => toggleAlign(s, 'plus')}
                        className={cn('h-5 w-5 rounded text-[11px] leading-none font-bold', mod === 1.1 ? 'bg-bad text-white' : 'text-muted hover:bg-surface-2')}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        title={`Lower ${STAT_LABELS[s]} (−10%)`}
                        aria-label={`Lower ${STAT_LABELS[s]} (−10%)`}
                        aria-pressed={mod === 0.9}
                        onClick={() => toggleAlign(s, 'minus')}
                        className={cn('h-5 w-5 rounded text-[11px] leading-none font-bold', mod === 0.9 ? 'bg-accent text-white' : 'text-muted hover:bg-surface-2')}
                      >
                        −
                      </button>
                    </span>
                  )}
                </div>
                {/* base */}
                <div className="flex items-center gap-2">
                  <span className="w-7 text-right font-mono text-xs tabular-nums text-muted @xl:text-fg">{base}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (base / BASE_BAR_MAX) * 100)}%`, background: STAT_COLOR_VAR[s] }} />
                  </div>
                </div>
                {/* final stat (phones: top-right) */}
                <div className={cn('text-right font-mono text-base font-bold tabular-nums @xl:hidden', tone)}>
                  {stats[s]}
                  {otherStats && <span className="ml-1.5 text-xs font-normal text-muted">{otherLabel} {otherStats[s]}</span>}
                </div>
                {/* slider */}
                <div className="col-span-2 @xl:col-span-1 @xl:px-1">
                  <input
                    type="range"
                    className="stat-range w-full"
                    min={0}
                    max={sys.perStatCap}
                    step={1}
                    value={val}
                    aria-label={`${STAT_LABELS[s]} Stat Points`}
                    onChange={(e) => onSpread(s, Number(e.target.value))}
                    style={{ ['--fill' as string]: STAT_COLOR_VAR[s], ['--pct' as string]: `${(val / sys.perStatCap) * 100}%` }}
                  />
                </div>
                {/* numeric */}
                <div className="flex items-center justify-end gap-0.5 @xl:justify-center">
                  <button type="button" aria-label={`Decrease ${STAT_LABELS[s]}`} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30" disabled={val <= 0} onClick={() => onSpread(s, val - 1)}>
                    <Minus size={12} />
                  </button>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={sys.perStatCap}
                    value={val}
                    aria-label={`${STAT_LABELS[s]} Stat Points value`}
                    onChange={(e) => onSpread(s, Number(e.target.value))}
                    onFocus={(e) => e.target.select()}
                    className={cn(
                      'no-spin h-7 w-10 rounded border bg-surface-2 text-center font-mono text-sm tabular-nums outline-none focus:border-accent',
                      val === sys.perStatCap ? 'border-good/60' : 'border-border',
                    )}
                  />
                  <button type="button" aria-label={`Increase ${STAT_LABELS[s]}`} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30" disabled={val >= room} onClick={() => onSpread(s, val + 1)}>
                    <Plus size={12} />
                  </button>
                </div>
                {/* final stat (desktop columns) */}
                <div className={cn('hidden text-right font-mono text-base font-bold tabular-nums @xl:block', tone)}>{stats[s]}</div>
                {otherStats && <div className="hidden text-right font-mono tabular-nums text-muted @xl:block">{otherStats[s]}</div>}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between border-t border-border pt-1.5 font-mono text-xs text-muted">
          <span>
            {showMega ? `${shown.name} base` : 'Base'} total {sumStats(shown.baseStats)}
          </span>
          <span>
            Lv50 total <b className={showMega ? 'text-accent' : 'text-fg'}>{sumStats(stats)}</b>
            {otherStats && (
              <>
                {' '}· {otherLabel} <b className="text-fg">{sumStats(otherStats)}</b>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Tools */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => onReplaceSpread({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })}>
          <RotateCcw size={12} /> Reset
        </Button>
        {PRESETS.map((p) => (
          <Button key={p.label} size="sm" onClick={() => onReplaceSpread({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...p.sp })}>
            {p.label}
          </Button>
        ))}
      </div>
      <SpeedBenchmark mega={showMega} set={set} species={shown} format={format} dex={dex} onSpread={onSpread} speed={stats.spe} />
    </div>
  );
}

function SpeedBenchmark({
  mega,
  set,
  species,
  format,
  dex,
  onSpread,
  speed,
}: {
  mega: boolean;
  set: PokemonSet;
  species: Pokemon;
  format: FormatRules;
  dex: Dex;
  onSpread: (stat: StatId, value: number) => void;
  speed: number;
}) {
  const [target, setTarget] = useState('');
  const sys = format.statSystem;
  if (sys.kind !== 'champions-sp') return null;
  const t = parseInt(target, 10);
  const need = Number.isFinite(t) ? spForTarget('spe', species.baseStats.spe, t, sys.perStatCap, dex.nature(set.nature)) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
      <span className="font-mono tabular-nums">
        <span className="text-muted">{mega ? 'Mega Spe' : 'Spe'}</span> <b>{speed}</b>
        <span className="text-muted"> · Tailwind </span>
        <b>{speed * 2}</b>
        <span className="text-muted"> · Scarf </span>
        <b>{Math.floor(speed * 1.5)}</b>
        <span className="text-muted"> · −1 </span>
        <b>{Math.floor((speed * 2) / 3)}</b>
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Target size={12} className="text-muted" />
        <span className="text-muted">Hit Spe ≥</span>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))}
          placeholder="e.g. 150"
          aria-label="Target speed"
          className="h-6 w-20 rounded border border-border bg-surface px-1.5 font-mono outline-none focus:border-accent"
        />
        {need !== undefined &&
          (need === null ? (
            <span className="text-bad">unreachable</span>
          ) : (
            <Button size="sm" variant="primary" className="h-6" onClick={() => onSpread('spe', need)}>
              Set {need} SP
            </Button>
          ))}
      </span>
    </div>
  );
}
