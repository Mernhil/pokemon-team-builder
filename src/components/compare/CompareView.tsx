import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, GitCompare } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useDex } from '@/data/useDex';
import { metaFor } from '@/data/meta';
import { defaultField } from '@/domain/battle/conditions';
import { compareDefense, compareOffense, speedSummary, type MatrixCompareRow } from '@/domain/compare';
import { defensiveCoverage, offensiveCoverage } from '@/domain/coverage';
import { REGULATION_MANIFEST, getFormat } from '@/domain/formats';
import { buildLadder, metaVariants, neutralScenario, pickSpeedSnapshot } from '@/domain/speedTiers';
import { diffTeams, familyOf, type FieldChange, type SetDiff } from '@/domain/teamDiff';
import type { FormatRules, Team } from '@/domain/types';
import { useMetaStore } from '@/store/metaStore';
import { useTeamStore } from '@/store/teamStore';
import { useThreatReport } from '../threats/useThreatReport';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, LoadingState, Notice, Panel, Select } from '../ui/primitives';
import { TYPE_BADGE } from '../ui/color';
import { cn } from '../ui/styles';

const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

/** "Rain M-C · vs Sun", with whose it is for a shared one. */
const teamLabel = (t: Team) => `${t.name}${t.variationLabel ? ` · ${t.variationLabel}` : ''}${t.shared ? ` (${t.shared.ownerName || t.shared.owner}'s)` : ''}`;

/** Every team that has Pokémon, a folder's root first and its variations after it. */
function listTeams(teams: Record<string, Team>, order: string[]): Team[] {
  const out: Team[] = [];
  for (const id of order) {
    const root = teams[id];
    if (!root) continue;
    out.push(root, ...Object.values(teams).filter((t) => t.groupId === id).sort((a, b) => b.updatedAt - a.updatedAt));
  }
  return out;
}

/**
 * Two teams side by side: the set-by-set differences, both type matrices, Speed against the meta
 * and the threat report's verdict. Teams can be mine, shared with me, or two variations of one team
 * (which is called out, because then every difference is an edit).
 */
export function CompareView() {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const activeId = useTeamStore((s) => s.activeTeamId);
  const all = useMemo(() => listTeams(teams, order), [teams, order]);

  const [aId, setAId] = useState(activeId);
  const a = teams[aId] ?? teams[activeId];
  const pickDefault = (from: Team) => all.find((t) => t.id !== from.id && familyOf(t) === familyOf(from)) ?? all.find((t) => t.id !== from.id && getFormat(t.formatId).datasetId === getFormat(from.formatId).datasetId);
  const [bId, setBId] = useState<string | undefined>(() => pickDefault(teams[activeId])?.id);
  const b = bId ? teams[bId] : undefined;

  // B must be a team of the same game as A: they share one Pokédex.
  const datasetId = getFormat(a.formatId).datasetId;
  const choicesB = all.filter((t) => t.id !== a.id && getFormat(t.formatId).datasetId === datasetId);
  useEffect(() => {
    if (b && b.id !== a.id && getFormat(b.formatId).datasetId === datasetId) return;
    setBId(pickDefault(a)?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, b?.id, datasetId]);

  const dexState = useDex(datasetId);
  const swap = () => {
    if (!b) return;
    setAId(b.id);
    setBId(a.id);
  };

  return (
    <div className="space-y-4">
      <Panel title="Compare two teams" actions={<GitCompare size={16} className="text-muted" aria-hidden />}>
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <label className="space-y-1 text-xs font-semibold text-muted">
            Team A
            <Select aria-label="Team A" value={a.id} onChange={(e) => setAId(e.target.value)}>
              {all.map((t) => (
                <option key={t.id} value={t.id}>
                  {teamLabel(t)}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="ghost" size="icon" aria-label="Swap the two teams" onClick={swap} disabled={!b}>
            <ArrowLeftRight size={16} aria-hidden />
          </Button>
          <label className="space-y-1 text-xs font-semibold text-muted">
            Team B
            <Select aria-label="Team B" value={b?.id ?? ''} onChange={(e) => setBId(e.target.value)} disabled={choicesB.length === 0}>
              {choicesB.length === 0 && <option value="">No other team for this game</option>}
              {choicesB.map((t) => (
                <option key={t.id} value={t.id}>
                  {teamLabel(t)}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Panel>

      {!b ? (
        <EmptyState icon={GitCompare} title="Pick a second team">
          Save another team or a variation of this one, then compare them here.
        </EmptyState>
      ) : dexState.status !== 'ready' ? (
        <LoadingState label="Loading Pokédex data…" />
      ) : (
        <Comparison a={a} b={b} dex={dexState.dex} folderName={teams[familyOf(a)]?.name ?? a.name} />
      )}
    </div>
  );
}

function Comparison({ a, b, dex, folderName }: { a: Team; b: Team; dex: Dex; folderName: string }) {
  const format = getFormat(a.formatId);
  const diff = useMemo(() => diffTeams(a, b), [a, b]);
  const name = (id: string) => dex.species(id)?.name ?? id;
  return (
    <>
      {diff.sameFamily && (
        <Notice tone="accent" title="Two variations of the same team">
          Both are in the folder “{folderName}”, so what differs is what you changed between them.
        </Notice>
      )}
      {diff.differentFormat && (
        <Notice title="Different formats">
          {a.name} is for {format.shortName} and {b.name} for {getFormat(b.formatId).shortName}: legality and usage data differ, but the Pokémon are compared as they are.
        </Notice>
      )}
      <Panel
        title="Set by set"
        actions={
          <span className="flex flex-wrap gap-1.5">
            <Chip>{diff.counts.same} same</Chip>
            <Chip tone={diff.counts.changed ? 'warn' : 'neutral'}>{diff.counts.changed} changed</Chip>
            {diff.counts['only-a'] + diff.counts['only-b'] > 0 && <Chip tone="accent">{diff.counts['only-a'] + diff.counts['only-b']} only on one side</Chip>}
          </span>
        }
      >
        <ul aria-label="Set differences" className="space-y-2">
          {diff.pairs.map((p, i) => (
            <PairRow key={i} pair={p} dex={dex} format={format} nameOf={name} />
          ))}
          {diff.pairs.length === 0 && <li className="text-sm text-muted">Neither team has any Pokémon yet.</li>}
        </ul>
      </Panel>

      <Matrices a={a} b={b} dex={dex} format={format} />
      <SpeedAndThreats a={a} b={b} dex={dex} format={format} />
    </>
  );
}

const FIELD_LABEL: Record<FieldChange['field'], string> = { species: 'Pokémon', item: 'Item', ability: 'Ability', nature: 'Nature', teraType: 'Tera Type', level: 'Level', sp: 'Stat Points', evs: 'EVs', ivs: 'IVs' };

function PairRow({ pair, dex, format, nameOf }: { pair: SetDiff; dex: Dex; format: FormatRules; nameOf: (id: string) => string }) {
  const value = (c: FieldChange, v: string) => (c.field === 'species' ? nameOf(v) : c.field === 'item' ? (dex.item(v)?.name ?? v) : c.field === 'ability' ? (dex.ability(v)?.name ?? v) : v) || '—';
  const mv = (id: string) => dex.move(id)?.name ?? id;
  const side = (set: SetDiff['a'], which: 'A' | 'B') =>
    set ? (
      <div className="flex min-w-0 items-center gap-2">
        <Sprite speciesId={set.speciesId} name={nameOf(set.speciesId)} types={dex.species(set.speciesId)?.types} set={format.spriteSet} size={32} />
        <span className="min-w-0 truncate text-sm font-semibold">{nameOf(set.speciesId)}</span>
        <span className="sr-only">on team {which}</span>
      </div>
    ) : (
      <span className="text-sm text-muted">Not on team {which}</span>
    );
  return (
    <li
      className={cn(
        'rounded-xl border p-2.5',
        pair.status === 'same' && 'border-border',
        pair.status === 'changed' && 'border-warn/50 bg-warn/5',
        (pair.status === 'only-a' || pair.status === 'only-b') && 'border-accent/50 bg-accent/5',
      )}
    >
      <div className="grid grid-cols-2 items-center gap-2">
        {side(pair.a, 'A')}
        {side(pair.b, 'B')}
      </div>
      {pair.status === 'same' && <p className="mt-1.5 text-xs text-muted">Identical sets.</p>}
      {pair.status === 'changed' && (
        <dl className="mt-2 space-y-1 text-sm">
          {pair.changes.map((c) => (
            <div key={c.field} className="grid grid-cols-[5.5rem_1fr_1fr] items-baseline gap-2">
              <dt className="text-xs font-semibold text-muted">{FIELD_LABEL[c.field]}</dt>
              <dd className="min-w-0 break-words font-semibold">{value(c, c.a)}</dd>
              <dd className="min-w-0 break-words font-semibold">{value(c, c.b)}</dd>
            </div>
          ))}
          {(pair.moves.onlyA.length > 0 || pair.moves.onlyB.length > 0) && (
            <div className="grid grid-cols-[5.5rem_1fr_1fr] items-baseline gap-2">
              <dt className="text-xs font-semibold text-muted">Moves</dt>
              <dd className="min-w-0 break-words">
                {pair.moves.onlyA.length ? (
                  <>
                    <span className="text-xs text-muted">only A: </span>
                    <b>{pair.moves.onlyA.map(mv).join(', ')}</b>
                  </>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
              <dd className="min-w-0 break-words">
                {pair.moves.onlyB.length ? (
                  <>
                    <span className="text-xs text-muted">only B: </span>
                    <b>{pair.moves.onlyB.map(mv).join(', ')}</b>
                  </>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}
      {(pair.status === 'only-a' || pair.status === 'only-b') && (
        <p className="mt-1.5 text-xs text-muted">
          {(pair.a ?? pair.b)?.moves
            .filter(Boolean)
            .map(mv)
            .join(', ')}
        </p>
      )}
    </li>
  );
}

function MatrixTable({ caption, rows, goodLabel, badLabel }: { caption: string; rows: MatrixCompareRow[]; goodLabel: string; badLabel: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-center text-xs">
        <caption className="mb-1 text-left text-sm font-semibold">{caption}</caption>
        <thead>
          <tr className="text-muted">
            <th scope="col" className="text-left font-semibold">
              Type
            </th>
            <th scope="col" colSpan={2} className="font-semibold">
              A ({goodLabel} / {badLabel})
            </th>
            <th scope="col" colSpan={2} className="font-semibold">
              B ({goodLabel} / {badLabel})
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type} className={cn(r.differs && 'bg-warn/10 font-semibold')}>
              <th scope="row" className="py-0.5 text-left">
                <span className="inline-block min-w-12 rounded px-1 text-center text-[10px] font-bold uppercase" style={{ background: TYPE_BADGE[r.type].fill, color: TYPE_BADGE[r.type].text }}>
                  {r.type.slice(0, 4)}
                </span>
                {r.differs && <span className="sr-only"> (differs)</span>}
              </th>
              <td className={cn('font-mono', r.a.good ? 'text-good' : 'text-muted')}>{r.a.good}</td>
              <td className={cn('font-mono', r.a.bad ? 'text-bad' : 'text-muted')}>{r.a.bad}</td>
              <td className={cn('font-mono', r.b.good ? 'text-good' : 'text-muted')}>{r.b.good}</td>
              <td className={cn('font-mono', r.b.bad ? 'text-bad' : 'text-muted')}>{r.b.bad}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Matrices({ a, b, dex, format }: { a: Team; b: Team; dex: Dex; format: FormatRules }) {
  const def = useMemo(() => compareDefense(defensiveCoverage(a, dex, format.capabilities.mega), defensiveCoverage(b, dex, getFormat(b.formatId).capabilities.mega)), [a, b, dex, format]);
  const off = useMemo(() => compareOffense(offensiveCoverage(a, dex), offensiveCoverage(b, dex)), [a, b, dex]);
  return (
    <Panel title="Type matrices" actions={<span className="text-xs text-muted">Highlighted rows differ</span>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <MatrixTable caption="Defensive: resist / weak" rows={def} goodLabel="resist" badLabel="weak" />
        <MatrixTable caption="Offensive: super effective / walled" rows={off} goodLabel="hit" badLabel="walled" />
      </div>
    </Panel>
  );
}

function SpeedColumn({ team, dex, format, label }: { team: Team; dex: Dex; format: FormatRules; label: string }) {
  const refreshed = useMetaStore((s) => s.refreshed);
  const picked = useMemo(() => (format.datasetId === 'champions' ? pickSpeedSnapshot(format.regulationId, champRegIds, (id) => metaFor(id, refreshed)) : undefined), [format, refreshed]);
  const lines = useMemo(() => {
    if (!picked) return [];
    const members = team.slots.flatMap((set, slot) => (set ? [{ slot, set }] : []));
    return speedSummary(buildLadder(dex, metaVariants(picked.snapshot, dex, format, 30), members, neutralScenario()));
  }, [picked, team, dex, format]);
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{label}</h3>
      {!picked ? (
        <p className="text-sm text-muted">No usage data for this game.</p>
      ) : (
        <ol className="space-y-0.5 text-sm">
          {lines.map((l) => (
            <li key={l.slot} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-semibold">
                {l.name}
                {l.mega ? ' (Mega)' : ''}
              </span>
              <span className="shrink-0 text-xs text-muted">
                <b className="text-fg">{l.speed}</b> · beats {l.outspeeds} of {l.total}
              </span>
            </li>
          ))}
          {lines.length === 0 && <li className="text-muted">No Pokémon yet.</li>}
        </ol>
      )}
    </div>
  );
}

function ThreatColumn({ team, dex, format, label }: { team: Team; dex: Dex; format: FormatRules; label: string }) {
  const field = useMemo(() => defaultField(), []);
  const { summaries, done, picked } = useThreatReport({ dex, format, team, count: 20, field, delay: 300 });
  const bad = summaries.filter((s) => s.tone === 'bad');
  const warn = summaries.filter((s) => s.tone === 'warn');
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{label}</h3>
      {!picked ? (
        <p className="text-sm text-muted">No usage data for this game.</p>
      ) : !done ? (
        <p className="text-sm text-muted">Checking the 20 most-used sets…</p>
      ) : (
        <>
          <p className="mb-1 flex flex-wrap gap-1.5">
            <Chip tone={bad.length ? 'bad' : 'good'}>{bad.length} big {bad.length === 1 ? 'problem' : 'problems'}</Chip>
            <Chip tone={warn.length ? 'warn' : 'good'}>{warn.length} to watch</Chip>
          </p>
          <ul className="space-y-0.5 text-sm">
            {[...bad, ...warn].slice(0, 4).map((s) => (
              <li key={s.speciesId} className="flex items-baseline gap-1.5">
                <b className="shrink-0">{dex.species(s.speciesId)?.name ?? s.speciesId}</b>
                <span className="min-w-0 truncate text-xs text-muted" title={s.lines.join(' ')}>
                  {s.lines[0]}
                </span>
              </li>
            ))}
            {bad.length + warn.length === 0 && <li className="text-muted">No clear problems.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

function SpeedAndThreats({ a, b, dex, format }: { a: Team; b: Team; dex: Dex; format: FormatRules }) {
  const formatB = getFormat(b.formatId);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Speed against the meta" actions={<a href="#speed" className="text-xs font-semibold text-accent underline-offset-2 hover:underline">Speed tiers</a>}>
        <div className="grid grid-cols-2 gap-4">
          <SpeedColumn team={a} dex={dex} format={format} label="Team A" />
          <SpeedColumn team={b} dex={dex} format={formatB} label="Team B" />
        </div>
      </Panel>
      <Panel title="Threat report" actions={<a href="#threats" className="text-xs font-semibold text-accent underline-offset-2 hover:underline">Full report</a>}>
        <div className="grid grid-cols-2 gap-4">
          <ThreatColumn team={a} dex={dex} format={format} label="Team A" />
          <ThreatColumn team={b} dex={dex} format={formatB} label="Team B" />
        </div>
      </Panel>
    </div>
  );
}
