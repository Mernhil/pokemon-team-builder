import { Suspense, lazy, useState } from 'react';
import { Minus, Plus, RotateCcw, Sparkles, Target } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { formatMechanics } from '@/domain/games';
import { calcStats, canOptimize, gbHpDV, investRange, investmentForTarget, lgpeFriendshipPercent, natureModifier, spendBudget, spreadKey, sumStats } from '@/domain/stats';
import {
  STAT_IDS,
  STAT_LABELS,
  type FormatRules,
  type Pokemon,
  type PokemonSet,
  type StatId,
  type StatSystem,
  type StatTable,
} from '@/domain/types';
import { useOptimizerStore } from '@/store/optimizerStore';
import { Button } from '../ui/primitives';
// The optimiser pulls in the damage calculator, so it loads when first opened.
const OptimizerPanel = lazy(() => import('./OptimizerPanel').then((m) => ({ default: m.OptimizerPanel })));
import { cn } from '../ui/styles';
import { STAT_COLOR_VAR } from '../ui/color';

interface Props {
  set: PokemonSet;
  species: Pokemon;
  /** The other forme to compare: a Mega, or a stat-changing battle forme (Aegislash-Blade). */
  mega?: Pokemon;
  /** Name of that forme in the switch and headings (default 'Mega'). */
  altLabel?: string;
  format: FormatRules;
  dex: Dex;
  /** Edit one stat of the format's spread (SP, EVs or Stat Exp). */
  onSpread: (stat: StatId, value: number) => void;
  onReplaceSpread: (spread: StatTable) => void;
  /** Edit one IV (Gen 3+) or DV (Gen 1–2). Omitted when IVs are fixed (Champions). */
  onIV?: (stat: StatId, value: number) => void;
  /** Let's Go: friendship (0–255) scales every stat but HP by up to +10%. */
  onFriendship?: (value: number) => void;
  onNature: (nature: string) => void;
  /** Whether the Mega forme is the one shown (controlled; shared with the battle Mega toggle). */
  megaActive?: boolean;
  onMegaActive?: (on: boolean) => void;
  /** `${teamId}:${slot}`, so a hand-off from another screen can open this Pokémon's optimiser. */
  slotKey?: string;
  /** For a Pokémon that isn't mine (an opponent in a goal or search): no Optimise button. */
  noOptimise?: boolean;
}

type Preset = { label: string; spread: Partial<StatTable> };

const PRESETS: Record<StatSystem['kind'], Preset[]> = {
  'champions-sp': [
    { label: 'Physical sweeper', spread: { hp: 2, atk: 32, spe: 32 } },
    { label: 'Special sweeper', spread: { hp: 2, spa: 32, spe: 32 } },
    { label: 'Bulky physical', spread: { hp: 32, atk: 32, def: 2 } },
    { label: 'Bulky special', spread: { hp: 32, spa: 32, spd: 2 } },
    { label: 'Max bulk', spread: { hp: 32, def: 17, spd: 17 } },
    { label: 'Trick Room', spread: { hp: 32, atk: 32, def: 2 } },
  ],
  'modern-ev': [
    { label: 'Physical sweeper', spread: { hp: 4, atk: 252, spe: 252 } },
    { label: 'Special sweeper', spread: { hp: 4, spa: 252, spe: 252 } },
    { label: 'Bulky physical', spread: { hp: 252, atk: 252, def: 4 } },
    { label: 'Bulky special', spread: { hp: 252, spa: 252, spd: 4 } },
    { label: 'Physically defensive', spread: { hp: 252, def: 252, spd: 4 } },
    { label: 'Specially defensive', spread: { hp: 252, def: 4, spd: 252 } },
  ],
  'gb-statexp': [{ label: 'Max all (trained)', spread: { hp: 65535, atk: 65535, def: 65535, spa: 65535, spd: 65535, spe: 65535 } }],
  'lgpe-av': [{ label: 'Max all AVs (200)', spread: { hp: 200, atk: 200, def: 200, spa: 200, spd: 200, spe: 200 } }],
  'pla-effort': [{ label: 'Max all Effort Levels (10)', spread: { hp: 10, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 } }],
};

const BASE_BAR_MAX = 200;
const zero = (): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

/**
 * Stat spread editor for every stat system:
 *  - Champions Stat Points: 0–32 per stat, 66 SP pool, Lv 50, IVs fixed at 31
 *  - Gen 3–9 EVs (0–252, 510 total) + IVs (0–31) at any level
 *  - Gen 1–2 Stat Exp (0–65535 each) + DVs (0–15; the HP DV follows from the others), with one
 *    Special stat in Gen 1 and a shared Special DV / Stat Exp in Gen 2
 *  - Let's Go AVs (0–200 each, added after friendship) + IVs
 *  - Legends: Arceus Effort Levels (0–10 each; IVs are folded into them)
 * Inline +/− buttons on each stat set the nature Showdown-style (Gen 3+).
 */
export function StatDistributor({ set, species, mega, altLabel = 'Mega', format, dex, onSpread, onReplaceSpread, onIV, onFriendship, onNature, megaActive, onMegaActive, slotKey, noOptimise }: Props) {
  const [localMega, setLocalMega] = useState(altLabel === 'Mega');
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const request = useOptimizerStore((s) => s.request);
  const clearRequest = useOptimizerStore((s) => s.clear);
  const requested = !!slotKey && request?.slotKey === slotKey;
  const sys = format.statSystem;
  const mech = formatMechanics(format);
  const key = spreadKey(sys);
  const spread = set[key];
  const { max: perStat, step } = investRange(sys);
  const gb = sys.kind === 'gb-statexp';
  const ivMax = sys.kind === 'gb-statexp' ? sys.dvMax : sys.kind === 'modern-ev' || sys.kind === 'lgpe-av' ? sys.ivMax : 31;
  const showIV = !format.fixedIVs && !!onIV && sys.kind !== 'pla-effort';
  const nature = mech.natures ? dex.nature(set.nature) : undefined;
  const level = format.level.fixed ?? set.level;
  // With a Mega Stone, one forme is "shown" (base stats, main column, speed tools) and the other
  // stays visible in a smaller comparison column.
  const showMega = !!mega && (megaActive ?? localMega);
  const setShowMega = onMegaActive ?? setLocalMega;
  const shown = showMega ? mega! : species;
  const other = mega ? (showMega ? species : mega) : undefined;
  const stats = calcStats(shown.baseStats, set, format, nature);
  const otherStats = other ? calcStats(other.baseStats, set, format, nature) : undefined;
  const otherLabel = showMega ? 'Base' : altLabel;
  const budget = spendBudget(sys, spread);
  const pct = budget ? Math.min(100, (budget.used / budget.cap) * 100) : 0;
  const unit = { 'champions-sp': 'SP', 'modern-ev': 'EVs', 'gb-statexp': 'Stat Exp', 'lgpe-av': 'AVs', 'pla-effort': 'Effort Lv' }[sys.kind];
  const ivUnit = gb ? 'DV' : 'IV';
  const hpDV = gb ? gbHpDV({ atk: set.ivs.atk, def: set.ivs.def, spe: set.ivs.spe, spa: set.ivs.spa }) : 0;
  // Gen 1 shows one Special stat; Gen 2 splits the stat but keeps one Special DV / Stat Exp.
  const rows = STAT_IDS.filter((s) => !(gb && !mech.splitSpecial && s === 'spd'));
  const label = (s: StatId) => (gb && !mech.splitSpecial && s === 'spa' ? 'Spc' : STAT_LABELS[s]);
  const linked = (s: StatId) => gb && s === 'spd';
  const cols = otherStats ? '@xl:grid-cols-[88px_110px_1fr_104px_var(--iv)_48px_48px]' : '@xl:grid-cols-[88px_110px_1fr_104px_var(--iv)_48px]';
  const gridStyle = { ['--iv' as string]: showIV ? '52px' : '0px' };
  // Base/Mega switch: which forme the main column, totals and speed tools follow.
  const megaToggle = mega && (
    <span role="group" aria-label="Stats shown for" className="inline-flex rounded-md bg-surface-2 p-0.5 text-xs font-semibold">
      {[false, true].map((m) => (
        <button
          key={String(m)}
          type="button"
          aria-pressed={showMega === m}
          title={m ? `Show ${mega.name} stats` : `Show ${species.name} stats`}
          onClick={() => setShowMega(m)}
          className={cn(
            'inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors pointer-coarse:h-10 pointer-coarse:px-3',
            showMega === m ? 'bg-surface shadow-sm' : 'text-muted hover:text-fg',
            showMega === m && m && 'text-accent',
          )}
        >
          {m && altLabel === 'Mega' && <Sparkles size={11} />}
          {m ? altLabel : 'Base'}
        </button>
      ))}
    </span>
  );

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
    const match = plus ? dex.natures.find((n) => n.plus === plus && n.minus === minus) : dex.natures.find((n) => !n.plus);
    if (match) onNature(match.name);
  };

  return (
    <div className="@container space-y-3">
      {!budget && megaToggle && <div className="flex justify-end">{megaToggle}</div>}
      {/* Budget meter (SP and EVs share a total; Stat Exp doesn't) */}
      {budget ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="flex items-center gap-2">
              <span className="font-semibold uppercase tracking-wider text-muted">{sys.kind === 'champions-sp' ? 'Stat Points' : 'Effort Values'}</span>
              {megaToggle}
            </span>
            <span className="font-mono tabular-nums">
              <span className={cn('text-base font-bold', budget.status === 'over' && 'text-bad', budget.status === 'complete' && 'text-good')}>{budget.used}</span>
              <span className="text-muted"> / {budget.cap} · </span>
              <span className={cn(budget.status === 'complete' ? 'text-good' : budget.status === 'over' ? 'text-bad' : 'text-fg')}>
                {budget.status === 'complete' ? 'complete' : `${budget.remaining} left`}
              </span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={budget.cap} aria-valuenow={budget.used} aria-label={`${unit} used`}>
            <div
              className={cn('h-full rounded-full transition-all', budget.status === 'complete' ? 'bg-good' : budget.status === 'over' ? 'bg-bad' : 'bg-accent')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      ) : sys.kind === 'lgpe-av' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <p>AVs: 0–200 per stat from Candies, no shared cap, added straight onto the stat. Friendship adds up to +10% to every stat but HP.</p>
          {onFriendship && (
            <label className="flex items-center gap-1.5">
              <span className="font-semibold uppercase tracking-wider">Friendship</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={255}
                value={set.friendship ?? 255}
                onChange={(e) => onFriendship(Math.max(0, Math.min(255, Math.round(Number(e.target.value)) || 0)))}
                onFocus={(e) => e.target.select()}
                aria-label="Friendship"
                className="no-spin h-7 w-14 rounded border border-border bg-surface-2 pointer-coarse:h-11 text-center font-mono text-sm tabular-nums text-fg outline-none focus:border-accent"
              />
              <span className="font-mono">+{lgpeFriendshipPercent(set.friendship ?? 255) - 100}%</span>
            </label>
          )}
        </div>
      ) : sys.kind === 'pla-effort' ? (
        <p className="text-xs text-muted">
          Effort Levels 0–10 per stat, raised with Grit items; the level shown in-game already includes the IV&apos;s head start (IV 20+ starts at 1, 26+ at 2, 31 at 3).
        </p>
      ) : (
        <p className="text-xs text-muted">
          Stat Exp: 0–65,535 per stat, no shared cap (max gives +63 at Lv 100). DVs: 0–15; the HP DV comes from the odd/even bits of the others.
          {!mech.splitSpecial ? ' Gen 1 has one Special stat.' : ' Sp. Atk and Sp. Def share one Special DV and Stat Exp.'}
        </p>
      )}

      {/* Rows — grid when wide, two-line cards in narrow containers (phones, calc columns) */}
      <div className="text-sm">
        <div className={cn('hidden gap-x-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted @xl:grid', cols)} style={gridStyle}>
          <span>Stat</span>
          <span>Base</span>
          <span>
            {unit} (0–{perStat.toLocaleString()})
          </span>
          <span className="text-center">{unit}</span>
          <span className="text-center">{showIV ? ivUnit : ''}</span>
          <span className={cn('text-right', showMega && 'text-accent')}>{showMega ? altLabel : `Lv${level}`}</span>
          {otherStats && <span className="text-right">{otherLabel}</span>}
        </div>
        <div className="divide-y divide-border/60 @xl:divide-y-0">
          {rows.map((s) => {
            const base = shown.baseStats[s];
            const mod = natureModifier(s, nature);
            const val = spread[s];
            const room = budget ? Math.min(perStat, val + Math.max(0, budget.remaining)) : perStat;
            const tone = cn(mod === 1.1 && 'text-bad', mod === 0.9 && 'text-accent');
            const locked = linked(s);
            return (
              <div
                key={s}
                className={cn('grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 py-2 @xl:py-1', cols)}
                style={gridStyle}
              >
                {/* label + nature */}
                <div className="flex items-center gap-1">
                  <span className="w-8 font-semibold" style={{ color: STAT_COLOR_VAR[s] }}>
                    {label(s)}
                  </span>
                  {s !== 'hp' && mech.natures && (
                    <span className="flex gap-0.5">
                      <button
                        type="button"
                        title={`Boost ${STAT_LABELS[s]} (+10%)`}
                        aria-label={`Boost ${STAT_LABELS[s]} (+10%)`}
                        aria-pressed={mod === 1.1}
                        onClick={() => toggleAlign(s, 'plus')}
                        className={cn('h-5 w-5 rounded text-xs leading-none font-bold pointer-coarse:size-11 pointer-coarse:text-sm', mod === 1.1 ? 'bg-bad text-white' : 'text-muted hover:bg-surface-2')}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        title={`Lower ${STAT_LABELS[s]} (−10%)`}
                        aria-label={`Lower ${STAT_LABELS[s]} (−10%)`}
                        aria-pressed={mod === 0.9}
                        onClick={() => toggleAlign(s, 'minus')}
                        className={cn('h-5 w-5 rounded text-xs leading-none font-bold pointer-coarse:size-11 pointer-coarse:text-sm', mod === 0.9 ? 'bg-accent text-white' : 'text-muted hover:bg-surface-2')}
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
                {locked ? (
                  <p className="col-span-2 text-xs text-muted @xl:col-span-3">Uses the Special DV and Stat Exp above.</p>
                ) : (
                  <>
                    {/* slider */}
                    <div className="col-span-2 @xl:col-span-1 @xl:px-1">
                      <input
                        type="range"
                        className="stat-range w-full"
                        min={0}
                        max={perStat}
                        step={gb ? 257 : step}
                        value={val}
                        aria-label={`${label(s)} ${unit}`}
                        onChange={(e) => onSpread(s, Math.min(Number(e.target.value), room))}
                        style={{ ['--fill' as string]: STAT_COLOR_VAR[s], ['--pct' as string]: `${(val / perStat) * 100}%` }}
                      />
                    </div>
                    {/* numeric */}
                    <div className="flex items-center justify-end gap-0.5 @xl:justify-center">
                      <button type="button" aria-label={`Decrease ${label(s)}`} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30 pointer-coarse:flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center" disabled={val <= 0} onClick={() => onSpread(s, Math.max(0, val - (gb ? 1 : step)))}>
                        <Minus size={12} />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={perStat}
                        value={val}
                        aria-label={`${label(s)} ${unit} value`}
                        onChange={(e) => onSpread(s, Number(e.target.value))}
                        onFocus={(e) => e.target.select()}
                        className={cn(
                          'no-spin h-7 rounded border bg-surface-2 text-center font-mono text-sm tabular-nums outline-none focus:border-accent pointer-coarse:h-11',
                          gb ? 'w-16' : 'w-11',
                          val === perStat ? 'border-good/60' : 'border-border',
                        )}
                      />
                      <button type="button" aria-label={`Increase ${label(s)}`} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30 pointer-coarse:flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center" disabled={val >= room} onClick={() => onSpread(s, Math.min(room, val + (gb ? 1 : step)))}>
                        <Plus size={12} />
                      </button>
                    </div>
                  </>
                )}
                {/* IV / DV */}
                {showIV && !locked ? (
                  <div className="flex items-center justify-end gap-1 @xl:justify-center">
                    <span className="text-[10px] text-muted @xl:hidden">{ivUnit}</span>
                    {gb && s === 'hp' ? (
                      <span className="h-7 w-10 rounded border border-dashed border-border text-center font-mono text-sm leading-7 tabular-nums text-muted" title="The HP DV follows from the Atk, Def, Spe and Special DVs">
                        {hpDV}
                      </span>
                    ) : (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={ivMax}
                        value={set.ivs[s]}
                        aria-label={`${label(s)} ${ivUnit}`}
                        onChange={(e) => onIV!(s, Number(e.target.value))}
                        onFocus={(e) => e.target.select()}
                        className={cn(
                          'no-spin h-7 w-10 rounded border bg-surface-2 text-center font-mono text-sm tabular-nums outline-none focus:border-accent pointer-coarse:h-11 pointer-coarse:w-12',
                          set.ivs[s] === ivMax ? 'border-border' : 'border-warn/60',
                        )}
                      />
                    )}
                  </div>
                ) : (
                  <span className="hidden @xl:block" />
                )}
                {/* final stat (desktop columns) */}
                <div className={cn('hidden text-right font-mono text-base font-bold tabular-nums @xl:block', tone)}>{stats[s]}</div>
                {otherStats && <div className="hidden text-right font-mono tabular-nums text-muted @xl:block">{otherStats[s]}</div>}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between border-t border-border pt-1.5 font-mono text-xs text-muted">
          <span>
            {showMega ? `${shown.name} base` : 'Base'} total {sumStats(shown.baseStats) - (mech.splitSpecial ? 0 : shown.baseStats.spd)}
          </span>
          <span>
            Lv{level} total <b className={showMega ? 'text-accent' : 'text-fg'}>{sumStats(stats) - (mech.splitSpecial ? 0 : stats.spd)}</b>
            {otherStats && (
              <>
                {' '}· {otherLabel} <b className="text-fg">{sumStats(otherStats) - (mech.splitSpecial ? 0 : otherStats.spd)}</b>
              </>
            )}
          </span>
        </div>
      </div>

      {/* Tools */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => onReplaceSpread(zero())}>
          <RotateCcw size={12} /> Reset
        </Button>
        {PRESETS[sys.kind].map((p) => (
          <Button key={p.label} size="sm" onClick={() => onReplaceSpread({ ...zero(), ...p.spread })}>
            {p.label}
          </Button>
        ))}
        {canOptimize(format) && !noOptimise && (
          <Button size="sm" variant="primary" onClick={() => setOptimizerOpen(true)} title="Find the cheapest spread for goals like surviving a move or outspeeding a threat">
            <Sparkles size={13} aria-hidden /> Optimise
          </Button>
        )}
        {showIV && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => STAT_IDS.filter((s) => !(gb && s === 'hp')).forEach((s) => onIV!(s, ivMax))}
            title={`Set every ${ivUnit} to ${ivMax}`}
          >
            Max {ivUnit}s
          </Button>
        )}
      </div>
      {canOptimize(format) && (optimizerOpen || requested) && (
        <Suspense fallback={null}>
        <OptimizerPanel
          open={optimizerOpen || requested}
          onOpenChange={(o) => {
            setOptimizerOpen(o);
            if (!o) clearRequest();
          }}
          dex={dex}
          format={format}
          set={set}
          request={requested ? request : null}
          onApply={(spread, nature) => {
            onReplaceSpread(spread);
            if (nature !== set.nature) onNature(nature);
          }}
        />
        </Suspense>
      )}
      <SpeedBenchmark altLabel={showMega ? altLabel : undefined} set={set} species={shown} format={format} dex={dex} onSpread={onSpread} speed={stats.spe} unit={unit} />
    </div>
  );
}

function SpeedBenchmark({
  altLabel,
  set,
  species,
  format,
  dex,
  onSpread,
  speed,
  unit,
}: {
  altLabel?: string;
  set: PokemonSet;
  species: Pokemon;
  format: FormatRules;
  dex: Dex;
  onSpread: (stat: StatId, value: number) => void;
  speed: number;
  unit: string;
}) {
  const [target, setTarget] = useState('');
  const mech = formatMechanics(format);
  const nature = mech.natures ? dex.nature(set.nature) : undefined;
  const t = parseInt(target, 10);
  const need = Number.isFinite(t) ? investmentForTarget('spe', species.baseStats, t, set, format, nature) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-surface-2 px-3 py-2 text-xs">
      <span className="font-mono tabular-nums">
        <span className="text-muted">{altLabel ? `${altLabel} Spe` : 'Spe'}</span> <b>{speed}</b>
        {mech.tailwind && mech.battleSim && (
          <>
            <span className="text-muted"> · Tailwind </span>
            <b>{speed * 2}</b>
          </>
        )}
        {mech.gen >= 4 && mech.heldItems && (
          <>
            <span className="text-muted"> · Scarf </span>
            <b>{Math.floor(speed * 1.5)}</b>
          </>
        )}
        <span className="text-muted"> · −1 </span>
        <b>{Math.floor((speed * 2) / 3)}</b>
        {mech.gen < 7 && mech.battleSim && (
          <>
            <span className="text-muted"> · Paralyzed </span>
            <b>{Math.floor(speed / 4)}</b>
          </>
        )}
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Target size={12} className="text-muted" />
        <span className="text-muted">Hit Spe ≥</span>
        <input
          value={target}
          onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))}
          placeholder="e.g. 150"
          aria-label="Target speed"
          inputMode="numeric"
          className="h-6 w-20 rounded border border-border bg-surface px-1.5 font-mono outline-none focus:border-accent pointer-coarse:h-10"
        />
        {need !== undefined &&
          (need === null ? (
            <span className="text-bad">unreachable</span>
          ) : (
            <Button size="sm" onClick={() => onSpread('spe', need)}>
              Set {need.toLocaleString()} {unit}
            </Button>
          ))}
      </span>
    </div>
  );
}
