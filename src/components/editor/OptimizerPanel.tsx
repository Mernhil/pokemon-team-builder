import { useMemo, useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { TERRAINS, WEATHERS, defaultField, defaultSide, type FieldConditions } from '@/domain/battle/conditions';
import { calcSpeed } from '@/domain/battle/damage';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { metaSets, type MetaSet } from '@/domain/metaSets';
import { describeGoal, optimize, type Goal, type Leftover, type OptimizeResult } from '@/domain/optimizer';
import { pickSpeedSnapshot } from '@/domain/speedTiers';
import { createSet } from '@/domain/team';
import { spreadKey } from '@/domain/stats';
import { STAT_IDS, STAT_LABELS, type FormatRules, type PokemonSet, type StatId, type StatTable } from '@/domain/types';
import { useOptimizerStore, type OptimizerRequest } from '@/store/optimizerStore';
import { useTeamStore } from '@/store/teamStore';
import { toast } from '@/store/toastStore';
import { Button, Chip, Field, Label, Select } from '../ui/primitives';
import { Modal } from '../ui/Modal';
import { cn } from '../ui/styles';

const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

const ROLLS: { value: number; label: string }[] = [
  { value: 16, label: 'every roll' },
  { value: 15, label: '15 of 16 rolls' },
  { value: 8, label: 'at least half the rolls' },
];

type SourceKind = 'meta' | 'team' | 'any';
type GoalKind = 'survive' | 'outspeed' | 'ko';

interface Source {
  key: string;
  label: string;
  set: PokemonSet;
}

/** Where the other Pokémon in a goal can come from: the most-used sets, my saved teams, or any species. */
function useSources(dex: Dex, format: FormatRules, mine: PokemonSet) {
  const metaFor = useMetaFor();
  const teams = useTeamStore((s) => s.teams);
  return useMemo(() => {
    const picked = format.datasetId === 'champions' ? pickSpeedSnapshot(format.regulationId, champRegIds, (id) => metaFor?.(id)) : undefined;
    const meta: Source[] = picked ? metaSets(picked.snapshot, dex, format, 30).map((m: MetaSet) => ({ key: m.speciesId, label: `${dex.species(m.speciesId)?.name ?? m.speciesId} (${m.usagePct.toFixed(1)}%)`, set: m.set })) : [];
    const saved: Source[] = [];
    for (const t of Object.values(teams)) {
      if (!t.slots.some(Boolean)) continue;
      t.slots.forEach((s, i) => {
        if (s && dex.species(s.speciesId) && s.uid !== mine.uid) saved.push({ key: `${t.id}:${i}`, label: `${t.name} · ${dex.species(s.speciesId)!.name}`, set: s });
      });
    }
    const species = dex.selectableSpecies(format.regulationId);
    // A species in the meta list comes with its set filled in; any other starts blank.
    const anySet = (speciesId: string): PokemonSet => meta.find((m) => m.key === speciesId)?.set ?? createSet(dex, speciesId, format);
    return { meta, saved, species, anySet, hasMeta: meta.length > 0 };
  }, [dex, format, teams, metaFor, mine.uid]);
}

/** Damaging moves of a set, or (for a blank set) everything the species can learn. */
function attackMoves(dex: Dex, set: PokemonSet, format: FormatRules): { id: string; name: string }[] {
  const own = set.moves.flatMap((m) => {
    const mv = m ? dex.move(m) : undefined;
    return mv && mv.category !== 'Status' ? [{ id: mv.id, name: mv.name }] : [];
  });
  if (own.length) return own;
  return dex.learnset(set.speciesId, format.regulationId).filter((m) => m.category !== 'Status').map((m) => ({ id: m.id, name: m.name }));
}

export function OptimizerPanel({
  open,
  onOpenChange,
  dex,
  format,
  set,
  request,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dex: Dex;
  format: FormatRules;
  set: PokemonSet;
  /** Goals to start from (a hand-off from Speed tiers or the Threat report). */
  request?: OptimizerRequest | null;
  onApply: (spread: StatTable, nature: string) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Optimise spread" description="Set goals; get the cheapest spread that meets them." wide>
      {open && <Body key={request ? 'req' : 'new'} dex={dex} format={format} set={set} request={request ?? null} onApply={onApply} onClose={() => onOpenChange(false)} />}
    </Modal>
  );
}

function Body({ dex, format, set, request, onApply, onClose }: { dex: Dex; format: FormatRules; set: PokemonSet; request: OptimizerRequest | null; onApply: (s: StatTable, n: string) => void; onClose: () => void }) {
  const key = spreadKey(format.statSystem);
  const unit = key === 'sp' ? 'SP' : 'EVs';
  const [goals, setGoals] = useState<Goal[]>(request?.goals ?? []);
  const [field, setField] = useState<FieldConditions>(request?.field ?? defaultField());
  const [tailwind, setTailwind] = useState(!!request?.tailwind);
  const [natureMode, setNatureMode] = useState<'fixed' | 'suggest'>('fixed');
  const [leftover, setLeftover] = useState<string>('none');
  const [adding, setAdding] = useState<GoalKind | null>(null);
  const clearRequest = useOptimizerStore((s) => s.clear);

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
    toast(`Applied a spread of ${result.spent} ${unit}${result.natureChanged ? ` and ${result.nature}` : ''}.`, { label: 'Undo', run: () => onApply(before.spread, before.nature) });
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
              <GoalRow dex={dex} format={format} goal={g} mine={set} onChange={(ng) => setGoals((cur) => cur.map((x, j) => (j === i ? ng : x)))} onRemove={() => setGoals((cur) => cur.filter((_, j) => j !== i))} />
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
          <label className="flex h-9 items-center gap-2">
            <input type="checkbox" checked={tailwind} onChange={(e) => setTailwind(e.target.checked)} className="size-4 pointer-coarse:size-5" /> Tailwind is up
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
          <ResultView result={result} current={current} unit={unit} currentNature={set.nature} onApply={apply} />
        )}
      </section>
    </div>
  );
}

function ResultView({ result, current, unit, currentNature, onApply }: { result: OptimizeResult; current: StatTable; unit: string; currentNature: string; onApply: () => void }) {
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
      <div className="flex justify-end">
        <Button variant="primary" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function GoalRow({ dex, format, goal, mine, onChange, onRemove }: { dex: Dex; format: FormatRules; goal: Goal; mine: PokemonSet; onChange: (g: Goal) => void; onRemove: () => void }) {
  const rollsSelect = (value: number, on: (n: number) => void) => (
    <Select aria-label="How sure" className="w-auto" value={value} onChange={(e) => on(Number(e.target.value))}>
      {ROLLS.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </Select>
  );
  const moveSelect = (set: PokemonSet, moveId: string, on: (id: string) => void, label: string) => (
    <Select aria-label={label} className="w-auto" value={moveId} onChange={(e) => on(e.target.value)}>
      {attackMoves(dex, set, format).map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </Select>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-semibold">{describeGoal(dex, goal)}</p>
        <button type="button" onClick={onRemove} aria-label={`Remove goal: ${describeGoal(dex, goal)}`} className="rounded p-1 text-muted hover:text-bad pointer-coarse:p-3">
          <Trash2 size={15} aria-hidden />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {goal.kind === 'survive' && (
          <>
            {moveSelect(goal.attacker, goal.moveId, (moveId) => onChange({ ...goal, moveId }), 'Their move')}
            {rollsSelect(goal.rolls, (rolls) => onChange({ ...goal, rolls }))}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!goal.crit} onChange={(e) => onChange({ ...goal, crit: e.target.checked })} className="size-4 pointer-coarse:size-5" /> Crit
            </label>
          </>
        )}
        {goal.kind === 'ko' && (
          <>
            {moveSelect(mine, goal.moveId, (moveId) => onChange({ ...goal, moveId }), 'My move')}
            <Select aria-label="Hits" className="w-auto" value={goal.hits} onChange={(e) => onChange({ ...goal, hits: Number(e.target.value) as 1 | 2 })}>
              <option value={1}>OHKO</option>
              <option value={2}>2HKO</option>
            </Select>
            {rollsSelect(goal.rolls, (rolls) => onChange({ ...goal, rolls }))}
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!goal.crit} onChange={(e) => onChange({ ...goal, crit: e.target.checked })} className="size-4 pointer-coarse:size-5" /> Crit
            </label>
          </>
        )}
        {goal.kind === 'outspeed' && (
          <>
            <label className="flex items-center gap-1.5">
              Speed to {goal.mode === 'under' ? 'stay under' : 'beat'}
              <input
                type="number"
                inputMode="numeric"
                min={1}
                aria-label="Target Speed"
                value={goal.target}
                onChange={(e) => onChange({ ...goal, target: Math.max(1, Number(e.target.value) || 1) })}
                className="h-8 w-20 rounded border border-border bg-surface px-1.5 font-mono pointer-coarse:h-11"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={goal.mode === 'under'} onChange={(e) => onChange({ ...goal, mode: e.target.checked ? 'under' : 'over' })} className="size-4 pointer-coarse:size-5" /> Trick Room (stay slower)
            </label>
          </>
        )}
      </div>
    </div>
  );
}

function GoalAdder({ kind, dex, format, mine, field, onAdd }: { kind: GoalKind; dex: Dex; format: FormatRules; mine: PokemonSet; field: FieldConditions; onAdd: (g: Goal) => void }) {
  const src = useSources(dex, format, mine);
  const [source, setSource] = useState<SourceKind>(src.hasMeta ? 'meta' : 'any');
  const [pick, setPick] = useState('');
  const [moveId, setMoveId] = useState('');
  const [rolls, setRolls] = useState(16);
  const [hits, setHits] = useState<1 | 2>(1);
  const [crit, setCrit] = useState(false);
  const [theirTailwind, setTheirTailwind] = useState(false);
  const [theirStage, setTheirStage] = useState(0);

  const options: Source[] = source === 'meta' ? src.meta : source === 'team' ? src.saved : src.species.map((s) => ({ key: s.id, label: s.name, set: src.anySet(s.id) }));
  const chosen = options.find((o) => o.key === pick) ?? options[0];
  const them = chosen?.set;
  // The move list belongs to whoever uses the move: them for "survive", me for "knock out".
  const moveOwner = kind === 'ko' ? mine : them;
  const moves = moveOwner ? attackMoves(dex, moveOwner, format) : [];
  const move = moves.find((m) => m.id === moveId)?.id ?? moves[0]?.id;

  const add = () => {
    if (!them) return;
    const theirCond = { ...defaultSide(!!dex.megaFor(them.speciesId, them.itemId)), tailwind: theirTailwind, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: theirStage } };
    if (kind === 'survive' && move) onAdd({ kind: 'survive', attacker: them, attackerCond: theirCond, moveId: move, rolls, crit });
    else if (kind === 'ko' && move) onAdd({ kind: 'ko', defender: them, moveId: move, hits, rolls, crit });
    else if (kind === 'outspeed') {
      const speeds = calcSpeed(dex, { set: them, cond: theirCond }, field).map((r) => r.speed);
      const name = dex.species(them.speciesId)?.name ?? them.speciesId;
      const mods = [theirTailwind && 'Tailwind', theirStage && `${theirStage > 0 ? '+' : ''}${theirStage}`].filter(Boolean).join(', ');
      onAdd({ kind: 'outspeed', target: Math.max(...speeds), label: `${name}${mods ? ` (${mods})` : ''} at ${Math.max(...speeds)}` });
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3" role="group" aria-label={`Add a goal: ${kind === 'survive' ? 'survive a move' : kind === 'outspeed' ? 'outspeed' : 'knock out'}`}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Pokémon from">
          <Select aria-label="Pokémon from" value={source} onChange={(e) => { setSource(e.target.value as SourceKind); setPick(''); }}>
            {src.hasMeta && <option value="meta">Most-used sets (meta)</option>}
            <option value="team" disabled={src.saved.length === 0}>My saved teams</option>
            <option value="any">Any species</option>
          </Select>
        </Field>
        <Field label="Pokémon">
          <Select aria-label="Pokémon" value={chosen?.key ?? ''} onChange={(e) => { setPick(e.target.value); setMoveId(''); }}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {kind !== 'outspeed' && (
          <Field label={kind === 'ko' ? 'My move' : 'Their move'}>
            <Select aria-label={kind === 'ko' ? 'My move to use' : 'Their move to survive'} value={move ?? ''} onChange={(e) => setMoveId(e.target.value)}>
              {moves.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {kind === 'ko' && (
          <Field label="In">
            <Select aria-label="Hits to KO" value={hits} onChange={(e) => setHits(Number(e.target.value) as 1 | 2)}>
              <option value={1}>One hit (OHKO)</option>
              <option value={2}>Two hits (2HKO)</option>
            </Select>
          </Field>
        )}
        {kind !== 'outspeed' && (
          <Field label={kind === 'ko' ? 'KO on' : 'Survive'}>
            <Select aria-label="How sure" value={rolls} onChange={(e) => setRolls(Number(e.target.value))}>
              {ROLLS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {kind !== 'outspeed' && (
          <Field label="Critical hit">
            <label className="flex h-9 items-center gap-2">
              <input type="checkbox" checked={crit} onChange={(e) => setCrit(e.target.checked)} className="size-4 pointer-coarse:size-5" /> Assume a crit
            </label>
          </Field>
        )}
        {kind === 'outspeed' && (
          <>
            <Field label="Their side">
              <label className="flex h-9 items-center gap-2">
                <input type="checkbox" checked={theirTailwind} onChange={(e) => setTheirTailwind(e.target.checked)} className="size-4 pointer-coarse:size-5" /> Tailwind
              </label>
            </Field>
            <Field label="Their Speed stage">
              <Select aria-label="Their Speed stage" value={theirStage} onChange={(e) => setTheirStage(Number(e.target.value))}>
                {[-1, 0, 1, 2].map((n) => (
                  <option key={n} value={n}>
                    {n > 0 ? `+${n}` : n}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </div>
      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={!them || (kind !== 'outspeed' && !move)} onClick={add}>
          Add goal
        </Button>
      </div>
    </div>
  );
}
