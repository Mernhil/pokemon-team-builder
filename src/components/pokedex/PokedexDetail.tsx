import { useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { datasetMechanics, type DexBook } from '@/domain/games';
import {
  LEARN_METHOD_LABELS,
  encountersOf,
  evolutionTree,
  genderText,
  learnedMoves,
  type EvoNode,
  type LearnData,
  type LearnMethod,
  type PokedexData,
} from '@/domain/pokedex';
import { ABILITY_INTERACTIONS } from '@/domain/mechanics';
import { createSet } from '@/domain/team';
import { STAT_IDS, STAT_LABELS, type FormatRules, type Move, type MoveType, type Pokemon, type SpriteSetId } from '@/domain/types';
import { usePokedexStore, type PokedexTab } from '@/store/pokedexStore';
import { useActiveTeam, useTeamStore } from '@/store/teamStore';
import { InfoTooltip } from '../ui/InfoTooltip';
import { MoveTooltip } from '../ui/MoveTooltip';
import { Sprite } from '../ui/Sprite';
import { Toggle } from '../ui/chips';
import { Button, Panel, TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';
import { STAT_COLOR_VAR, TYPE_COLORS } from '../ui/color';
import { AreaView } from './AreaView';

interface Props {
  species: Pokemon;
  dex: Dex;
  data: PokedexData;
  learn: LearnData;
  book: DexBook;
  format: FormatRules;
  onSelect: (id: string) => void;
}

const TABS: { id: PokedexTab; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'moves', label: 'Moves' },
  { id: 'area', label: 'Area' },
];

export function PokedexDetail(props: Props) {
  const { species, book, data } = props;
  const tab = usePokedexStore((s) => s.tab);
  const { setTab } = usePokedexStore.getState();
  const entry = data.entries[species.num];
  const spriteSet = book.spriteSet;
  const regional = data.dexes.filter((d) => entry?.dex?.[d.id] !== undefined);

  return (
    <div className="space-y-3">
      {/* Header card */}
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center" style={{ background: `linear-gradient(135deg, ${TYPE_COLORS[species.types[0]]}22, transparent 55%)` }}>
          <Sprite speciesId={species.id} name={species.name} types={species.types} set={spriteSet} size={120} backdrop className="self-center" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-mono text-sm text-muted">No. {String(species.num).padStart(3, '0')}</span>
              <h2 className="text-2xl font-bold tracking-tight">{species.name}</h2>
            </div>
            {entry?.genus && <p className="text-sm text-muted">{entry.genus}</p>}
            <div className="flex flex-wrap items-center gap-1">
              {species.types.map((t) => (
                <TypeBadge key={t} type={t} />
              ))}
            </div>
            <dl className="flex flex-wrap gap-x-5 gap-y-1 pt-1 text-xs">
              {entry?.heightm !== undefined && <Stat label="Height" value={`${entry.heightm} m`} />}
              <Stat label="Weight" value={`${species.weightkg} kg`} />
              {genderText(species) && <Stat label="Gender" value={genderText(species)!} />}
              {species.eggGroups && <Stat label="Egg groups" value={species.eggGroups.join(', ')} />}
              {regional.map((d) => (
                <Stat key={d.id} label={`${d.name} No.`} value={String(entry!.dex![d.id]).padStart(3, '0')} />
              ))}
            </dl>
          </div>
          <AddToTeam species={species} dex={props.dex} book={book} />
        </div>
        <nav className="flex border-t border-border" aria-label="Pokédex sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 border-b-2 py-2 text-sm font-semibold transition-colors',
                tab === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {t.label}
              {t.id === 'area' && !data.encounters[species.id]?.length && <span className="ml-1 text-[10px] font-normal text-muted">—</span>}
            </button>
          ))}
        </nav>
      </section>

      {tab === 'info' && <InfoTab {...props} />}
      {tab === 'moves' && <MovesTab {...props} />}
      {tab === 'area' && <AreaView species={species} data={data} book={book} encounters={encountersOf(data, species.id)} dex={props.dex} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** "Add to team" when the active team plays this generation. */
function AddToTeam({ species, dex, book }: { species: Pokemon; dex: Dex; book: DexBook }) {
  const team = useActiveTeam();
  const format = getFormat(team.formatId);
  const free = team.slots.findIndex((s) => !s);
  if (format.datasetId !== book.id) return null;
  return (
    <Button
      variant="primary"
      size="sm"
      className="self-start"
      disabled={free < 0}
      title={free < 0 ? 'Your team is full' : `Add to ${team.name}`}
      onClick={() => {
        const { setSlot, setActiveSlot, setView } = useTeamStore.getState();
        setSlot(team.id, free, createSet(dex, species.id, format));
        setActiveSlot(free);
        setView('builder');
      }}
    >
      <Plus size={13} /> Add to team
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------

function InfoTab({ species, dex, data, book, onSelect }: Props) {
  const gen = book.gen;
  const entry = data.entries[species.num];
  const mech = datasetMechanics(book.id, gen);
  const gameName = (id: string) => data.games.find((g) => g.id === id)?.name ?? id;
  const tree = useMemo(() => evolutionTree((id) => dex.species(id), species.id), [dex, species.id]);
  const forms = dex.allSpecies().filter((s) => s.num === species.num && s.id !== species.id);
  const stats = STAT_IDS.filter((s) => mech.splitSpecial || s !== 'spd');
  const total = stats.reduce((a, s) => a + species.baseStats[s], 0);

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel title="Pokédex entries" className="xl:col-span-2">
        {entry?.flavor?.length ? (
          <ul className="space-y-2.5">
            {entry.flavor.map((f) => (
              <li key={f.text} className="text-sm leading-relaxed">
                <span className="mr-2 inline-flex flex-wrap gap-1 align-middle">
                  {f.games.map((g) => (
                    <span key={g} className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {gameName(g)}
                    </span>
                  ))}
                </span>
                {f.text}
              </li>
            ))}
          </ul>
        ) : entry?.fallback ? (
          <p className="text-sm leading-relaxed">
            <span className="mr-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">{entry.fallback.game}</span>
            {entry.fallback.text}
            <span className="mt-1 block text-xs text-muted">No {book.games.replace(/ \(.*\)$/, '')} entry in PokeAPI yet; showing the latest earlier game.</span>
          </p>
        ) : (
          <p className="text-sm text-muted">No entry.</p>
        )}
      </Panel>

      <Panel title="Base stats">
        <div className="space-y-1.5">
          {stats.map((s) => (
            <div key={s} className="grid grid-cols-[3rem_2.25rem_1fr] items-center gap-2 text-sm">
              <span className="font-semibold" style={{ color: STAT_COLOR_VAR[s] }}>
                {!mech.splitSpecial && s === 'spa' ? 'Spc' : STAT_LABELS[s]}
              </span>
              <span className="text-right font-mono tabular-nums">{species.baseStats[s]}</span>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, (species.baseStats[s] / 200) * 100)}%`, background: STAT_COLOR_VAR[s] }} />
              </div>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-1.5 font-mono text-xs text-muted">
            <span>Total</span>
            <b className="text-fg">{total}</b>
          </div>
        </div>
        {mech.abilities && (
          <div className="mt-4 space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Abilities</div>
            {dex.abilitiesOf(species.id).map(({ slot, ability }) => (
              <p key={slot} className="text-xs">
                <InfoTooltip title={ability.name} summary={ability.shortDesc} interactions={ABILITY_INTERACTIONS[ability.id]}>
                  <b className="text-fg underline decoration-dotted">{ability.name}</b>
                </InfoTooltip>
                {slot === 'H' && <span className="ml-1 text-[10px] font-semibold uppercase text-accent">Hidden</span>}
                <span className="text-muted"> — {ability.shortDesc}</span>
              </p>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Type defenses" actions={<span className="text-xs text-muted">Gen {gen} type chart</span>}>
        <TypeDefenses species={species} dex={dex} />
      </Panel>

      <Panel title="Evolution" className="xl:col-span-2">
        {tree && (tree.children.length || tree.species.id !== species.id) ? (
          <EvoTree node={tree} current={species.id} spriteSet={book.spriteSet} onSelect={onSelect} />
        ) : (
          <p className="text-sm text-muted">Does not evolve in {book.id === 'champions' ? book.label : book.game ? book.label : `Gen ${gen}`}.</p>
        )}
        {forms.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Other forms</span>
            {forms.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => !f.isMega && onSelect(f.id)}
                disabled={f.isMega}
                className="flex items-center gap-1 rounded-lg border border-border px-1.5 py-0.5 text-xs hover:border-muted/60 disabled:cursor-default"
                title={f.isMega ? `${f.name} (hold ${dex.item(f.requiredItem)?.name ?? 'its Mega Stone'})` : f.name}
              >
                <Sprite speciesId={f.id} name={f.name} types={f.types} set={book.spriteSet} size={28} />
                {f.forme ?? f.name}
              </button>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function TypeDefenses({ species, dex }: { species: Pokemon; dex: Dex }) {
  const groups = [4, 2, 1, 0.5, 0.25, 0];
  const byMult = new Map<number, string[]>();
  for (const t of dex.types) {
    const m = dex.effectiveness(t, species.types);
    byMult.set(m, [...(byMult.get(m) ?? []), t]);
  }
  const label: Record<number, string> = { 4: '×4', 2: '×2', 1: '×1', 0.5: '×½', 0.25: '×¼', 0: '×0' };
  return (
    <div className="space-y-2">
      {groups
        .filter((g) => byMult.get(g)?.length)
        .map((g) => (
          <div key={g} className="flex items-start gap-2">
            <span className={cn('w-8 shrink-0 pt-0.5 font-mono text-xs font-bold', g > 1 ? 'text-bad' : g < 1 ? 'text-good' : 'text-muted')}>{label[g]}</span>
            <div className="flex flex-wrap gap-1">
              {byMult.get(g)!.map((t) => (
                <TypeBadge key={t} type={t as Pokemon['types'][number]} size="xs" />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function EvoTree({ node, current, spriteSet, onSelect }: { node: EvoNode; current: string; spriteSet: SpriteSetId; onSelect: (id: string) => void }) {
  const sp = node.species;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onSelect(sp.id)}
        className={cn('flex flex-col items-center rounded-lg border px-2 py-1 text-xs', sp.id === current ? 'border-accent bg-accent/10' : 'border-border hover:border-muted/60')}
      >
        <Sprite speciesId={sp.id} name={sp.name} types={sp.types} set={spriteSet} size={56} />
        <span className="font-semibold">{sp.name}</span>
      </button>
      {node.children.length > 0 && (
        <div className="flex flex-col gap-2">
          {node.children.map((c) => (
            <div key={c.species.id} className="flex items-center gap-2">
              <span className="flex max-w-40 items-center gap-1 text-xs text-muted">
                <ChevronRight size={14} className="shrink-0" />
                {c.how}
              </span>
              <EvoTree node={c} current={current} spriteSet={spriteSet} onSelect={onSelect} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

const METHOD_ORDER: LearnMethod[] = ['level', 'machine', 'tutor', 'egg', 'event', 'other'];

function MovesTab({ species, dex, learn, book }: Props) {
  const gen = book.gen;
  const rows = useMemo(() => learnedMoves(learn, species.id), [learn, species.id]);
  const fromPrevo = useMemo(() => {
    const own = new Set(rows.map((r) => r.moveId));
    return (dex.data.learnsets[species.id] ?? []).filter((m) => !own.has(m)).map((m) => dex.move(m)).filter((m): m is Move => !!m);
  }, [rows, dex, species.id]);
  const [typeFilter, setTypeFilter] = useState<MoveType | null>(null);
  const moveTypes = useMemo(
    () => [...new Set([...rows.map((r) => dex.move(r.moveId)?.type), ...fromPrevo.map((m) => m.type)].filter((x): x is MoveType => !!x))].sort(),
    [rows, fromPrevo, dex],
  );
  const activeType = typeFilter && moveTypes.includes(typeFilter) ? typeFilter : null;
  const ofType = (m: Move) => !activeType || m.type === activeType;
  const byMethod = METHOD_ORDER.map((method) => ({
    method,
    rows: rows
      .filter((r) => r.method === method)
      .map((r) => ({ ...r, move: dex.move(r.moveId) }))
      .filter((r): r is typeof r & { move: Move } => !!r.move && ofType(r.move))
      .sort((a, b) => (a.levels?.[0] ?? 0) - (b.levels?.[0] ?? 0) || a.move.name.localeCompare(b.move.name)),
  })).filter((g) => g.rows.length);

  const hasMoves = rows.length > 0 || fromPrevo.length > 0;
  if (!hasMoves) return <Panel title="Moves"><p className="text-sm text-muted">No learnset data.</p></Panel>;
  const prevoShown = fromPrevo.filter(ofType);
  const nothing = !byMethod.length && !prevoShown.length;
  return (
    <div className="space-y-3">
      {moveTypes.length > 1 && (
        <div role="group" aria-label="Filter moves by type" className="scrollbar-thin flex gap-1.5 overflow-x-auto py-1">
          <Toggle pressed={!activeType} onClick={() => setTypeFilter(null)}>All types</Toggle>
          {moveTypes.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={activeType === type}
              aria-label={`${type} moves`}
              onClick={() => setTypeFilter(activeType === type ? null : type)}
              className={cn(
                'inline-flex shrink-0 items-center rounded-md border p-0.5 transition-opacity pointer-coarse:p-1.5',
                activeType === type ? 'border-accent ring-1 ring-accent' : activeType ? 'border-transparent opacity-50 hover:opacity-100' : 'border-transparent hover:opacity-80',
              )}
            >
              <TypeBadge type={type} size="xs" />
            </button>
          ))}
        </div>
      )}
      {nothing && <p className="text-center text-sm text-muted">No {activeType} moves in this learnset.</p>}
      {byMethod.map((g) => (
        <Panel key={g.method} title={LEARN_METHOD_LABELS[g.method]} actions={<span className="text-xs text-muted">{g.rows.length}</span>}>
          <MoveTable book={book} rows={g.rows.map((r) => ({ move: r.move, lead: g.method === 'level' ? (r.levels!.map((l) => (l <= 1 ? '—' : l)).join(' / ')) : undefined }))} lead={g.method === 'level' ? 'Lv' : undefined} />
        </Panel>
      ))}
      {prevoShown.length > 0 &&
        // With no per-move learn method (Champions), this is the species' whole legal movepool, not
        // moves inherited from a pre-evolution — labelled accordingly instead of claiming otherwise.
        (byMethod.length ? (
          <Panel title="Via pre-evolutions" actions={<span className="text-xs text-muted">learned before evolving</span>}>
            <MoveTable book={book} rows={prevoShown.sort((a, b) => a.name.localeCompare(b.name)).map((move) => ({ move }))} />
          </Panel>
        ) : (
          <Panel title="Legal movepool" actions={<span className="text-xs text-muted">no level-up data for {book.games}</span>}>
            <MoveTable book={book} rows={prevoShown.sort((a, b) => a.name.localeCompare(b.name)).map((move) => ({ move }))} />
          </Panel>
        ))}
      <p className="text-center text-xs text-muted">Learnsets for {book.games} · move data as of Gen {gen} ({book.region})</p>
    </div>
  );
}

function MoveTable({ rows, lead, book }: { rows: { move: Move; lead?: string }[]; lead?: string; book: DexBook }) {
  const split = datasetMechanics(book.id, book.gen).moveCategorySplit;
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted">
            {lead && <th className="w-14 px-1 pb-1">{lead}</th>}
            <th className="px-1 pb-1">Move</th>
            <th className="px-1 pb-1">Type</th>
            <th className="px-1 pb-1" title={split ? undefined : 'Before Gen 4, the move’s type decided physical or special'}>Cat.</th>
            <th className="px-1 pb-1 text-right">Pow</th>
            <th className="px-1 pb-1 text-right">Acc</th>
            <th className="px-1 pb-1 text-right">PP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ move, lead: l }, i) => (
              <tr key={move.id + i} className="border-t border-border/60">
                {lead && <td className="px-1 py-1 font-mono text-xs tabular-nums text-muted">{l}</td>}
                <td className="px-1 py-1">
                  <MoveTooltip move={move}>
                    <span className="cursor-help font-medium">{move.name}</span>
                  </MoveTooltip>
                </td>
                <td className="px-1 py-1">
                  <TypeBadge type={move.type} size="xs" />
                </td>
                <td className="px-1 py-1 text-xs text-muted">{move.category}</td>
                <td className="px-1 py-1 text-right font-mono text-xs tabular-nums">{move.basePower || '—'}</td>
                <td className="px-1 py-1 text-right font-mono text-xs tabular-nums">{move.accuracy === true ? '—' : move.accuracy}</td>
                <td className="px-1 py-1 text-right font-mono text-xs tabular-nums">{move.pp}</td>
              </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

