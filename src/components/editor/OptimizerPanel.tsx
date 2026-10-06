import { useMemo, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { TERRAINS, WEATHERS, defaultField, defaultSide, type FieldConditions } from '@/domain/battle/conditions';
import { benchmarkFromGoal } from '@/domain/benchmarkEval';
import type { Benchmark } from '@/domain/benchmarks';
import { optimize, type Goal, type Leftover, type OptimizeResult } from '@/domain/optimizer';
import { pickSpeedSnapshot } from '@/domain/speedTiers';
import { spreadKey } from '@/domain/stats';
import { STAT_IDS, STAT_LABELS, type FormatRules, type PokemonSet, type StatId, type StatTable } from '@/domain/types';
import { useOptimizerStore, type OptimizerRequest } from '@/store/optimizerStore';
import { toast } from '@/store/toastStore';
import { Button, Checkbox, Chip, Field, Label, Select } from '../ui/primitives';
import { Modal } from '../ui/Modal';
import { cn } from '../ui/styles';
import { champRegIds, type GoalKind } from './optimizerShared';
import { GoalAdder, GoalRow } from './OptimizerGoals';

export function OptimizerPanel({
  open,
  onOpenChange,
  dex,
  format,
  set,
  request,
  onApply,
  onKeep,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dex: Dex;
  format: FormatRules;
  set: PokemonSet;
  /** Goals to start from (a hand-off from Speed tiers or the Threat report). */
  request?: OptimizerRequest | null;
  onApply: (spread: StatTable, nature: string) => void;
  /** Goals kept as benchmarks of this Pokémon (the "Keep these as benchmarks" box, when ticked). */
  onKeep?: (benchmarks: Benchmark[]) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Optimise spread" description="Set goals; get the cheapest spread that meets them." wide>
      {open && <Body key={request ? 'req' : 'new'} dex={dex} format={format} set={set} request={request ?? null} onApply={onApply} onKeep={onKeep} onClose={() => onOpenChange(false)} />}
    </Modal>
  );
}

function Body({ dex, format, set, request, onApply, onKeep, onClose }: { dex: Dex; format: FormatRules; set: PokemonSet; request: OptimizerRequest | null; onApply: (s: StatTable, n: string) => void; onKeep?: (b: Benchmark[]) => void; onClose: () => void }) {
  const key = spreadKey(format.statSystem);
  const unit = key === 'sp' ? 'SP' : 'EVs';
  const [goals, setGoals] = useState<Goal[]>(request?.goals ?? []);
  const [field, setField] = useState<FieldConditions>(request?.field ?? defaultField());
  const [tailwind, setTailwind] = useState(!!request?.tailwind);
  const [natureMode, setNatureMode] = useState<'fixed' | 'suggest'>('fixed');
  const [leftover, setLeftover] = useState<string>('none');
  const [adding, setAdding] = useState<GoalKind | null>(null);
  const clearRequest = useOptimizerStore((s) => s.clear);
  const metaFor = useMetaFor();
  // Benchmarks: goals that say who they are about can be kept on the set and checked again later.
  const [keep, setKeep] = useState(true);
  const keepable = goals.filter((g) => g.kind !== 'outspeed' || g.foe).length;

  const current = (key === 'sp' ? set.sp : set.evs) as StatTable;
  const hasMega = !!dex.megaFor(set.speciesId, set.itemId);
  const leftoverOpt: Leftover | undefined = leftover === 'bulkSplit' ? { kind: 'bulkSplit' } : leftover.startsWith('stat:') ? { kind: 'stat', stat: leftover.slice(5) as StatId } : undefined;

  const result = useMemo<OptimizeResult | { error: string }>(() => {
    try {
      return optimize(dex, format, set, goals, {
        field,
        myCond: { ...defaultSide(hasMega), tailwind },
        nature: natureMode === 'suggest' ? { mode: 'suggest' } : { mode: 'fixed' },
        leftover: leftoverOpt,
      });
    } catch (e) {
      return { error: (e as Error).message };
    }
    // leftoverOpt is derived from `leftover`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dex, format, set, goals, field, tailwind, natureMode, leftover, hasMega]);

  const apply = () => {
    if ('error' in result) return;
    const before = { spread: current, nature: set.nature };
    onApply(result.spread, result.nature);
    let kept = 0;
    if (keep && onKeep && keepable > 0) {
      const picked = format.datasetId === 'champions' ? pickSpeedSnapshot(format.regulationId, champRegIds, (id) => metaFor?.(id)) : undefined;
      const list = goals.flatMap((g, i) => benchmarkFromGoal(dex, format, g, { snapshot: picked?.snapshot, field, myCond: { ...defaultSide(hasMega), tailwind }, met: result.goals[i]?.met ?? false }) ?? []);
      if (list.length) {
        onKeep(list);
        kept = list.length;
      }
    }
    toast(`Applied a spread of ${result.spent} ${unit}${result.natureChanged ? ` and ${result.nature}` : ''}${kept ? `, and kept ${kept} ${kept === 1 ? 'goal' : 'goals'} as ${kept === 1 ? 'a benchmark' : 'benchmarks'}` : ''}.`, { label: 'Undo', run: () => onApply(before.spread, before.nature) });
    clearRequest();
    onClose();
  };

  return (
    <div className="space-y-5 text-sm">
      <section aria-label="Goals" className="space-y-2">
        <Label>Goals (earlier ones win if the points run out)</Label>
        {goals.length === 0 && <p className="text-muted">No goals yet. Add one below.</p>}
        <ol className="space-y-1.5">
          {goals.map((g, i) => (
            <li key={i} className="rounded-lg border border-border bg-surface-2 p-2.5">
              <GoalRow dex={dex} format={format} goal={g} mine={set} onChange={(ng) => setGoals((cur) => cur.map((x, j) => (j === i ? ng : x)))} onRemove={() => { setGoals((cur) => cur.filter((_, j) => j !== i)); toast('Removed the goal.', { label: 'Undo', run: () => setGoals((cur) => [...cur.slice(0, i), g, ...cur.slice(i)]) }); }} />
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {(['survive', 'outspeed', 'ko'] as const).map((k) => (
            <Button key={k} size="sm" aria-pressed={adding === k} onClick={() => setAdding(adding === k ? null : k)}>
              <Plus size={13} aria-hidden /> {k === 'survive' ? 'Survive a move' : k === 'outspeed' ? 'Outspeed' : 'Knock out'}
            </Button>
          ))}
        </div>
        {adding && (
          <GoalAdder
            kind={adding}
            dex={dex}
            format={format}
            mine={set}
            field={field}
            onAdd={(g) => {
              setGoals((cur) => [...cur, g]);
              setAdding(null);
            }}
          />
        )}
      </section>

      <section aria-label="Conditions" className="grid gap-3 sm:grid-cols-2">
        <Field label="Battle">
          <Select aria-label="Battle type" value={field.gameType} onChange={(e) => setField({ ...field, gameType: e.target.value as FieldConditions['gameType'] })}>
            <option value="Doubles">Doubles</option>
            <option value="Singles">Singles</option>
          </Select>
        </Field>
        <Field label="Weather">
          <Select aria-label="Weather" value={field.weather} onChange={(e) => setField({ ...field, weather: e.target.value as FieldConditions['weather'] })}>
            {WEATHERS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Terrain">
          <Select aria-label="Terrain" value={field.terrain} onChange={(e) => setField({ ...field, terrain: e.target.value as FieldConditions['terrain'] })}>
            {TERRAINS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="My side">
          <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
            <Checkbox checked={tailwind} onChange={(e) => setTailwind(e.target.checked)} /> Tailwind is up
          </label>
        </Field>
        <Field label="Nature">
          <Select aria-label="Nature" value={natureMode} onChange={(e) => setNatureMode(e.target.value as 'fixed' | 'suggest')}>
            <option value="fixed">Keep {set.nature}</option>
            <option value="suggest">Suggest a nature</option>
          </Select>
        </Field>
        <Field label={`Leftover ${unit}`}>
          <Select aria-label={`Leftover ${unit}`} value={leftover} onChange={(e) => setLeftover(e.target.value)}>
            <option value="none">Leave unspent</option>
            {STAT_IDS.map((s) => (
              <option key={s} value={`stat:${s}`}>
                Put into {STAT_LABELS[s]}
              </option>
            ))}
            <option value="bulkSplit">Max HP, then split evenly</option>
          </Select>
        </Field>
      </section>

      <section aria-label="Result" className="space-y-2">
        <Label>Result</Label>
        {'error' in result ? (
          <p className="text-bad">{result.error}</p>
        ) : (
          <ResultView result={result} current={current} unit={unit} currentNature={set.nature} onApply={apply} keep={onKeep && keepable > 0 ? { value: keep, onChange: setKeep, count: keepable } : undefined} />
        )}
      </section>
    </div>
  );
}

function ResultView({ result, current, unit, currentNature, onApply, keep }: { result: OptimizeResult; current: StatTable; unit: string; currentNature: string; onApply: () => void; keep?: { value: boolean; onChange: (v: boolean) => void; count: number } }) {
  const currentSpent = STAT_IDS.reduce((a, s) => a + current[s], 0);
  const diff = result.spent - currentSpent;
  return (
    <div className="space-y-3">
      {result.goals.length > 0 && (
        <ul className="space-y-1.5" aria-label="Goal results">
          {result.goals.map((g) => (
            <li key={g.index} className="flex items-start gap-2">
              {g.met ? <Check size={16} className="mt-0.5 shrink-0 text-good" aria-label="Met" /> : <X size={16} className="mt-0.5 shrink-0 text-bad" aria-label="Not met" />}
              <div className="min-w-0">
                <p className="font-semibold">{g.label}</p>
                <p className="text-xs text-muted">{g.text}</p>
                {g.shortfall && <p className="text-xs text-bad">{g.shortfall}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <table className="w-full text-xs">
        <caption className="sr-only">Current and suggested spread</caption>
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="py-1 font-semibold">Stat</th>
            <th scope="col" className="py-1 text-right font-semibold">Current</th>
            <th scope="col" className="py-1 text-right font-semibold">Suggested</th>
            <th scope="col" className="py-1 text-right font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          {STAT_IDS.map((s) => {
            const d = result.spread[s] - current[s];
            return (
              <tr key={s} className="border-t border-border font-mono tabular-nums">
                <th scope="row" className="py-1 text-left font-sans font-semibold">{STAT_LABELS[s]}</th>
                <td className="py-1 text-right">{current[s]}</td>
                <td className="py-1 text-right font-bold">{result.spread[s]}</td>
                <td className={cn('py-1 text-right', d === 0 && 'text-muted')}>{d === 0 ? '·' : d > 0 ? `+${d}` : `−${-d}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Chip>{result.spent}/{result.cap} {unit} used</Chip>
        <span>{diff === 0 ? `Same total as now (${currentSpent}).` : diff < 0 ? `${-diff} ${unit} fewer than now (${currentSpent}).` : `${diff} ${unit} more than now (${currentSpent}).`}</span>
        {result.natureChanged && <Chip tone="accent">Nature: {currentNature} → {result.nature}</Chip>}
      </p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {keep && (
          <label className="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
            <Checkbox checked={keep.value} onChange={(e) => keep.onChange(e.target.checked)} />
            Keep {keep.count === 1 ? 'this goal' : `these ${keep.count} goals`} as {keep.count === 1 ? 'a benchmark' : 'benchmarks'}
          </label>
        )}
        <Button variant="primary" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}
