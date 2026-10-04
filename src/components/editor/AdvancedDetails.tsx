import { useMemo, useState } from 'react';
import { ChevronRight, Crosshair, Swords, Zap } from 'lucide-react';
import type { Dex } from '@/data/dex';
import type { FieldConditions, SideConditions } from '@/domain/battle/conditions';
import { statFormOptions } from '@/domain/battle/statForm';
import { effectiveStats, stageMultiplier, type StatLine } from '@/domain/battle/effective';
import { calcStats } from '@/domain/stats';
import { STAT_LABELS, type FormatRules, type Pokemon, type PokemonSet } from '@/domain/types';
import { gameInfo } from '@/domain/games';
import { useCalcStore } from '@/store/calcStore';
import { defaultSlotBattle, useSlotBattle, useTeamStore } from '@/store/teamStore';
import { FieldControls, ModChip, SideControls, Toggle } from '../battle/Controls';
import { ItemSprite } from '../ui/ItemSprite';
import { MoveTooltip } from '../ui/MoveTooltip';
import { Button, Panel, TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';
import { STAT_COLOR_VAR } from '../ui/color';

interface Props {
  set: PokemonSet;
  species: Pokemon;
  dex: Dex;
  format: FormatRules;
}

/**
 * Advanced details: "what are my stats under Tailwind / Trick Room / Aurora Veil / −2 Atk…",
 * plus a move-power breakdown (Sharpness, STAB, crits, weather…). State is kept per team member.
 */
export function AdvancedDetails(props: Props) {
  const game = gameInfo(props.format.game);
  if (game && !game.battleSim)
    return (
      <Panel title="Advanced details">
        <p className="text-sm text-muted">
          {game.name} doesn&apos;t use turn-based battles
          {game.id === 'pla' ? ' (Agile and Strong Styles change power and turn order)' : ' (battles run in real time)'}, so in-battle stats and move
          power aren&apos;t modelled here. The stats above are exact.
        </p>
      </Panel>
    );
  return <AdvancedDetailsPanel {...props} />;
}

function AdvancedDetailsPanel({ set, species, dex, format }: Props) {
  const [open, setOpen] = useState(false);
  const mega = format.capabilities.mega ? dex.megaFor(species.id, set.itemId) : undefined;
  const setView = useTeamStore((s) => s.setView);
  const [state, update] = useSlotBattle(set.uid, !!mega);
  const patchSide = (p: Partial<SideConditions>) => update({ side: { ...state.side, ...p } });
  const patchField = (p: Partial<FieldConditions>) => update({ field: { ...state.field, ...p } });

  // Here "Auto" shows the base forme (there is no attacker/defender); "Blade"/"Hero" shows the other one.
  const forme = state.side.megaMode !== 'base' && mega ? mega : state.side.statForm === 'alt' ? (dex.statForm(species.id) ?? species) : species;
  const ability = forme !== species ? Object.values(forme.abilities)[0] ?? '' : dex.ability(set.abilityId)?.name ?? '';

  const result = useMemo(
    () =>
      effectiveStats({
        species: forme,
        stats: calcStats(forme.baseStats, set, format, dex.nature(set.nature)),
        ability,
        item: dex.item(set.itemId)?.name ?? '',
        teraType: format.capabilities.tera ? set.teraType : undefined,
        moves: set.moves.map((m) => dex.move(m)).filter((m): m is NonNullable<typeof m> => !!m),
        side: state.side,
        field: state.field,
        crit: state.crit,
        gen: format.generation,
      }),
    [forme, set, format, dex, ability, state],
  );

  const openInCalc = () => {
    useCalcStore.getState().setSide('attacker', {
      set: structuredClone(set),
      cond: structuredClone(state.side),
      crits: [state.crit, state.crit, state.crit, state.crit],
      origin: { teamName: useTeamStore.getState().teams[useTeamStore.getState().activeTeamId]?.name ?? 'Team', slot: useTeamStore.getState().activeSlot },
    });
    useCalcStore.getState().setField(state.field);
    setView('calc');
  };

  return (
    <Panel
      title={
        <button type="button" className="flex items-center gap-1.5" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronRight size={14} className={cn('transition-transform', open && 'rotate-90')} />
          Advanced details
          <span className="text-xs font-normal text-muted">battle conditions, stat stages, move power</span>
        </button>
      }
      actions={
        <Button size="sm" onClick={openInCalc}>
          <Swords size={13} /> Open in Damage Calc
        </Button>
      }
    >
      {!open ? (
        <p className="text-xs text-muted">
          Spe {result.stats.spe.final} · Atk {result.stats.atk.final} · SpA {result.stats.spa.final} under current conditions.
        </p>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          {/* Controls */}
          <div className="space-y-4">
            <FieldControls field={state.field} onChange={patchField} compact gen={format.generation} game={format.game} />
            <div className="h-px bg-border" />
            <SideControls
              cond={state.side}
              onChange={patchSide}
              ability={ability}
              canMega={!!mega && format.capabilities.mega}
              statForm={statFormOptions(dex, set)}
              canTera={format.capabilities.tera && !!set.teraType}
              teraType={set.teraType}
              gen={format.generation}
              game={format.game}
            />
            <div className="flex items-center gap-2">
              <Toggle on={state.crit} onChange={(crit) => update({ crit })}>
                <span className="inline-flex items-center gap-1">
                  <Crosshair size={12} /> Critical hits
                </span>
              </Toggle>
              <button type="button" className="text-xs text-muted underline-offset-2 hover:underline" onClick={() => update(defaultSlotBattle(!!mega))}>
                Reset conditions
              </button>
            </div>
          </div>

          {/* Results */}
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">In-battle stats · {forme.name}</span>
                <span className="flex items-center gap-1">
                  <ItemSprite itemId={set.itemId} name={result.item} size={16} />
                  {result.types.map((t) => (
                    <TypeBadge key={t} type={t} size="xs" />
                  ))}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                      <th className="py-1 font-semibold">Stat</th>
                      <th className="text-right font-semibold">Lv {format.level.fixed ?? set.level}</th>
                      <th className="text-center font-semibold">Stage</th>
                      <th className="text-right font-semibold">Final</th>
                      <th className="pl-3 font-semibold">Modifiers</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border/60">
                      <td className="py-1.5 font-semibold" style={{ color: STAT_COLOR_VAR.hp }}>HP</td>
                      <td className="text-right font-mono tabular-nums">{result.hp}</td>
                      <td />
                      <td className="text-right font-mono font-bold tabular-nums">{Math.max(1, Math.round((result.hp * state.side.hpPercent) / 100))}</td>
                      <td className="pl-3 text-xs text-muted">{state.side.hpPercent}% remaining</td>
                    </tr>
                    {(['atk', 'def', 'spa', 'spd', 'spe'] as const).map((s) => (
                      <StatRow key={s} stat={s} line={result.stats[s]} />
                    ))}
                  </tbody>
                </table>
              </div>
              {result.speedNote && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-accent">
                  <Zap size={11} /> {result.speedNote}
                </p>
              )}
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <Bulk label="Physical bulk" value={result.physicalBulk} mods={result.physicalTaken} />
                <Bulk label="Special bulk" value={result.specialBulk} mods={result.specialTaken} />
              </div>
            </div>

            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                Move power{state.crit && ' · critical hits'}
              </div>
              {result.moves.length === 0 ? (
                <p className="text-xs text-muted">Add moves to see their power under these conditions.</p>
              ) : (
                <ul className="space-y-1.5">
                  {result.moves.map((m) => (
                    <li key={m.moveId} className="rounded-lg bg-surface-2 px-2.5 py-2">
                      <div className="flex items-center gap-2">
                        <MoveTooltip move={dex.move(m.moveId)}>
                          <TypeBadge type={m.type} size="xs" />
                        </MoveTooltip>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
                        {m.category !== 'Status' && (
                          <span className="font-mono text-xs tabular-nums">
                            <span className="text-muted">BP</span> {m.basePower}
                            {m.effectivePower !== m.basePower && <b className="text-good"> → {m.effectivePower}</b>}
                            <span className="text-muted"> · ×</span>
                            <b>{Math.round(m.multiplier * 100) / 100}</b>
                            <span className="text-muted"> · {m.stat === 'atk' ? 'Atk' : 'SpA'} </span>
                            {m.statValue}
                          </span>
                        )}
                      </div>
                      {(m.mods.length > 0 || m.note) && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {m.mods.map((x, i) => (
                            <ModChip key={i} label={x.label} factor={x.factor} />
                          ))}
                          {m.note && <span className="text-[10px] text-muted">{m.note}</span>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1.5 text-xs text-muted">
                Type effectiveness and the target's bulk aren't included here. Use the Damage Calc for exact damage rolls.
              </p>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function StatRow({ stat, line }: { stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe'; line: StatLine }) {
  const changed = line.final !== line.raw;
  return (
    <tr className="border-t border-border/60 align-top">
      <td className="py-1.5 font-semibold" style={{ color: STAT_COLOR_VAR[stat] }}>
        {STAT_LABELS[stat]}
      </td>
      <td className="py-1.5 text-right font-mono tabular-nums">{line.raw}</td>
      <td className="py-1.5 text-center">
        {line.stage !== 0 && (
          <span className={cn('font-mono text-xs font-bold', line.stage > 0 ? 'text-good' : 'text-bad')} title={`×${Math.round(stageMultiplier(line.stage) * 100) / 100}`}>
            {line.stage > 0 ? `+${line.stage}` : line.stage}
          </span>
        )}
      </td>
      <td className={cn('py-1.5 text-right font-mono text-base font-bold tabular-nums', changed && (line.final > line.raw ? 'text-good' : 'text-bad'))}>
        {line.final}
      </td>
      <td className="py-1 pl-3">
        <div className="flex flex-wrap gap-1">
          {line.mods.map((m, i) => (
            <ModChip key={i} label={m.label} factor={m.factor} />
          ))}
        </div>
      </td>
    </tr>
  );
}

function Bulk({ label, value, mods }: { label: string; value: number; mods: { label: string; factor: number }[] }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="font-mono text-base font-bold tabular-nums">{value.toLocaleString()}</div>
      {mods.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {mods.map((m, i) => (
            <ModChip key={i} label={`${m.label} (damage taken)`} factor={m.factor} />
          ))}
        </div>
      )}
      <div className="text-[10px] text-muted">HP × {label.startsWith('Phys') ? 'Def' : 'SpD'} ÷ damage taken</div>
    </div>
  );
}
