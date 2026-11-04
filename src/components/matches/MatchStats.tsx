import { useMemo, useState } from 'react';
import { Gauge, ShieldAlert, Swords } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { regulationInfo } from '@/domain/formats';
import {
  archetypeGrid,
  filterMatches,
  formatRate,
  nemeses,
  opponentStats,
  weeklyTrend,
  winRateByBrought,
  winRateByLead,
  winRateByVariation,
  type GroupRow,
  type MatchFilter,
  type MySpecies,
  type Rate,
  type TeamLookup,
} from '@/domain/matchStats';
import { createSet } from '@/domain/team';
import type { FormatRules } from '@/domain/types';
import { useCalcStore } from '@/store/calcStore';
import { useFocusStore } from '@/store/focusStore';
import { Sprite } from '../ui/Sprite';
import {
  lossesOnly,
  opponentCoreFrequency,
  opponentSpeciesFrequency,
  overallWinRate,
  winRateByArchetype,
  winRateByRegulation,
  winRateByTeam,
  type Match,
  type WinRate,
} from '@/domain/matches';
import { useTeamStore } from '@/store/teamStore';
import { TagUntagged } from './TagUntagged';
import { Button, Field, Input, Panel, Select } from '../ui/primitives';
import { cn } from '../ui/styles';

const pct = (r: WinRate) => `${Math.round(r.rate * 100)}%`;

function WinRateRow({ label, r }: { label: string; r: WinRate }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 truncate">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className={cn('h-full', r.rate >= 0.5 ? 'bg-good' : 'bg-bad')} style={{ width: `${r.rate * 100}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-muted">
        {r.wins}-{r.losses} · {pct(r)}
      </span>
    </div>
  );
}

/** Win rate, personal-meta frequency, and loss review — the report views over the logged matches. */
export function MatchStats({ dex, format, matches: allMatches }: { dex: Dex; format: FormatRules; matches: Match[] }) {
  const teams = useTeamStore((s) => s.teams);
  const [filter, setFilter] = useState<MatchFilter>({});
  const teamOf = useMemo<TeamLookup>(() => (id) => (teams[id] ? { name: teams[id].name, groupId: teams[id].groupId ?? id, variationLabel: teams[id].variationLabel } : undefined), [teams]);
  const mySpecies = useMemo<MySpecies>(
    () => (m, id) => {
      const t = m.myTeamId ? teams[m.myTeamId] : undefined;
      if (t) return t.slots.find((s) => s?.uid === id)?.speciesId;
      return m.myTeam?.some((x) => x.speciesId === id) ? id : undefined;
    },
    [teams],
  );
  const matches = useMemo(() => filterMatches(allMatches, filter, teamOf), [allMatches, filter, teamOf]);
  const overall = useMemo(() => overallWinRate(matches), [matches]);
  const byReg = useMemo(() => winRateByRegulation(matches), [matches]);
  const byTeam = useMemo(() => winRateByTeam(matches), [matches]);
  const byArch = useMemo(() => winRateByArchetype(matches), [matches]);
  const speciesFreq = useMemo(() => [...opponentSpeciesFrequency(matches).entries()].sort((a, b) => b[1] - a[1]).slice(0, 15), [matches]);
  const coreFreq = useMemo(() => [...opponentCoreFrequency(matches).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), [matches]);
  const losses = useMemo(() => lossesOnly(matches), [matches]);

  if (!allMatches.length) return <Panel title="Report">Log a match to see win rate and opponent frequency reports here.</Panel>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <StatsFilters all={allMatches} filter={filter} onChange={setFilter} teams={teams} shown={matches.length} />
      <TagUntagged dex={dex} format={format} matches={matches} />
      {matches.length === 0 && <p className="text-sm text-muted lg:col-span-2">No matches fit these filters.</p>}
      <Panel title={`Overall: ${overall.wins}-${overall.losses} (${pct(overall)})`}>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">By regulation</p>
            <div className="space-y-1">
              {[...byReg.entries()].map(([id, r]) => (
                <WinRateRow key={id} label={id === '—' ? 'No regulation' : (regulationInfo(id)?.shortName ?? id)} r={r} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">By saved team</p>
            <div className="space-y-1">
              {[...byTeam.entries()].map(([id, r]) => (
                <WinRateRow key={id} label={teams[id]?.name ?? 'Deleted team'} r={r} />
              ))}
              {byTeam.size === 0 && <p className="text-xs text-muted">No matches tied to a saved team yet.</p>}
            </div>
          </div>
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">By my archetype</p>
            <div className="space-y-1">
              {[...byArch.entries()].map(([a, r]) => (
                <WinRateRow key={a} label={a} r={r} />
              ))}
              {byArch.size === 0 && <p className="text-xs text-muted">No archetype tags yet.</p>}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Personal meta snapshot">
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">Most-seen opponent species</p>
            <div className="space-y-1">
              {speciesFreq.map(([id, n]) => (
                <div key={id} className="flex items-center justify-between text-xs">
                  <span>{dex.species(id)?.name ?? id}</span>
                  <span className="font-mono text-muted">×{n}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">Most-seen cores (species pairs)</p>
            <div className="space-y-1">
              {coreFreq.map(([key, n]) => {
                const [a, b] = key.split('+');
                return (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span>
                      {dex.species(a)?.name ?? a} + {dex.species(b)?.name ?? b}
                    </span>
                    <span className="font-mono text-muted">×{n}</span>
                  </div>
                );
              })}
              {coreFreq.length === 0 && <p className="text-xs text-muted">Log a few more matches to surface repeat cores.</p>}
            </div>
          </div>
        </div>
      </Panel>

      {matches.length > 0 && <Analytics dex={dex} format={format} matches={matches} teamOf={teamOf} mySpecies={mySpecies} />}

      <Panel title={`Losses (${losses.length})`} className="lg:col-span-2">
        {losses.length === 0 ? (
          <p className="text-xs text-muted">No losses logged — nice.</p>
        ) : (
          <div className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto">
            {losses.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-2 py-1 text-xs">
                <span className="font-mono text-muted">{m.date}</span>
                {m.opponentArchetype && <span className="rounded-full border border-bad/50 bg-bad/15 px-1.5 py-0.5 text-fg">{m.opponentArchetype}</span>}
                <span className="min-w-0 flex-1 truncate">{m.opponentTeam.map((o) => dex.species(o.speciesId)?.name ?? o.speciesId).join(' / ') || '—'}</span>
                {m.eventName && <span className="text-muted">{m.eventName}</span>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function StatsFilters({
  all,
  filter,
  onChange,
  teams,
  shown,
}: {
  all: Match[];
  filter: MatchFilter;
  onChange: (f: MatchFilter) => void;
  teams: ReturnType<typeof useTeamStore.getState>['teams'];
  shown: number;
}) {
  const regs = useMemo(() => [...new Set(all.map((m) => m.regulationId).filter(Boolean))] as string[], [all]);
  const categories = useMemo(() => [...new Set(all.map((m) => m.category).filter(Boolean))] as string[], [all]);
  const usedTeams = useMemo(() => [...new Set(all.map((m) => m.myTeamId).filter(Boolean))].filter((id): id is string => !!id && !!teams[id]), [all, teams]);
  const folders = useMemo(() => [...new Set(usedTeams.map((id) => teams[id].groupId ?? id))].filter((g) => !!teams[g]), [usedTeams, teams]);
  const teamValue = filter.teamId ? `t:${filter.teamId}` : filter.groupId ? `g:${filter.groupId}` : '';
  const active = Object.values(filter).some(Boolean);
  const set = (patch: Partial<MatchFilter>) => onChange({ ...filter, ...patch });
  return (
    <Panel title="Stats filters" className="lg:col-span-2" actions={<span className="text-xs text-muted">{shown} of {all.length} matches</span>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Regulation">
          <Select aria-label="Stats regulation" value={filter.regulationId ?? ''} onChange={(e) => set({ regulationId: e.target.value || undefined })}>
            <option value="">All</option>
            {regs.map((id) => (
              <option key={id} value={id}>
                {regulationInfo(id)?.shortName ?? id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category">
          <Select aria-label="Stats category" value={filter.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined })}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" aria-label="Stats from date" value={filter.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
        </Field>
        <Field label="To">
          <Input type="date" aria-label="Stats to date" value={filter.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
        </Field>
        <Field label="Team / variation">
          <Select
            aria-label="Stats team"
            value={teamValue}
            onChange={(e) => {
              const v = e.target.value;
              set({ teamId: v.startsWith('t:') ? v.slice(2) : undefined, groupId: v.startsWith('g:') ? v.slice(2) : undefined });
            }}
          >
            <option value="">All teams</option>
            {folders.map((g) => (
              <option key={g} value={`g:${g}`}>
                {teams[g].name} (with variations)
              </option>
            ))}
            {usedTeams.map((id) => (
              <option key={id} value={`t:${id}`}>
                {teams[id].name}
                {teams[id].variationLabel ? ` · ${teams[id].variationLabel}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-end">
          <Button size="sm" disabled={!active} onClick={() => onChange({})}>
            Clear filters
          </Button>
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Analytics panels
// ---------------------------------------------------------------------------

/** A record with its uncertainty. Thin samples are greyed and carry no percentage. */
function RateText({ r, className }: { r: Rate; className?: string }) {
  return (
    <span className={cn('font-mono text-xs', r.thin ? 'text-muted' : r.rate >= 0.5 ? 'text-good' : 'text-bad', className)} title={r.thin ? 'Fewer than 5 games: too few to call' : `95% confidence: ${Math.round(r.low * 100)}–${Math.round(r.high * 100)}%`}>
      {formatRate(r)}
    </span>
  );
}

function GroupTable({ title, rows, dex, empty, label }: { title: string; rows: GroupRow[]; dex: Dex; empty: string; label?: (r: GroupRow) => string }) {
  const name = (r: GroupRow) => label?.(r) ?? r.species.map((id) => dex.species(id)?.name ?? id).join(' + ');
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
              <span className="min-w-0 truncate">{name(r)}</span>
              <RateText r={r} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Analytics({ dex, format, matches, teamOf, mySpecies }: { dex: Dex; format: FormatRules; matches: Match[]; teamOf: TeamLookup; mySpecies: MySpecies }) {
  const leads = useMemo(() => winRateByLead(matches, mySpecies), [matches, mySpecies]);
  const brought = useMemo(() => winRateByBrought(matches, mySpecies), [matches, mySpecies]);
  const variations = useMemo(() => winRateByVariation(matches, teamOf), [matches, teamOf]);
  const opp = useMemo(() => opponentStats(matches), [matches]);
  const worst = useMemo(() => nemeses(opp), [opp]);
  const trend = useMemo(() => weeklyTrend(matches), [matches]);
  const grid = useMemo(() => archetypeGrid(matches), [matches]);

  return (
    <>
      <Panel title="Leads, brought and variations">
        <div className="space-y-4">
          <GroupTable title="By my lead" rows={leads} dex={dex} empty="Tap sprites under “I brought” on a match to record your lead." />
          <GroupTable title="By the four I brought" rows={brought} dex={dex} empty="Nothing recorded yet." />
          <GroupTable title="By team variation" rows={variations} dex={dex} empty="No matches tied to a saved team yet." label={(r) => r.label ?? r.key} />
          <p className="text-xs text-muted">Rates show a 95% range; with fewer than 5 games a record is greyed and has no percentage, so one win never reads as 100%.</p>
        </div>
      </Panel>

      <Panel title="Nemesis: who beats me">
        {worst.length === 0 ? (
          <p className="text-xs text-muted">Needs an opponent Pokémon faced at least 5 times before it can be called a nemesis.</p>
        ) : (
          <ol className="space-y-2">
            {worst.map((r) => (
              <li key={r.speciesId}>
                <Nemesis dex={dex} format={format} row={r} matches={matches} />
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <Panel title="Opponent Pokémon" className="lg:col-span-2">
        <div className="scrollbar-thin max-h-80 overflow-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Record against each opponent Pokémon: when it was on their team, when they brought it, and when they led with it.</caption>
            <thead>
              <tr className="text-left text-muted">
                <th scope="col" className="py-1 font-semibold">Pokémon</th>
                <th scope="col" className="py-1 font-semibold">On their team</th>
                <th scope="col" className="py-1 font-semibold">They brought it</th>
                <th scope="col" className="py-1 font-semibold">They led it</th>
              </tr>
            </thead>
            <tbody>
              {opp.slice(0, 30).map((r) => (
                <tr key={r.speciesId} className="border-t border-border">
                  <th scope="row" className="py-1 text-left font-semibold">{dex.species(r.speciesId)?.name ?? r.speciesId}</th>
                  <td className="py-1 pr-2"><RateText r={r.faced} /></td>
                  <td className="py-1 pr-2"><RateText r={r.brought} /></td>
                  <td className="py-1"><RateText r={r.led} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <TrendPanel trend={trend} />

      <Panel title="Archetype vs archetype">
        {grid.mine.length === 0 ? (
          <p className="text-xs text-muted">Tag both “My archetype” and “Opponent archetype” on a match to fill this in.</p>
        ) : (
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full text-xs">
              <caption className="sr-only">Win rate of each of my archetypes against each opposing archetype.</caption>
              <thead>
                <tr>
                  <th scope="col" className="py-1 text-left text-muted">Mine ↓ / theirs →</th>
                  {grid.theirs.map((t) => (
                    <th key={t} scope="col" className="px-1 py-1 text-left font-semibold">{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.mine.map((m) => (
                  <tr key={m} className="border-t border-border">
                    <th scope="row" className="py-1 text-left font-semibold">{m}</th>
                    {grid.theirs.map((t) => {
                      const c = grid.cells.get(`${m}|${t}`);
                      return (
                        <td key={t} className="px-1 py-1">
                          {c ? <RateText r={c.rate} /> : <span className="text-muted">·</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function Nemesis({ dex, format, row, matches }: { dex: Dex; format: FormatRules; row: ReturnType<typeof opponentStats>[number]; matches: Match[] }) {
  const sp = dex.species(row.speciesId);
  const setView = useTeamStore((s) => s.setView);
  const focus = useFocusStore((s) => s.focus);
  const name = sp?.name ?? row.speciesId;

  const toCalc = () => {
    // The defender in the calculator: this species with whatever was last seen of it in the log.
    const set = createSet(dex, row.speciesId, format);
    const seen = matches.flatMap((m) => m.opponentTeam).filter((x) => x.speciesId === row.speciesId).reverse();
    const item = seen.find((x) => x.itemId)?.itemId;
    const ability = seen.find((x) => x.abilityId)?.abilityId;
    const moves = seen.find((x) => x.moves?.length)?.moves;
    if (item) set.itemId = item;
    if (ability) set.abilityId = ability;
    if (moves) set.moves = [moves[0] ?? '', moves[1] ?? '', moves[2] ?? '', moves[3] ?? ''];
    const calc = useCalcStore.getState();
    calc.patchSide('defender', { set, cond: calc.defender.cond, crits: [false, false, false, false] });
    setView('calc');
  };
  const go = (view: 'speed' | 'threats') => {
    focus(row.speciesId);
    useTeamStore.getState().openAnalyse(view);
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Sprite speciesId={row.speciesId} name={name} types={sp?.types} set={format.spriteSet} size={36} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{name}</p>
        <RateText r={row.faced} />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" onClick={toCalc} aria-label={`Open ${name} in the Damage Calc`}>
          <Swords size={13} aria-hidden /> Calc
        </Button>
        {format.datasetId === 'champions' && (
          <>
            <Button size="sm" onClick={() => go('speed')} aria-label={`Find ${name} in Speed tiers`}>
              <Gauge size={13} aria-hidden /> Speed
            </Button>
            <Button size="sm" onClick={() => go('threats')} aria-label={`Find ${name} in the Threat report`}>
              <ShieldAlert size={13} aria-hidden /> Threats
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const SERIES_STYLE = ['var(--color-accent)', 'var(--color-warn)', 'var(--color-good)'];

/** Weekly win rate per regulation: points sized by games played, with the numbers in a table underneath. */
function TrendPanel({ trend }: { trend: ReturnType<typeof weeklyTrend> }) {
  const regs = [...new Set(trend.map((t) => t.regulationId))];
  const weeks = [...new Set(trend.map((t) => t.week))].sort();
  const W = 320;
  const H = 120;
  const x = (week: string) => (weeks.length < 2 ? W / 2 : 24 + (weeks.indexOf(week) / (weeks.length - 1)) * (W - 40));
  const y = (rate: number) => 8 + (1 - rate) * (H - 24);
  return (
    <Panel title="Weekly win rate">
      {trend.length === 0 ? (
        <p className="text-xs text-muted">Nothing to chart yet.</p>
      ) : (
        <div className="space-y-2">
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weekly win rate for ${regs.map((r) => regulationInfo(r)?.shortName ?? r).join(', ')}; the numbers are listed below the chart.`} className="w-full">
            {[0, 0.5, 1].map((g) => (
              <g key={g}>
                <line x1={24} x2={W - 8} y1={y(g)} y2={y(g)} stroke="var(--color-border)" strokeDasharray={g === 0.5 ? '3 3' : undefined} />
                <text x={20} y={y(g) + 3} textAnchor="end" fontSize="8" fill="var(--color-muted)">{Math.round(g * 100)}%</text>
              </g>
            ))}
            {regs.map((reg, i) => {
              const pts = trend.filter((t) => t.regulationId === reg);
              const color = SERIES_STYLE[i % SERIES_STYLE.length];
              return (
                <g key={reg}>
                  <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts.map((p) => `${x(p.week)},${y(p.rate.rate)}`).join(' ')} />
                  {pts.map((p) => (
                    <circle key={p.week} cx={x(p.week)} cy={y(p.rate.rate)} r={2 + Math.min(4, p.rate.total / 3)} fill={p.rate.thin ? 'var(--color-surface)' : color} stroke={color} strokeWidth="1.5" />
                  ))}
                </g>
              );
            })}
          </svg>
          <p className="text-xs text-muted">Hollow points have fewer than 5 games that week. Bigger points are more games.</p>
          <details>
            <summary className="cursor-pointer text-xs font-semibold">Weekly numbers</summary>
            <ul className="mt-1 space-y-0.5 text-xs">
              {trend.map((t) => (
                <li key={`${t.regulationId}${t.week}`} className="flex justify-between gap-2">
                  <span>
                    {regulationInfo(t.regulationId)?.shortName ?? t.regulationId} · week of {t.week}
                  </span>
                  <RateText r={t.rate} />
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Panel>
  );
}
