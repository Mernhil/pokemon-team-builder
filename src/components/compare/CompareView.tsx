import { Suspense, lazy, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Columns2, Copy, Link2 } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useDex } from '@/data/useDex';
import { getFormat } from '@/domain/formats';
import { nameOf } from '@/domain/sharing';
import { buildLadder, neutralScenario, type SpeedRow } from '@/domain/speedTiers';
import { compareTeams, teamChoices, type SetChange, type SetDiff } from '@/domain/teamCompare';
import type { Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { useShareStore } from '@/sync/shareStore';
import { DefenseMatrix } from '../analysis/DefenseMatrix';
import { OffenseMatrix } from '../analysis/OffenseMatrix';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, LoadingState, Notice, Panel, Select } from '../ui/primitives';
import { cn, typeGradient } from '../ui/styles';

const TopThreats = lazy(() => import('../threats/TopThreats').then((m) => ({ default: m.TopThreats })));

/** Two cells side by side from `md` up, stacked on phones (A above B). */
function Pair({ label, a, b }: { label: string; a: ReactNode; b: ReactNode }) {
  return (
    <section aria-label={label} className="grid gap-3 md:grid-cols-2">
      <div className="min-w-0 space-y-3" role="group" aria-label={`${label}, team A`}>{a}</div>
      <div className="min-w-0 space-y-3" role="group" aria-label={`${label}, team B`}>{b}</div>
    </section>
  );
}

/** Compare: two teams side by side — type matrices, speeds, top threats — and a set-by-set diff. */
export function CompareView({ teamId }: { teamId?: string } = {}) {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const activeId = useTeamStore((s) => s.activeTeamId);
  const names = useShareStore((s) => s.names);
  const choices = useMemo(() => teamChoices(teams, order), [teams, order]);

  const [pickedA, setA] = useState(() => (teams[activeId] ? activeId : choices[0]?.id ?? ''));
  // Inside Analyse, team A is the team picked in its header.
  const aId = teamId && teams[teamId] ? teamId : pickedA;
  const [bId, setB] = useState(() => {
    const a = teams[activeId];
    const sibling = a && choices.find((c) => c.id !== a.id && (teams[c.id]?.groupId ?? c.id) === (a.groupId ?? a.id));
    return sibling?.id ?? choices.find((c) => c.id !== aId)?.id ?? '';
  });
  const a = teams[aId];
  const b = teams[bId];

  if (choices.length < 2) {
    return (
      <EmptyState icon={Columns2} title="You need two teams to compare">
        Save another team (or a variation of this one), or accept a team someone shares with you, and it appears here.
      </EmptyState>
    );
  }

  const picker = (label: string, value: string, set: (id: string) => void) => (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-muted">
      {label}
      <Select aria-label={label} value={value} onChange={(e) => set(e.target.value)} className="w-full">
        {(['mine', 'shared'] as const).map((g) => {
          const list = choices.filter((c) => c.group === g);
          return list.length ? (
            <optgroup key={g} label={g === 'mine' ? 'My teams' : 'Shared with me'}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
      </Select>
    </label>
  );

  return (
    <div className="space-y-3">
      <Panel bodyClassName="flex flex-wrap items-end gap-3 p-3">
        {teamId ? (
          <p className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-muted">
            Team A
            <span className="truncate text-sm font-medium text-fg">{a ? `${a.name}${a.variationLabel ? ` · ${a.variationLabel}` : ''}` : '—'} (picked above)</span>
          </p>
        ) : (
          <>
            {picker('Team A', aId, setA)}
            <Button size="icon" aria-label="Swap the two teams" onClick={() => (setA(bId), setB(aId))}>
              <ArrowLeftRight size={15} aria-hidden />
            </Button>
          </>
        )}
        {picker('Team B', bId, setB)}
      </Panel>
      {a && b ? <Comparison a={a} b={b} names={names} /> : <EmptyState title="Pick two teams." />}
    </div>
  );
}

function Comparison({ a, b, names }: { a: Team; b: Team; names: Record<string, string> }) {
  const fa = getFormat(a.formatId);
  const fb = getFormat(b.formatId);
  const da = useDex(fa.datasetId);
  const db = useDex(fb.datasetId);
  const diff = useMemo(() => compareTeams(a, b), [a, b]);
  if (da.status === 'error' || db.status === 'error') return <p className="p-10 text-center text-sm text-bad" role="alert">Couldn't load the Pokédex data.</p>;
  if (da.status !== 'ready' || db.status !== 'ready') return <LoadingState label="Loading…" />;
  const dexA = da.dex;
  const dexB = db.dex;

  const header = (t: Team, dex: Dex, who: string) => {
    const f = getFormat(t.formatId);
    return (
      <Panel title={`${who}: ${t.name}${t.variationLabel ? ` · ${t.variationLabel}` : ''}`} bodyClassName="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip>{t.category || f.shortName}</Chip>
          {t.shared && <Chip tone="accent">{nameOf(t.shared.owner, names)} · {t.shared.role === 'edit' ? 'can edit' : 'view only'}</Chip>}
        </div>
        <ol className="grid grid-cols-6 gap-1" aria-label={`${who} members`}>
          {t.slots.map((s, i) => {
            if (!s) return <li key={i} className="aspect-square rounded-lg border border-dashed border-border" aria-label={`Slot ${i + 1}: empty`} />;
            const sp = dex.species(s.speciesId);
            return (
              <li key={i} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg" style={{ background: sp ? typeGradient(sp.types) : undefined }} title={sp?.name}>
                <Sprite speciesId={s.speciesId} name={sp?.name} types={sp?.types} set={f.spriteSet} size={40} />
              </li>
            );
          })}
        </ol>
      </Panel>
    );
  };

  const note = !diff.sameFormat ? (
    <Notice tone="accent">These two teams are for different games or regulations ({fa.shortName} and {fb.shortName}), so some comparisons won't line up.</Notice>
  ) : null;

  return (
    <div className="space-y-3">
      {diff.sameFolder && (
        <Notice tone="accent" icon={Link2}>
          These are variations of the same team. Changed Pokémon are highlighted below.
        </Notice>
      )}
      {note}
      <Pair label="Teams" a={header(a, dexA, 'A')} b={header(b, dexB, 'B')} />
      <Pair label="Defensive type matrix" a={<DefenseMatrix team={a} dex={dexA} format={fa} />} b={<DefenseMatrix team={b} dex={dexB} format={fb} />} />
      <Pair label="Offensive type matrix" a={<OffenseMatrix team={a} dex={dexA} mega={fa.capabilities.mega} />} b={<OffenseMatrix team={b} dex={dexB} mega={fb.capabilities.mega} />} />
      <Pair label="Speed" a={<SpeedPanel team={a} dex={dexA} format={fa} />} b={<SpeedPanel team={b} dex={dexB} format={fb} />} />
      {(fa.datasetId === 'champions' || fb.datasetId === 'champions') && (
        <Pair
          label="Top threats"
          a={fa.datasetId === 'champions' ? <ThreatsPanel team={a} dex={dexA} format={fa} /> : <Panel title="Top threats"><p className="p-3 text-sm text-muted">Only for Champions teams.</p></Panel>}
          b={fb.datasetId === 'champions' ? <ThreatsPanel team={b} dex={dexB} format={fb} /> : <Panel title="Top threats"><p className="p-3 text-sm text-muted">Only for Champions teams.</p></Panel>}
        />
      )}
      <DiffPanel diff={diff} dexA={dexA} dexB={dexB} a={a} b={b} />
    </div>
  );
}

function ThreatsPanel({ team, dex, format }: { team: Team; dex: Dex; format: ReturnType<typeof getFormat> }) {
  return (
    <Panel title="Top threats" bodyClassName="p-3">
      <Suspense fallback={<p className="text-sm text-muted">Checking the most-used sets…</p>}>{team.slots.some(Boolean) ? <TopThreats team={team} dex={dex} format={format} /> : <p className="text-sm text-muted">Empty team.</p>}</Suspense>
    </Panel>
  );
}

/** Each member's Speed as the calculator sees it (neutral field), fastest first, from the Speed tiers ladder code. */
function SpeedPanel({ team, dex, format }: { team: Team; dex: Dex; format: ReturnType<typeof getFormat> }) {
  const rows = useMemo<SpeedRow[]>(() => {
    const members = team.slots.flatMap((set, slot) => (set ? [{ slot, set }] : []));
    return members.length ? buildLadder(dex, [], members, neutralScenario()).filter((r) => r.mine) : [];
  }, [team, dex]);
  return (
    <Panel title="Speed" bodyClassName="p-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Empty team.</p>
      ) : (
        <ol className="space-y-1" aria-label="Speeds, fastest first">
          {rows.map((r) => {
            const sp = dex.species(r.speciesId);
            return (
              <li key={r.key} className="flex items-center gap-2 text-sm">
                <Sprite speciesId={r.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={28} />
                <span className="min-w-0 flex-1 truncate">
                  {r.name}
                  {r.forme === 'mega' && <span className="text-muted"> (Mega)</span>}
                </span>
                <b className="font-mono tabular-nums">{r.speed}</b>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

const FIELD_LABEL: Record<SetChange['field'], string> = { item: 'Item', ability: 'Ability', nature: 'Nature', tera: 'Tera Type', moves: 'Moves', spread: 'Spread', ivs: 'IVs', level: 'Level' };

function DiffPanel({ diff, dexA, dexB, a, b }: { diff: ReturnType<typeof compareTeams>; dexA: Dex; dexB: Dex; a: Team; b: Team }) {
  const label = (t: Team) => `${t.name}${t.variationLabel ? ` · ${t.variationLabel}` : ''}`;
  const fa = getFormat(a.formatId);
  const word = (field: SetChange['field'], id: string, dex: Dex) => {
    if (!id) return '—';
    if (field === 'item') return dex.item(id)?.name ?? id;
    if (field === 'ability') return dex.ability(id)?.name ?? id;
    return id;
  };
  const moveName = (id: string, dex: Dex) => dex.move(id)?.name ?? id;
  const { counts } = diff;

  const row = (d: SetDiff) => {
    const dex = d.a ? dexA : dexB;
    const sp = dex.species(d.speciesId);
    const tone = d.status === 'same' ? 'border-border' : d.status === 'changed' ? 'border-warn/50 bg-warn/8' : 'border-accent/50 bg-accent/8';
    return (
      <li key={`${d.speciesId}-${d.a?.uid ?? d.b?.uid}`} className={cn('rounded-xl border p-2.5', tone)} data-status={d.status}>
        <div className="flex items-center gap-2">
          <Sprite speciesId={d.speciesId} name={sp?.name} types={sp?.types} set={fa.spriteSet} size={32} />
          <b className="min-w-0 flex-1 truncate text-sm">{sp?.name ?? d.speciesId}</b>
          <Chip tone={d.status === 'same' ? 'good' : d.status === 'changed' ? 'warn' : 'accent'}>
            {d.status === 'same' ? 'Same' : d.status === 'changed' ? 'Changed' : d.status === 'only-a' ? 'Only on A' : 'Only on B'}
          </Chip>
        </div>
        {d.changes.length > 0 && (
          <dl className="mt-2 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]">
            {d.changes.map((c) => (
              <div key={c.field} className="contents">
                <dt className="text-xs font-semibold text-muted sm:pt-0.5">{FIELD_LABEL[c.field]}</dt>
                {c.field === 'moves' ? (
                  <>
                    <dd className="min-w-0"><span className="text-xs text-muted sm:hidden">A: </span>{(c.movesOnlyA ?? []).length ? c.movesOnlyA!.map((m) => <span key={m} className="mr-1 inline-block rounded bg-bad/10 px-1.5 text-bad">{moveName(m, dexA)}</span>) : <span className="text-muted">—</span>}</dd>
                    <dd className="min-w-0"><span className="text-xs text-muted sm:hidden">B: </span>{(c.movesOnlyB ?? []).length ? c.movesOnlyB!.map((m) => <span key={m} className="mr-1 inline-block rounded bg-good/10 px-1.5 text-good">{moveName(m, dexB)}</span>) : <span className="text-muted">—</span>}</dd>
                  </>
                ) : (
                  <>
                    <dd className="flex min-w-0 items-center gap-1"><span className="text-xs text-muted sm:hidden">A: </span>{c.field === 'item' && c.a && <ItemSprite itemId={c.a} name={word('item', c.a, dexA)} size={18} />}<span className="truncate">{word(c.field, c.a, dexA)}</span></dd>
                    <dd className="flex min-w-0 items-center gap-1"><span className="text-xs text-muted sm:hidden">B: </span>{c.field === 'item' && c.b && <ItemSprite itemId={c.b} name={word('item', c.b, dexB)} size={18} />}<span className="truncate">{word(c.field, c.b, dexB)}</span></dd>
                  </>
                )}
              </div>
            ))}
          </dl>
        )}
      </li>
    );
  };

  return (
    <Panel
      title="Set by set"
      actions={
        <span role="status" className="text-xs text-muted">
          {diff.identical ? 'Identical sets' : `${counts.changed} changed · ${counts.onlyA} only on A · ${counts.onlyB} only on B · ${counts.same} the same`}
        </span>
      }
      bodyClassName="p-3"
    >
      {diff.sets.length === 0 ? (
        <p className="text-sm text-muted">Both teams are empty.</p>
      ) : (
        <>
        <div className="mb-2 hidden gap-x-3 px-2.5 text-xs font-semibold text-muted sm:grid sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)]" aria-hidden>
          <span />
          <span className="truncate">A · {label(a)}</span>
          <span className="truncate">B · {label(b)}</span>
        </div>
        <ul className="space-y-2" aria-label="Pokémon compared">
          {diff.sets.map(row)}
        </ul>
        </>
      )}
      <p className="mt-2 flex items-center gap-1 text-xs text-muted">
        <Copy size={12} aria-hidden /> Pokémon are paired by species. Moves show what only one side has; spreads show Stat Points (or EVs outside Champions).
      </p>
    </Panel>
  );
}
