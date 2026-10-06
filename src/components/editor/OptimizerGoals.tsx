import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { defaultSide, type FieldConditions } from '@/domain/battle/conditions';
import { calcSpeed } from '@/domain/battle/damage';
import { describeGoal, type Goal } from '@/domain/optimizer';
import { spreadKey, sumStats } from '@/domain/stats';
import { type FormatRules, type PokemonSet, type StatTable } from '@/domain/types';
import { Combobox } from '../ui/Combobox';
import { Button, Checkbox, Disclosure, Field, Select } from '../ui/primitives';
import { NaturePicker } from './NaturePicker';
import { OpponentStats } from './OpponentStats';
import { comboProps, useItemPicker, useMovePicker } from './options';
import { cn } from '../ui/styles';
import { ROLLS, type SourceKind, type GoalKind, type Source, useSources, attackMoves } from './optimizerShared';

export function GoalRow({ dex, format, goal, mine, onChange, onRemove }: { dex: Dex; format: FormatRules; goal: Goal; mine: PokemonSet; onChange: (g: Goal) => void; onRemove: () => void }) {
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
            <label className="flex items-center gap-1.5 pointer-coarse:min-h-11">
              <Checkbox checked={!!goal.crit} onChange={(e) => onChange({ ...goal, crit: e.target.checked })} /> Crit
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
            <label className="flex items-center gap-1.5 pointer-coarse:min-h-11">
              <Checkbox checked={!!goal.crit} onChange={(e) => onChange({ ...goal, crit: e.target.checked })} /> Crit
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
            <label className="flex items-center gap-1.5 pointer-coarse:min-h-11">
              <Checkbox checked={goal.mode === 'under'} onChange={(e) => onChange({ ...goal, mode: e.target.checked ? 'under' : 'over' })} /> Trick Room (stay slower)
            </label>
          </>
        )}
      </div>
    </div>
  );
}

/** Pick a move: the set's own / most-used moves as one-tap suggestions, then the whole learnset as in the builder. */
function MovePick({
  dex,
  format,
  owner,
  suggestions,
  value,
  onChange,
  label,
}: {
  dex: Dex;
  format: FormatRules;
  owner: PokemonSet;
  suggestions: { id: string; pct?: number }[];
  value: string | undefined;
  onChange: (id: string) => void;
  label: string;
}) {
  const picker = useMovePicker(dex, format, owner);
  const chips = suggestions.flatMap((s) => {
    const mv = dex.move(s.id);
    return mv && mv.category !== 'Status' && dex.canLearn(owner.speciesId, mv.id) ? [{ mv, pct: s.pct }] : [];
  });
  return (
    <div className="space-y-1.5 sm:col-span-2">
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${label}: suggestions`}>
          {chips.map(({ mv, pct }) => (
            <button
              key={mv.id}
              type="button"
              aria-pressed={value === mv.id}
              onClick={() => onChange(mv.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs pointer-coarse:min-h-11',
                value === mv.id ? 'border-accent bg-accent/15 font-semibold' : 'border-border bg-surface hover:bg-surface-2',
              )}
            >
              {mv.name}
              {pct !== undefined && <span className="text-muted">{Math.round(pct)}%</span>}
            </button>
          ))}
        </div>
      )}
      <Combobox
        aria-label={`${label}: all moves`}
        {...comboProps(picker)}
        value={value ?? ''}
        placeholder="Search all moves"
        onChange={(id) => {
          picker.remember(id);
          onChange(id);
        }}
      />
    </div>
  );
}

export function GoalAdder({ kind, dex, format, mine, field, onAdd }: { kind: GoalKind; dex: Dex; format: FormatRules; mine: PokemonSet; field: FieldConditions; onAdd: (g: Goal) => void }) {
  const src = useSources(dex, format, mine);
  const [source, setSource] = useState<SourceKind>(src.hasMeta ? 'meta' : 'any');
  const [pick, setPick] = useState('');
  const [moveId, setMoveId] = useState('');
  const [rolls, setRolls] = useState(16);
  const [hits, setHits] = useState<1 | 2>(1);
  const [crit, setCrit] = useState(false);
  const [theirTailwind, setTheirTailwind] = useState(false);
  const [theirStage, setTheirStage] = useState(0);
  // Edits to the other Pokémon's set; dropped whenever a different Pokémon is picked.
  const [tweaks, setTweaks] = useState<Partial<PokemonSet>>({});

  const options: Source[] = source === 'meta' ? src.meta : source === 'team' ? src.saved : src.species.map((s) => ({ key: s.id, label: s.name, set: src.anySet(s.id), moveShare: src.shareFor(s.id) }));
  const chosen = options.find((o) => o.key === pick) ?? options[0];
  const them: PokemonSet | undefined = chosen && { ...chosen.set, ...tweaks };
  const species = them ? dex.species(them.speciesId) : undefined;
  const itemPicker = useItemPicker(dex, format, them?.speciesId);
  const choose = (key: string) => {
    setPick(key);
    setMoveId('');
    setTweaks({});
  };

  // The move belongs to whoever uses it: them for "survive", me for "knock out".
  const moveOwner = kind === 'ko' ? mine : them;
  const suggestions: { id: string; pct?: number }[] =
    kind === 'ko'
      ? mine.moves.filter(Boolean).map((id) => ({ id }))
      : chosen?.moveShare?.length
        ? chosen.moveShare
        : (chosen?.set.moves ?? []).filter(Boolean).map((id) => ({ id }));
  const attacks = moveOwner ? attackMoves(dex, moveOwner, format) : [];
  const move = moveId || suggestions.find((s) => dex.move(s.id)?.category !== 'Status')?.id || attacks[0]?.id;
  const moveOk = !!move && dex.move(move)?.category !== 'Status';
  const nature = them ? dex.nature(them.nature) : undefined;
  const key = spreadKey(format.statSystem);

  const add = () => {
    if (!them) return;
    const theirCond = { ...defaultSide(!!dex.megaFor(them.speciesId, them.itemId)), tailwind: theirTailwind, boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: theirStage } };
    if (kind === 'survive' && move) onAdd({ kind: 'survive', attacker: them, attackerCond: theirCond, moveId: move, rolls, crit });
    else if (kind === 'ko' && move) onAdd({ kind: 'ko', defender: them, moveId: move, hits, rolls, crit });
    else if (kind === 'outspeed') {
      const speeds = calcSpeed(dex, { set: them, cond: theirCond }, field).map((r) => r.speed);
      const name = dex.species(them.speciesId)?.name ?? them.speciesId;
      const mods = [theirTailwind && 'Tailwind', theirStage && `${theirStage > 0 ? '+' : ''}${theirStage}`].filter(Boolean).join(', ');
      const isMetaSet = source === 'meta' && Object.keys(tweaks).length === 0;
      onAdd({
        kind: 'outspeed',
        target: Math.max(...speeds),
        label: `${name}${mods ? ` (${mods})` : ''} at ${Math.max(...speeds)}`,
        foe: isMetaSet ? { speciesId: them.speciesId, source: 'meta' } : { speciesId: them.speciesId, source: 'custom', set: them },
        scenario: { tailwind: theirTailwind || undefined, stage: theirStage || undefined },
      });
    }
  };

  const abilityIds = [...new Set(Object.values(species?.abilities ?? {}).flatMap((a) => (a ? [dex.ability(a)?.id ?? a] : [])))];

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-3" role="group" aria-label={`Add a goal: ${kind === 'survive' ? 'survive a move' : kind === 'outspeed' ? 'outspeed' : 'knock out'}`}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Pokémon from">
          <Select aria-label="Pokémon from" value={source} onChange={(e) => { setSource(e.target.value as SourceKind); choose(''); }}>
            {src.hasMeta && <option value="meta">Most-used sets (meta)</option>}
            <option value="team" disabled={src.saved.length === 0}>My saved teams</option>
            <option value="any">Any species</option>
          </Select>
        </Field>
        <Field label="Pokémon">
          <Select aria-label="Pokémon" value={chosen?.key ?? ''} onChange={(e) => choose(e.target.value)}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {kind !== 'outspeed' && moveOwner && (
          <Field label={kind === 'ko' ? 'My move' : 'Their move'} className="sm:col-span-2">
            <MovePick
              key={`${kind}:${moveOwner.speciesId}`}
              dex={dex}
              format={format}
              owner={moveOwner}
              suggestions={suggestions}
              value={move}
              onChange={setMoveId}
              label={kind === 'ko' ? 'My move to use' : 'Their move to survive'}
            />
            {move && !moveOk && <p className="mt-1 text-xs text-bad">{dex.move(move)?.name} doesn't deal damage. Pick an attack.</p>}
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
            <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
              <Checkbox checked={crit} onChange={(e) => setCrit(e.target.checked)} /> Assume a crit
            </label>
          </Field>
        )}
        {kind === 'outspeed' && (
          <>
            <Field label="Their side">
              <label className="flex min-h-9 items-center gap-2 pointer-coarse:min-h-11">
                <Checkbox checked={theirTailwind} onChange={(e) => setTheirTailwind(e.target.checked)} /> Tailwind
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

      {them && (
        <Disclosure
          title={`${species?.name ?? them.speciesId}'s set`}
          summary={[dex.item(them.itemId ?? '')?.name, them.nature, `${sumStats((key === 'sp' ? them.sp : them.evs) as StatTable)} ${key === 'sp' ? 'SP' : 'EVs'}`].filter(Boolean).join(' · ')}
        >
          <div className="space-y-3 pt-1">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Item">
                <Combobox
                  aria-label="Their item"
                  {...comboProps(itemPicker)}
                  value={them.itemId ?? ''}
                  allowClear
                  placeholder="No item"
                  onChange={(id) => {
                    itemPicker.remember(id);
                    setTweaks((t) => ({ ...t, itemId: id || undefined }));
                  }}
                />
              </Field>
              {abilityIds.length > 0 && (
                <Field label="Ability">
                  <Select aria-label="Their ability" value={them.abilityId ?? ''} onChange={(e) => setTweaks((t) => ({ ...t, abilityId: e.target.value }))}>
                    {abilityIds.map((id) => (
                      <option key={id} value={id}>
                        {dex.ability(id)?.name ?? id}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {nature && (
                <Field label="Nature">
                  <NaturePicker dex={dex} value={them.nature} onChange={(n) => setTweaks((t) => ({ ...t, nature: n }))} />
                </Field>
              )}
            </div>
            <OpponentStats dex={dex} format={format} set={them} onChange={(patch) => setTweaks((t) => ({ ...t, ...patch }))} />
          </div>
        </Disclosure>
      )}

      <div className="flex justify-end">
        <Button variant="primary" size="sm" disabled={!them || (kind !== 'outspeed' && !moveOk)} onClick={add}>
          Add goal
        </Button>
      </div>
    </div>
  );
}
