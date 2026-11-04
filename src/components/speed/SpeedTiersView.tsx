import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, Gauge } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { META_STALE_DAYS, isProvisional, provisionalNote, usageText } from '@/domain/meta';
import {
  DEFAULT_TOP_N,
  buildLadder,
  describePlan,
  metaVariants,
  neutralScenario,
  pickSpeedSnapshot,
  planOutspeed,
  snapshotAge,
  type SideSpeedScenario,
  type SpeedRow,
  type SpeedScenario,
  type SpeedStage,
} from '@/domain/speedTiers';
import { TERRAINS, WEATHERS, defaultField, defaultSide } from '@/domain/battle/conditions';
import { benchmarkFromGoal } from '@/domain/benchmarkEval';
import { mergeBenchmarks } from '@/domain/benchmarks';
import type { FormatRules, Team } from '@/domain/types';
import { useFocusStore } from '@/store/focusStore';
import { useOptimizerStore } from '@/store/optimizerStore';
import { useTeamStore } from '@/store/teamStore';
import { toast } from '@/store/toastStore';
import { ChipRow, Toggle } from '../ui/chips';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, Label, LoadingState, Notice, Panel, Select } from '../ui/primitives';
import { cn } from '../ui/styles';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions').sort((a, b) => b.start.localeCompare(a.start));
const TOP_N_CHOICES = [10, 20, 30, 40];
const STAGES: { stage: SpeedStage; label: string; hint: string }[] = [
  { stage: -1, label: '−1', hint: 'Icy Wind / Electroweb' },
  { stage: 1, label: '+1', hint: 'one Speed boost' },
  { stage: 2, label: '+2', hint: 'two Speed boosts' },
];

const fmtMonth = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function SideChips({
  side,
  onChange,
  extra,
}: {
  side: SideSpeedScenario;
  onChange: (s: SideSpeedScenario) => void;
  extra?: React.ReactNode;
}) {
  return (
    <>
      <Toggle pressed={side.tailwind} onClick={() => onChange({ ...side, tailwind: !side.tailwind })}>
        Tailwind
      </Toggle>
      {STAGES.map((s) => (
        <Toggle key={s.stage} pressed={side.stage === s.stage} title={s.hint} onClick={() => onChange({ ...side, stage: side.stage === s.stage ? 0 : s.stage })}>
          {s.label}
        </Toggle>
      ))}
      <Toggle pressed={side.paralyzed} onClick={() => onChange({ ...side, paralyzed: !side.paralyzed })}>
        Paralysis
      </Toggle>
      {extra}
    </>
  );
}

/**
 * Speed tiers: a ladder of the most-used Pokémon of a Champions regulation (their likely spreads)
 * with your team's Pokémon on the same scale. Every number comes from the Damage Calc's speed.
 */
export function SpeedTiersView({ dex, format, team }: { dex: Dex; format: FormatRules; team: Team }) {
  const metaFor = useMetaFor();
  const updateSet = useTeamStore((s) => s.updateSet);
  const [scenario, setScenario] = useState<SpeedScenario>(neutralScenario);
  const [topN, setTopN] = useState(DEFAULT_TOP_N);
  const [open, setOpen] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);

  const wanted = format.regulationId ?? champRegs[0]?.id;
  const picked = useMemo(
    () => (metaFor ? pickSpeedSnapshot(wanted, champRegs.map((r) => r.id), metaFor) : undefined),
    [wanted, metaFor],
  );
  const variants = useMemo(() => (picked ? metaVariants(picked.snapshot, dex, format, topN) : []), [picked, dex, format, topN]);
  const members = useMemo(() => team.slots.flatMap((set, slot) => (set ? [{ slot, set }] : [])), [team.slots]);
  const ladder = useMemo(() => buildLadder(dex, variants, members, scenario), [dex, variants, members, scenario]);

  // A hand-off from the match log: open that species' row (widening the list if it isn't in the top N).
  const focusId = useFocusStore((st) => st.speciesId);
  const clearFocus = useFocusStore((st) => st.clear);
  useEffect(() => {
    if (!focusId) return;
    const row = ladder.find((r) => !r.mine && r.speciesId === focusId);
    if (row) {
      // oxlint-disable-next-line react/set-state-in-effect -- reacts to a one-shot hand-off or a changed input, which is what this effect is for
      setOpen(row.key);
      requestAnimationFrame(() => document.getElementById(`speed-row-${row.key}`)?.scrollIntoView({ block: 'center' }));
      clearFocus();
    } else if (topN < 40) setTopN(40);
    else clearFocus();
  }, [focusId, ladder, topN, clearFocus]);

  if (format.datasetId !== 'champions') {
    return (
      <EmptyState icon={Gauge} title="Speed tiers need meta usage data, which only exists for Champions">
        Switch the team’s format to a Champions regulation to compare your Pokémon’s Speed with what people actually use.
      </EmptyState>
    );
  }
  if (!metaFor) return <LoadingState label="Loading usage data…" />;
  if (!picked) {
    return (
      <EmptyState icon={Gauge} title="No usage data to build speed tiers from yet">
        Early numbers from tournaments and Showdown replays appear within days of a regulation starting, and Smogon’s usage statistics after its
        first month; the app picks them up with its next update.
      </EmptyState>
    );
  }

  const reg = champRegs.find((r) => r.id === picked.regulationId);
  const wantedReg = champRegs.find((r) => r.id === picked.fellBackFrom);
  const { days } = snapshotAge(picked.snapshot);
  const s = picked.snapshot.source;
  const set = <K extends keyof SpeedScenario>(k: K, v: SpeedScenario[K]) => setScenario((cur) => ({ ...cur, [k]: v }));
  const mover = members.find((m) => m.slot === slot) ?? members[0];

  const apply = (row: SpeedRow) => {
    if (!mover) return;
    const plan = planOutspeed(dex, format, mover.set, mover.set.speciesId && dex.megaFor(mover.set.speciesId, mover.set.itemId) ? 'mega' : 'base', row.speed, scenario);
    const before = { nature: mover.set.nature, sp: mover.set.sp };
    updateSet(team.id, mover.slot, { nature: plan.nature, sp: { ...mover.set.sp, spe: plan.sp } });
    toast(`${dex.species(mover.set.speciesId)?.name}: ${plan.sp} Spe ${plan.nature}.`, {
      label: 'Undo',
      run: () => updateSet(team.id, mover.slot, before),
    });
  };

  return (
    <div className="space-y-3">
      <Panel bodyClassName="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 text-sm text-muted">
            <b className="text-fg">{reg?.name ?? picked.regulationId}</b>
            {s.month && ` · ${fmtMonth(s.month)} usage`}
            {s.season && ` · in-game ranked season ${s.season}`}
            {s.cutoff ? ` · rating ${s.cutoff}+` : ''}
            {s.battles !== undefined ? ` · ${s.battles.toLocaleString()} battles` : ''}
            {isProvisional(picked.snapshot) && ` · ${provisionalNote(picked.snapshot, (id) => champRegs.find((r) => r.id === id)?.shortName)}`}
            {` · ${days} days old`}
          </p>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            Top
            <Select aria-label="Species shown" className="w-auto" value={topN} onChange={(e) => setTopN(Number(e.target.value))}>
              {TOP_N_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n} Pokémon
                </option>
              ))}
            </Select>
          </label>
        </div>
        <ChipRow label="My side">
          <SideChips
            side={scenario.mine}
            onChange={(side) => set('mine', { ...side, scarf: scenario.mine.scarf })}
            extra={
              <Toggle pressed={scenario.mine.scarf} title="Every Pokémon of yours holds a Choice Scarf" onClick={() => set('mine', { ...scenario.mine, scarf: !scenario.mine.scarf })}>
                Choice Scarf
              </Toggle>
            }
          />
        </ChipRow>
        <ChipRow label="Their side">
          <SideChips side={scenario.theirs} onChange={(side) => set('theirs', side)} />
        </ChipRow>
        <ChipRow label="Weather">
          {WEATHERS.map((w) => (
            <Toggle key={w.id || 'none'} pressed={scenario.weather === w.id} onClick={() => set('weather', w.id)}>
              {w.label}
            </Toggle>
          ))}
        </ChipRow>
        <ChipRow label="Terrain">
          {TERRAINS.map((t) => (
            <Toggle key={t.id || 'none'} pressed={scenario.terrain === t.id} onClick={() => set('terrain', t.id)}>
              {t.label}
            </Toggle>
          ))}
        </ChipRow>
        <ChipRow label="Room">
          <Toggle pressed={scenario.trickRoom} onClick={() => set('trickRoom', !scenario.trickRoom)}>
            Trick Room
          </Toggle>
          <button type="button" className="shrink-0 px-2 text-xs font-semibold text-accent underline-offset-2 hover:underline pointer-coarse:h-11" onClick={() => setScenario(neutralScenario())}>
            Reset
          </button>
        </ChipRow>
      </Panel>

      {picked.fellBackFrom && (
        <Notice icon={AlertTriangle} title={`No usage data for ${wantedReg?.shortName ?? 'this regulation'} yet`}>
          Showing {reg?.shortName ?? picked.regulationId}’s numbers, the newest published.
        </Notice>
      )}
      {!isProvisional(picked.snapshot) && days > META_STALE_DAYS && (
        <Notice icon={AlertTriangle} title={`These numbers are ${days} days old`}>
          They describe play up to {snapshotAge(picked.snapshot).dataDate}. Newer usage statistics haven’t been published or built into the app yet.
        </Notice>
      )}

      {members.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-muted">
          <span>“Outspeed this” for</span>
          <Select aria-label="Pokémon to speed up" className="w-auto" value={mover?.slot} onChange={(e) => setSlot(Number(e.target.value))}>
            {members.map((m) => (
              <option key={m.slot} value={m.slot}>
                {dex.species(m.set.speciesId)?.name ?? m.set.speciesId} ({m.set.sp.spe} Spe)
              </option>
            ))}
          </Select>
        </label>
      )}
      {members.length === 0 && <p className="text-sm text-muted">Add Pokémon to your team to see them on this ladder.</p>}

      <p className="text-xs text-muted" aria-live="polite">
        {scenario.trickRoom ? 'Trick Room: slowest moves first.' : 'Fastest moves first.'} {ladder.length} rows; ties with your team are marked.
      </p>
      <ol aria-label="Speed tiers" className="space-y-1.5">
        {ladder.map((row) => (
          <Row key={row.key} row={row} dex={dex} format={format} open={open === row.key} onToggle={() => setOpen(open === row.key ? null : row.key)}>
            {!row.mine && (
              <OutspeedPanel row={row} dex={dex} format={format} scenario={scenario} mover={mover} teamId={team.id} onApply={() => apply(row)} />
            )}
          </Row>
        ))}
      </ol>
    </div>
  );
}

function Row({
  row,
  dex,
  format,
  open,
  onToggle,
  children,
}: {
  row: SpeedRow;
  dex: Dex;
  format: FormatRules;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const sp = dex.species(row.formeId);
  const body = (
    <>
      <Sprite speciesId={row.formeId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={40} />
      <span className="min-w-0 flex-1 text-left">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-semibold">{row.name}</span>
          {row.mine && <Chip tone="accent">Yours</Chip>}
          {row.tie && <Chip tone="warn">Speed tie</Chip>}
          {row.forme === 'mega' && !row.mine && <Chip>Mega</Chip>}
        </span>
        <span className="block truncate text-xs text-muted">
          {row.label}
          {!row.mine && usageText(row) && ` · ${usageText(row)}`}
          {row.spreadPct ? ` · ${row.spreadPct}% of sets` : ''}
        </span>
      </span>
      <span className="font-mono text-lg font-bold tabular-nums" aria-label={`Speed ${row.speed}`}>
        {row.speed}
      </span>
      {!row.mine && <ChevronDown size={16} aria-hidden className={cn('shrink-0 text-muted transition-transform motion-reduce:transition-none', open && 'rotate-180')} />}
    </>
  );
  const frame = cn('flex w-full min-h-12 items-center gap-3 rounded-xl border px-3 py-1.5', row.mine ? 'border-accent bg-accent/10' : 'border-border bg-surface');
  return (
    <li id={`speed-row-${row.key}`}>
      {row.mine ? (
        <div className={frame}>{body}</div>
      ) : (
        <>
          <button type="button" aria-expanded={open} onClick={onToggle} className={cn(frame, 'hover:bg-surface-2 pointer-coarse:min-h-14', open && 'rounded-b-none')}>
            {body}
          </button>
          {open && <div className="rounded-b-xl border border-t-0 border-border bg-surface-2 px-3 py-2.5">{children}</div>}
        </>
      )}
    </li>
  );
}

function OutspeedPanel({
  row,
  dex,
  format,
  scenario,
  mover,
  teamId,
  onApply,
}: {
  row: SpeedRow;
  dex: Dex;
  format: FormatRules;
  scenario: SpeedScenario;
  mover: { slot: number; set: import('@/domain/types').PokemonSet } | undefined;
  teamId: string;
  onApply: () => void;
}) {
  const metaFor = useMetaFor();
  const snapshot = useMemo(() => (metaFor ? pickSpeedSnapshot(format.regulationId, champRegs.map((r) => r.id), metaFor)?.snapshot : undefined), [metaFor, format.regulationId]);
  if (!mover) return <p className="text-sm text-muted">Add a Pokémon to your team to see what it needs to {scenario.trickRoom ? 'move before' : 'outspeed'} this.</p>;
  const forme = dex.megaFor(mover.set.speciesId, mover.set.itemId) ? 'mega' : 'base';
  const plan = planOutspeed(dex, format, mover.set, forme, row.speed, scenario);
  const name = dex.species(mover.set.speciesId)?.name ?? mover.set.speciesId;
  const can = plan.status === 'reachable' && !plan.overBudget;
  // Who the goal is about and the scenario, so it can be kept as a benchmark and checked again later.
  const goal = {
    kind: 'outspeed' as const,
    target: row.speed,
    mode: scenario.trickRoom ? ('under' as const) : ('over' as const),
    label: `${row.name} at ${row.speed}`,
    foe: { speciesId: row.speciesId, source: 'meta' as const },
    scenario: {
      tailwind: scenario.theirs.tailwind || undefined,
      stage: scenario.theirs.stage || undefined,
      paralyzed: scenario.theirs.paralyzed || undefined,
      scarf: row.scarf || undefined,
      myTailwind: scenario.mine.tailwind || undefined,
    },
  };
  const keep = () => {
    const b = benchmarkFromGoal(dex, format, goal, {
      snapshot,
      field: { ...defaultField(), weather: scenario.weather, terrain: scenario.terrain, trickRoom: scenario.trickRoom },
      myCond: { ...defaultSide(false), tailwind: scenario.mine.tailwind },
      met: plan.status === 'already',
    });
    if (!b) return;
    useTeamStore.getState().updateSet(teamId, mover.slot, { benchmarks: mergeBenchmarks(mover.set.benchmarks, [b]) });
    toast(`Kept “${scenario.trickRoom ? 'move before' : 'outspeed'} ${row.name}” as a benchmark of ${name}.`);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <div className="min-w-0 flex-1">
        <Label>{scenario.trickRoom ? 'Move before this' : 'Outspeed this'}</Label>
        <p>
          <b>{name}</b>
          {forme === 'mega' ? ' (Mega)' : ''}: {describePlan(plan, mover.set, scenario.trickRoom)}
        </p>
        {plan.status === 'reachable' && plan.overBudget && (
          <p className="text-xs text-warn">
            Needs {plan.sp} SP in Speed but only {plan.budgetLeft} are unspent. Free some up first.
          </p>
        )}
      </div>
      <Button
        size="sm"
        aria-label={`Optimise ${name} to ${scenario.trickRoom ? 'move before' : 'outspeed'} ${row.name}`}
        onClick={() => {
          useOptimizerStore.getState().open({
            slotKey: `${teamId}:${mover.slot}`,
            goals: [goal],
            tailwind: scenario.mine.tailwind,
          });
          useTeamStore.getState().setActiveSlot(mover.slot);
          useTeamStore.getState().setView('builder');
        }}
      >
        Optimise…
      </Button>
      <Button size="sm" aria-label={`Keep ${scenario.trickRoom ? 'moving before' : 'outspeeding'} ${row.name} as a benchmark of ${name}`} onClick={keep} title="Saves this goal on the Pokémon and checks it again whenever the meta or the regulation changes">
        Keep as benchmark
      </Button>
      {plan.status === 'reachable' && (
        <Button variant="primary" size="sm" disabled={!can} onClick={onApply} aria-label={`Apply ${plan.sp} Spe ${plan.nature} to ${name}`}>
          Apply
        </Button>
      )}
    </div>
  );
}
