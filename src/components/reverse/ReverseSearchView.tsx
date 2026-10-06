import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, Plus, Search, Shield, Swords, Trash2, X, Zap, type LucideIcon } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { defaultField, defaultSide, type FieldConditions } from '@/domain/battle/conditions';
import { META_STALE_DAYS, byUsage, isProvisional, provisionalNote } from '@/domain/meta';
import { REGULATION_MANIFEST } from '@/domain/formats';
import {
  CONDITION_LABEL,
  attackingTypes,
  candidateUsageLabel,
  describeCondition,
  targetFor,
  type Condition,
  type ConditionKind,
  type Match,
} from '@/domain/reverseSearch';
import { snapshotAge } from '@/domain/speedTiers';
import { MAX_REQUIRED_MOVES } from '@/domain/reverseSearch';
import type { FormatRules, PokemonSet, Team } from '@/domain/types';
import { useCalcStore } from '@/store/calcStore';
import { useReverseSeed } from '@/store/reverseSeedStore';
import { useTeamStore } from '@/store/teamStore';
import { toast } from '@/store/toastStore';
import { FieldControls, Segmented, Toggle } from '../battle/Controls';
import { SpeciesPicker } from '../editor/SpeciesPicker';
import { Combobox, type ComboOption } from '../ui/Combobox';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, Disclosure, EmptyState, LoadingState, Notice, Panel, Select, TypeBadge } from '../ui/primitives';
import { TargetEditor } from './TargetEditor';
import { useReverseSearch } from './useReverseSearch';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions');
const fmtMonth = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const SHOWN = 48;

const KIND_HINT: Record<ConditionKind, string> = {
  ohko: 'Has a move that knocks the target out in one hit.',
  survive: "Takes the target's strongest hit without fainting.",
  resist: "Takes half or less from every type the target attacks with (type chart only).",
  outspeed: 'Moves before the target (reversed under Trick Room).',
};

let counter = 0;
const nextId = () => `c${++counter}`;

/**
 * Reverse search: describe the Pokémon you need ("one-shots Rillaboom, survives Incineroar, resists Dragon
 * moves") and get every Pokémon that fits. Each condition is checked with the Damage Calc engine against
 * the opponent's most-used set (editable), and each answer is a most-used set too, or a generic attacker build.
 */
export function ReverseSearchView({ dex, format, team }: { dex: Dex; format: FormatRules; team: Team }) {
  const [conditions, setConditions] = useState<Condition[]>([]);
  // Moves every answer has to know ("a Fake Out user that…").
  const [knows, setKnows] = useState<string[]>([]);
  const [field, setField] = useState<FieldConditions>(defaultField());
  const [kind, setKind] = useState<ConditionKind>('ohko');
  const [shown, setShown] = useState(SHOWN);
  const search = useReverseSearch({ dex, format, conditions, knows, field });
  const { picked, loading, candidates, matches, checked, done } = search;
  const setView = useTeamStore((s) => s.setView);

  // Opened from a teammate suggestion: start with "one-shots <threat>" conditions (once the meta numbers are in).
  const seed = useReverseSeed((x) => x.seed);
  useEffect(() => {
    if (!seed || loading) return;
    useReverseSeed.getState().set(null);
    setConditions(seed.speciesIds.slice(0, 3).map((id) => ({ id: nextId(), kind: seed.kind, target: targetFor(dex, format, id, picked?.snapshot) })));
  }, [seed, loading, dex, format, picked]);

  const add = (speciesId: string) => {
    if (!speciesId) return;
    const target = targetFor(dex, format, speciesId, picked?.snapshot);
    setConditions((cs) => [...cs, { id: nextId(), kind, target, ...(kind === 'survive' ? { hits: 1 as const } : {}) }]);
    setShown(SHOWN);
  };
  const patch = (id: string, p: Partial<Condition>) => setConditions((cs) => cs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const patchSet = (id: string, p: Partial<PokemonSet>) =>
    setConditions((cs) => cs.map((c) => (c.id === id ? { ...c, target: { ...c.target, set: { ...c.target.set, ...p } } } : c)));
  const remove = (id: string) => setConditions((cs) => cs.filter((c) => c.id !== id));

  const addToTeam = (m: Match) => {
    const slot = team.slots.findIndex((s) => s === null);
    if (slot < 0) return toast(`${team.name} is full. Remove a Pokémon first.`);
    useTeamStore.getState().setSlot(team.id, slot, { ...structuredClone(m.candidate.set), uid: crypto.randomUUID() });
    toast(`Added ${dex.species(m.candidate.speciesId)?.name ?? m.candidate.speciesId} to ${team.name}.`);
  };
  const openCalc = (m: Match) => {
    const against = conditions.find((c) => c.kind !== 'resist') ?? conditions[0];
    const calc = useCalcStore.getState();
    calc.setSide('attacker', { set: m.candidate.set, cond: defaultSide(m.candidate.megaMode !== 'base'), crits: [false, false, false, false] });
    if (!against) {
      setView('calc');
      return;
    }
    calc.setSide('defender', { set: against.target.set, cond: { ...defaultSide(against.target.megaMode !== 'base'), megaMode: against.target.megaMode }, crits: [false, false, false, false] });
    calc.setField(field);
    setView('calc');
  };

  // Every move the format allows, for the "has to know" picker.
  const moveOptions = useMemo<ComboOption[]>(
    () =>
      Object.values(dex.data.moves)
        .filter((mv) => !format.regulationId || mv.legalIn.includes(format.regulationId))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((mv) => ({
          id: mv.id,
          label: mv.name,
          keywords: `${mv.type} ${mv.category}`,
          disabled: knows.includes(mv.id),
          render: (
            <span className="flex items-center gap-2">
              <TypeBadge type={mv.type} size="xs" />
              <span className="flex-1 truncate">{mv.name}</span>
              <span className="text-[11px] text-muted">{mv.category}</span>
            </span>
          ),
        })),
    [dex, format.regulationId, knows],
  );
  const addKnows = (id: string) => {
    if (id && !knows.includes(id) && knows.length < MAX_REQUIRED_MOVES) {
      setKnows((k) => [...k, id]);
      setShown(SHOWN);
    }
  };

  // Starter ideas for the empty screen: the most-used Pokémon of the live meta, and the support moves players ask for.
  const topIds = useMemo(
    () =>
      picked
        ? [...picked.snapshot.entries]
            .sort(byUsage)
            .map((e) => e.speciesId)
            .filter((id) => dex.species(id))
            .slice(0, 3)
        : [],
    [picked, dex],
  );
  const ideas = useMemo(() => {
    const out: { id: string; icon: LucideIcon; title: string; text: string; preview: ReactNode; run: () => void }[] = [];
    const faces = (ids: string[]) =>
      ids.map((id) => <Sprite key={id} speciesId={id} name={dex.species(id)?.name ?? id} types={dex.species(id)?.types} set={format.spriteSet} size={32} />);
    const fromMeta = (kind: ConditionKind) => () => {
      setConditions(topIds.map((id) => ({ id: nextId(), kind, target: targetFor(dex, format, id, picked?.snapshot), ...(kind === 'survive' ? { hits: 1 as const } : {}) })));
      setShown(SHOWN);
    };
    if (topIds.length) {
      out.push({ id: 'ohko-top', icon: Swords, title: 'Take down the top threats', text: 'Pokémon that one-shot all of the most-used Pokémon right now.', preview: faces(topIds), run: fromMeta('ohko') });
      out.push({ id: 'survive-top', icon: Shield, title: 'Stand up to the top threats', text: 'Pokémon that survive the strongest hit from each of the most-used Pokémon.', preview: faces(topIds), run: fromMeta('survive') });
    }
    const MOVES: [id: string, text: string][] = [
      ['fakeout', 'Pokémon that can flinch the opposing leads.'],
      ['trickroom', 'Pokémon that can flip the speed order.'],
      ['tailwind', 'Pokémon that can double your team’s speed.'],
      ['wideguard', 'Pokémon that can block spread moves.'],
    ];
    for (const [id, text] of MOVES) {
      const mv = dex.move(id);
      if (!mv || (format.regulationId && !mv.legalIn.includes(format.regulationId))) continue;
      out.push({ id, icon: Zap, title: `A ${mv.name} user`, text, preview: <TypeBadge type={mv.type} size="xs" />, run: () => { setKnows([id]); setShown(SHOWN); } });
    }
    return out;
  }, [dex, format, picked, topIds]);

  const age = picked ? snapshotAge(picked.snapshot) : undefined;
  const regName = picked ? champRegs.find((r) => r.id === picked.regulationId)?.shortName ?? picked.regulationId : '';
  const note = picked && isProvisional(picked.snapshot) ? provisionalNote(picked.snapshot, (id) => champRegs.find((r) => r.id === id)?.shortName) : undefined;
  const metaCount = useMemo(() => candidates.filter((c) => c.build === 'meta').length, [candidates]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-bold">
          <Search size={18} aria-hidden /> Reverse search
        </h1>
        <p className="text-sm text-muted">
          Say what you need and get the Pokémon that do it: one-shot a threat, survive another, resist a third, all at once.
        </p>
      </div>

      <Panel title="What it has to do">
        <div className="space-y-3">
          {conditions.length === 0 && <p className="text-sm text-muted">Add a condition below. Every condition has to hold for a Pokémon to show up.</p>}
          <ul className="space-y-2">
            {conditions.map((c) => {
              const name = dex.species(c.target.speciesId)?.name ?? c.target.speciesId;
              return (
                <li key={c.id} className="rounded-lg border border-border bg-surface-2/40 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sprite speciesId={c.target.speciesId} name={name} types={dex.species(c.target.speciesId)?.types} set={format.spriteSet} size={36} />
                    <span className="min-w-0 flex-1 basis-40 text-sm font-semibold">{describeCondition(dex, c)}</span>
                    {c.kind === 'survive' && (
                      <Segmented<'1' | '2'> label="Hits" value={String(c.hits ?? 1) as '1' | '2'} options={[{ id: '1', label: '1' }, { id: '2', label: '2' }]} onChange={(v) => patch(c.id, { hits: Number(v) as 1 | 2 })} />
                    )}
                    {c.kind === 'ohko' && (
                      <Toggle on={!!c.allowPossible} onChange={(allowPossible) => patch(c.id, { allowPossible })}>
                        Possible OHKO counts
                      </Toggle>
                    )}
                    <Button variant="ghost" aria-label={`Remove: ${describeCondition(dex, c)}`} onClick={() => remove(c.id)}>
                      <Trash2 size={15} aria-hidden />
                    </Button>
                  </div>
                  {c.kind === 'resist' && (
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
                      {name} attacks with
                      {attackingTypes(dex, c.target).map((t) => (
                        <TypeBadge key={t} type={t} size="xs" />
                      ))}
                      (from its moves below)
                    </p>
                  )}
                  <details className="group mt-1">
                    <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-fg">
                      {name}&apos;s set: {dex.item(c.target.set.itemId)?.name ?? 'no item'} · {c.target.set.moves.filter(Boolean).map((m) => dex.move(m)?.name ?? m).join(', ') || 'no moves'}
                    </summary>
                    <TargetEditor dex={dex} format={format} set={c.target.set} onChange={(p) => patchSet(c.id, p)} />
                  </details>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              Condition
              <Select aria-label="Condition type" value={kind} onChange={(e) => setKind(e.target.value as ConditionKind)} title={KIND_HINT[kind]}>
                {(Object.keys(CONDITION_LABEL) as ConditionKind[]).map((k) => (
                  <option key={k} value={k}>
                    {CONDITION_LABEL[k]}
                  </option>
                ))}
              </Select>
            </label>
            <div className="min-w-48 flex-1">
              <SpeciesPicker dex={dex} format={format} showGenFilter={false} placeholder={`${CONDITION_LABEL[kind]}… pick a Pokémon`} onChange={add} />
            </div>
          </div>
          <p className="text-xs text-muted">{KIND_HINT[kind]}</p>

          <div className="space-y-2 border-t border-border pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Has to know a move</div>
            {knows.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Required moves">
                {knows.map((id) => {
                  const mv = dex.move(id);
                  return (
                    <li key={id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-2 text-sm">
                      {mv && <TypeBadge type={mv.type} size="xs" />}
                      <span className="font-medium">{mv?.name ?? id}</span>
                      <button type="button" aria-label={`Remove ${mv?.name ?? id}`} onClick={() => setKnows((k) => k.filter((x) => x !== id))} className="rounded-full p-1 text-muted hover:text-bad pointer-coarse:p-2.5">
                        <X size={13} aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {knows.length < MAX_REQUIRED_MOVES && (
              <Combobox aria-label="Add a required move" options={moveOptions} value="" placeholder="Fake Out, Wide Guard, Trick Room… pick a move" onChange={addKnows} />
            )}
            <p className="text-xs text-muted">
              Only Pokémon that can learn it show up, built to know it: if its usual set lacks the move, it goes in place of a status move first, and the answer says what it replaced.
              Combine it with the conditions above, e.g. a Fake Out user that one-shots Sylveon.
            </p>
          </div>
        </div>
      </Panel>

      <Disclosure title="Battle conditions" summary={field.weather || field.terrain || field.trickRoom ? 'custom' : 'none'}>
        <FieldControls field={field} onChange={(p) => setField((f) => ({ ...f, ...p }))} compact gen={dex.generation} game={format.game} />
      </Disclosure>

      {picked && age && (
        <p className="text-xs text-muted">
          Builds use the most-used sets from {regName} ({fmtMonth(age.dataDate.slice(0, 7))}
          {age.days > META_STALE_DAYS ? `, ${age.days} days old` : ''}); {metaCount} of {candidates.length} Pokémon have one, the rest get a generic attacker build with no item.
        </p>
      )}
      {note && <Notice tone="warn">{note}</Notice>}
      {!picked && format.datasetId === 'champions' && !loading && (
        <Notice tone="warn">No usage data yet, so every answer uses a generic attacker build with no item.</Notice>
      )}

      {loading ? (
        <LoadingState label="Loading meta data…" />
      ) : conditions.length === 0 && knows.length === 0 ? (
        <section aria-labelledby="rs-ideas" className="space-y-3">
          <div>
            <h2 id="rs-ideas" className="text-sm font-semibold">
              Start from an idea
            </h2>
            <p className="text-sm text-muted">One tap fills in the conditions above, then change anything you like.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ideas.map((idea) => (
              <li key={idea.id}>
                <button
                  type="button"
                  onClick={idea.run}
                  className="ui-panel hit flex h-full w-full flex-col items-start gap-1.5 rounded-xl border border-border bg-surface p-3.5 text-left transition-colors hover:border-accent focus-visible:border-accent"
                >
                  <span className="flex w-full items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
                      <idea.icon size={16} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-bold">{idea.title}</span>
                  </span>
                  <span className="text-xs text-muted">{idea.text}</span>
                  <span className="mt-auto flex min-h-9 items-center gap-1 pt-1">{idea.preview}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section aria-labelledby="rs-results" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="rs-results" className="text-sm font-semibold">
              {done ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}` : `${matches.length} so far…`}
            </h2>
            <span role="status" className="text-xs text-muted">
              {done ? `Checked ${candidates.length} Pokémon` : `Checked ${checked} of ${candidates.length}…`}
            </span>
          </div>
          {done && matches.length === 0 && (
            <EmptyState icon={X} title="No Pokémon does all of that">
              Remove a condition, or loosen one (let a possible OHKO count, survive one hit instead of two).
            </EmptyState>
          )}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {matches.slice(0, shown).map((m) => {
              const sp = dex.species(m.candidate.speciesId);
              const set = m.candidate.set;
              return (
                <li key={m.candidate.speciesId} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-surface p-3">
                  <div className="flex items-center gap-2">
                    <Sprite speciesId={m.candidate.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{sp?.name ?? m.candidate.speciesId}</div>
                      <div className="flex flex-wrap gap-1">{sp?.types.map((t) => <TypeBadge key={t} type={t} size="xs" />)}</div>
                    </div>
                    <Chip tone={m.candidate.build === 'meta' ? 'accent' : 'neutral'}>
                      {m.candidate.build === 'meta' ? `Meta set · ${candidateUsageLabel(m.candidate)}` : 'Generic build'}
                    </Chip>
                  </div>
                  <ul className="space-y-0.5 text-xs">
                    {knows.map((id) => {
                      const mv = dex.move(id);
                      const changes = m.candidate.moveChanges;
                      const added = !!mv && !!changes?.added.includes(mv.name);
                      return (
                        <li key={`knows-${id}`} className="flex items-start gap-1.5">
                          <Check size={13} className="mt-0.5 shrink-0 text-good" aria-hidden />
                          <span>
                            <span className="font-medium">Knows {mv?.name ?? id}</span>
                            <span className="text-muted">
                              {' · '}
                              {added ? `added${changes && changes.dropped.length ? `, replacing ${changes.dropped.join(', ')}` : ''}` : 'in its usual set'}
                            </span>
                          </span>
                        </li>
                      );
                    })}
                    {m.results.map((r) => {
                      const c = conditions.find((x) => x.id === r.conditionId);
                      return (
                        <li key={r.conditionId} className="flex items-start gap-1.5">
                          <Check size={13} className="mt-0.5 shrink-0 text-good" aria-hidden />
                          <span>
                            <span className="font-medium">{c ? describeCondition(dex, c) : ''}</span>
                            <span className="text-muted"> · {r.detail}</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="truncate text-xs text-muted" title="The build the numbers use">
                    {dex.item(set.itemId)?.name ?? 'No item'} · {set.nature} · {set.moves.filter(Boolean).map((mv) => dex.move(mv)?.name ?? mv).join(', ')}
                  </p>
                  <div className="mt-auto flex gap-1.5">
                    <Button onClick={() => addToTeam(m)} aria-label={`Add ${sp?.name ?? m.candidate.speciesId} to team`}>
                      <Plus size={14} aria-hidden /> Add to team
                    </Button>
                    <Button variant="ghost" onClick={() => openCalc(m)}>
                      Open in Calc
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {matches.length > shown && (
            <div className="text-center">
              <Button onClick={() => setShown((n) => n + SHOWN)}>Show more ({matches.length - shown} left)</Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
