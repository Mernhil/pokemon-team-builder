import type { ReactNode } from 'react';
import { Minus, Plus } from 'lucide-react';
import { toID } from '@/data/dex';
import {
  BOOST_PRESETS,
  STATUSES,
  TERRAINS,
  WEATHERS,
  emptyBoosts,
  type BoostStat,
  type FieldConditions,
  type MegaMode,
  type StatFormChoice,
  type SideConditions,
} from '@/domain/battle/conditions';
import { formatMechanics } from '@/domain/games';
import { terrainInfo, weatherInfo } from '@/domain/mechanics';
import { STAT_LABELS } from '@/domain/types';
import { InfoTooltip } from '../ui/InfoTooltip';
import { Select } from '../ui/primitives';
import { cn } from '../ui/styles';
import { STAT_COLOR_VAR } from '../ui/color';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function Toggle({ on, onChange, children, title, disabled }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'h-7 rounded-md border px-2 text-xs font-medium transition-colors disabled:opacity-40 pointer-coarse:h-11 pointer-coarse:px-3 pointer-coarse:text-sm',
        on ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:border-muted/60 hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  describe,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  /** Optional per-option tooltip content (weather/terrain mechanics, etc.). */
  describe?: (id: T) => { title: string; summary: string; effects: string[]; interactions: string[] } | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={label}>
      <span className="mr-1 w-16 text-2xs font-semibold uppercase tracking-wider text-muted">{label}</span>
      {options.map((o) => {
        const info = describe?.(o.id);
        const btn = (
          <button
            type="button"
            role="radio"
            aria-checked={value === o.id}
            onClick={() => onChange(o.id)}
            className={cn(
              'h-7 rounded-md px-2 text-xs font-medium pointer-coarse:h-11 pointer-coarse:px-3 pointer-coarse:text-sm',
              value === o.id ? 'bg-fg text-bg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {o.label}
          </button>
        );
        return info ? (
          <InfoTooltip key={o.id || 'none'} title={info.title} summary={info.summary} effects={info.effects} interactions={info.interactions} wrapsControl>
            {btn}
          </InfoTooltip>
        ) : (
          <span key={o.id || 'none'}>{btn}</span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------

/** Field controls; `gen` hides what that generation didn't have (terrain, Trick Room, doubles…). */
export function FieldControls({ field, onChange, compact, gen = 9, game }: { field: FieldConditions; onChange: (p: Partial<FieldConditions>) => void; compact?: boolean; gen?: number; game?: string }) {
  const mech = formatMechanics({ generation: gen, game });
  const weathers = WEATHERS.map((w) => (w.id === 'Snow' ? { ...w, label: mech.snowName } : w));
  const terrains = TERRAINS.filter((t) => t.id !== 'Psychic' || mech.psychicTerrain);
  return (
    <div className={cn('flex flex-col gap-2', !compact && 'lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-6')}>
      {mech.doubles && (
        <Segmented label="Battle" value={field.gameType} options={[{ id: 'Doubles', label: 'Doubles' }, { id: 'Singles', label: 'Singles' }]} onChange={(gameType) => onChange({ gameType })} />
      )}
      {mech.weather && (
        <Segmented
          label="Weather"
          value={field.weather}
          options={weathers}
          onChange={(weather) => onChange({ weather })}
          describe={(id) => {
            const info = weatherInfo(id, mech.snowName);
            return info && { title: info.name, summary: info.summary, effects: info.effects, interactions: info.interactions };
          }}
        />
      )}
      {mech.terrain && (
        <Segmented
          label="Terrain"
          value={field.terrain}
          options={terrains}
          onChange={(terrain) => onChange({ terrain })}
          describe={(id) => {
            const info = terrainInfo(id);
            return info && { title: info.name, summary: info.summary, effects: info.effects, interactions: info.interactions };
          }}
        />
      )}
      {mech.trickRoom && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 w-16 text-2xs font-semibold uppercase tracking-wider text-muted">Room</span>
          <Toggle on={field.trickRoom} onChange={(trickRoom) => onChange({ trickRoom })}>Trick Room</Toggle>
          <Toggle on={field.gravity} onChange={(gravity) => onChange({ gravity })}>Gravity</Toggle>
        </div>
      )}
      {!mech.weather && <p className="text-xs text-muted">Gen 1 battles have no weather, terrain or rooms — just stat stages, status and screens.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side (one Pokémon + its side of the field)
// ---------------------------------------------------------------------------

/** Label for the "ability condition met" switch, or null when the ability has none. */
function abilityToggleLabel(ability?: string): string | null {
  switch (toID(ability)) {
    case 'unburden':
      return 'Item used (Unburden)';
    case 'protosynthesis':
    case 'quarkdrive':
      return 'Booster Energy';
    case 'flashfire':
      return 'Flash Fire active';
    case 'slowstart':
      return 'Slow Start active';
    case 'stakeout':
      return 'Target switched in';
    case 'plus':
    case 'minus':
      return 'Plus/Minus partner';
    default:
      return null;
  }
}

export function SideControls({
  cond,
  onChange,
  ability,
  canMega,
  statForm,
  canTera,
  teraType,
  gen = 9,
  game,
}: {
  gen?: number;
  game?: string;
  cond: SideConditions;
  onChange: (p: Partial<SideConditions>) => void;
  ability?: string;
  canMega: boolean;
  /** The Pokémon changes stats between battle formes (Aegislash, Palafin): offer the choice. `alt` is the other forme's name ("Blade"). */
  statForm?: { alt: string; auto: string };
  canTera: boolean;
  teraType?: string;
}) {
  const mech = formatMechanics({ generation: gen, game });
  const abLabel = mech.abilities ? abilityToggleLabel(ability) : null;
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs">
          <span className="text-2xs font-semibold uppercase tracking-wider text-muted">Status</span>
          <Select className="h-7 w-auto py-0 text-xs pointer-coarse:h-10" value={cond.status} onChange={(e) => onChange({ status: e.target.value as SideConditions['status'] })}>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-40 flex-1 items-center gap-2 text-xs">
          <span className="text-2xs font-semibold uppercase tracking-wider text-muted">HP</span>
          <input
            type="range"
            min={1}
            max={100}
            value={cond.hpPercent}
            onChange={(e) => onChange({ hpPercent: Number(e.target.value) })}
            className="stat-range flex-1"
            aria-label="Current HP percent"
            style={{ ['--fill' as string]: cond.hpPercent > 50 ? 'var(--color-good)' : cond.hpPercent > 20 ? 'var(--color-warn)' : 'var(--color-bad)', ['--pct' as string]: `${cond.hpPercent}%` }}
          />
          <span className="w-9 text-right font-mono tabular-nums">{cond.hpPercent}%</span>
        </label>
      </div>
      {canMega && (
        <Segmented<MegaMode>
          label="Forme"
          value={cond.megaMode}
          options={[
            { id: 'base', label: 'Base' },
            { id: 'mega', label: 'Mega' },
            { id: 'both', label: 'Both' },
          ]}
          onChange={(megaMode) => onChange({ megaMode })}
        />
      )}
      {statForm && (
        <div className="space-y-1">
          <Segmented<StatFormChoice>
            label="Form"
            value={cond.statForm ?? 'auto'}
            options={[
              { id: 'auto', label: 'Auto' },
              { id: 'base', label: 'Base' },
              { id: 'alt', label: statForm.alt },
            ]}
            onChange={(choice) => onChange({ statForm: choice })}
          />
          <p className="text-2xs text-muted">{statForm.auto}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {canTera && <Toggle on={cond.tera} onChange={(tera) => onChange({ tera })}>Tera {teraType}</Toggle>}
        {abLabel && <Toggle on={cond.abilityOn} onChange={(abilityOn) => onChange({ abilityOn })}>{abLabel}</Toggle>}
        {mech.tailwind && <Toggle on={cond.tailwind} onChange={(tailwind) => onChange({ tailwind })}>Tailwind</Toggle>}
        <Toggle on={cond.reflect} onChange={(reflect) => onChange({ reflect })}>Reflect</Toggle>
        <Toggle on={cond.lightScreen} onChange={(lightScreen) => onChange({ lightScreen })}>Light Screen</Toggle>
        {mech.auroraVeil && <Toggle on={cond.auroraVeil} onChange={(auroraVeil) => onChange({ auroraVeil })}>Aurora Veil</Toggle>}
        {mech.helpingHand && <Toggle on={cond.helpingHand} onChange={(helpingHand) => onChange({ helpingHand })}>Helping Hand</Toggle>}
        {mech.friendGuard && <Toggle on={cond.friendGuard} onChange={(friendGuard) => onChange({ friendGuard })}>Friend Guard</Toggle>}
      </div>
      <BoostControls boosts={cond.boosts} onChange={(boosts) => onChange({ boosts })} />
    </div>
  );
}

const BOOST_STATS: BoostStat[] = ['atk', 'def', 'spa', 'spd', 'spe'];

function BoostControls({ boosts, onChange }: { boosts: SideConditions['boosts']; onChange: (b: SideConditions['boosts']) => void }) {
  const set = (s: BoostStat, v: number) => onChange({ ...boosts, [s]: Math.max(-6, Math.min(6, v)) });
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wider text-muted">Stat stages</span>
        <select
          aria-label="Stage presets"
          className="h-6 rounded border border-border bg-surface-2 px-1 text-xs text-muted outline-none pointer-coarse:h-10"
          value=""
          onChange={(e) => {
            const p = BOOST_PRESETS[Number(e.target.value)];
            if (p) onChange({ ...emptyBoosts(), ...p.boosts });
            if (e.target.value === 'reset') onChange(emptyBoosts());
          }}
        >
          <option value="">Presets…</option>
          <option value="reset">Reset all to 0</option>
          {BOOST_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {/* Touch screens: 3 per row so each −/+ can be a full-size target. */}
      <div className="grid grid-cols-5 gap-1 pointer-coarse:grid-cols-3">
        {BOOST_STATS.map((s) => {
          const v = boosts[s];
          return (
            <div key={s} className="flex flex-col items-center rounded-md bg-surface-2 py-1">
              <span className="text-3xs font-semibold" style={{ color: STAT_COLOR_VAR[s] }}>
                {STAT_LABELS[s]}
              </span>
              <div className="flex items-center">
                <button type="button" aria-label={`Lower ${STAT_LABELS[s]} stage`} disabled={v <= -6} onClick={() => set(s, v - 1)} className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-30 pointer-coarse:flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center">
                  <Minus size={11} aria-hidden />
                </button>
                <span className={cn('w-6 text-center font-mono text-xs font-bold tabular-nums', v > 0 && 'text-good', v < 0 && 'text-bad')}>
                  {v > 0 ? `+${v}` : v}
                </span>
                <button type="button" aria-label={`Raise ${STAT_LABELS[s]} stage`} disabled={v >= 6} onClick={() => set(s, v + 1)} className="rounded p-0.5 text-muted hover:text-fg disabled:opacity-30 pointer-coarse:flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center">
                  <Plus size={11} aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A modifier rendered as a small chip: "×1.5 Sharpness". */
export function ModChip({ label, factor }: { label: string; factor: number }) {
  const f = Math.round(factor * 100) / 100;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-medium',
        factor > 1 ? 'bg-good/15 text-good' : factor < 1 ? 'bg-bad/15 text-bad' : 'bg-surface-2 text-muted',
      )}
    >
      <b className="font-mono">×{f}</b> {label}
    </span>
  );
}
