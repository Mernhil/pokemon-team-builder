import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { META_STALE_DAYS, isProvisional, provisionalNote, usageLabel, usageText } from '@/domain/meta';
import { TERRAINS, WEATHERS, defaultSide } from '@/domain/battle/conditions';
import type { MetaSet } from '@/domain/metaSets';
import { snapshotAge } from '@/domain/speedTiers';
import { useViewStore } from '@/store/viewStore';
import { VERDICT_CELL } from './verdictStyle';
import { THREAT_COUNTS, bucket, sharedField, KILL_LABEL, KILL_SHORT, type ThreatCell, type ThreatField } from '@/domain/threats';
import type { FormatRules, PokemonSet, Team } from '@/domain/types';
import { useCalcStore } from '@/store/calcStore';
import { useFocusStore } from '@/store/focusStore';
import { useOptimizerStore } from '@/store/optimizerStore';
import { useTeamStore } from '@/store/teamStore';
import { toast } from '@/store/toastStore';
import { ChipRow, Toggle } from '../ui/chips';
import { Sprite } from '../ui/Sprite';
import { Chip, EmptyState, Help, LoadingState, Notice, Panel, Select } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useThreatReport } from './useThreatReport';
import { RisingThreats } from './RisingThreats';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions');
const fmtMonth = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

const speedText = (c: ThreatCell) => (c.first === 'me' ? '▲ you move first' : c.first === 'them' ? '▼ it moves first' : '＝ speed tie');
const BUCKET_TEXT = { good: '✓ good for you', even: '~ even', bad: '✗ bad for you' } as const;

/** Full sentence for a cell (screen readers, tooltips). */
function cellSentence(dex: Dex, member: PokemonSet, threat: MetaSet, c: ThreatCell): string {
  const me = dex.species(member.speciesId)?.name ?? member.speciesId;
  const it = dex.species(threat.speciesId)?.name ?? threat.speciesId;
  const mine = c.mine ? `${me} ${KILL_LABEL[c.mine.kill]} (${c.mine.percent[0]}–${c.mine.percent[1]}%) with ${c.mine.move}` : `${me} has no damaging move that works`;
  const theirs = c.theirs ? `${it} ${KILL_LABEL[c.theirs.kill]} (${c.theirs.percent[0]}–${c.theirs.percent[1]}%) with ${c.theirs.move}` : `${it} has no damaging move that works`;
  return `${mine}; ${theirs}; ${speedText(c).slice(2)}; ${BUCKET_TEXT[bucket(c.verdict)].slice(2)}.`;
}

/**
 * Threat report: your whole team against the most-used Champions sets, in both directions.
 * Colour is a blue-to-orange scale (safe for colour-blind players) and every cell says the same
 * thing in words and symbols.
 */
export function ThreatReportView({ dex, format, team }: { dex: Dex; format: FormatRules; team: Team }) {
  const setView = useTeamStore((s) => s.setView);
  const count = useViewStore((s) => s.threatCount);
  const field = useViewStore((s) => s.threatField);
  // The table is one tab stop: arrow keys move between its cells, and the cell last used keeps the stop.
  const [activeCell, setActiveCell] = useState('0:0');
  const report = useThreatReport({ dex, format, team, count, field });
  const { picked, loading, threats, members, rows, done, summaries, error } = report;
  // The cell that holds the table's Tab stop; the first one if the last-used cell is gone (fewer threats or members now).
  const [activeRow, activeCol] = activeCell.split(':').map(Number);
  const activeKey = activeRow < threats.length && activeCol < members.length ? activeCell : '0:0';

  const backToReport = { label: 'Back to the Threat report', run: () => useTeamStore.getState().openAnalyse('threats') };
  const openCalc = (member: PokemonSet, slot: number, threat: MetaSet) => {
    const calc = useCalcStore.getState();
    const hasMega = !!dex.megaFor(member.speciesId, member.itemId);
    calc.setSide('attacker', { set: member, cond: { ...defaultSide(hasMega), tailwind: !!field.myTailwind }, crits: [false, false, false, false], origin: { teamName: team.name, slot: slot + 1 } });
    calc.setSide('defender', { set: threat.set, cond: { ...defaultSide(threat.megaMode !== 'base'), megaMode: threat.megaMode, tailwind: !!field.theirTailwind }, crits: [false, false, false, false] });
    calc.setField(sharedField(field));
    setView('calc');
    toast('Opened in the Damage Calc.', backToReport);
  };

  const openOptimizer = (slot: number, threat: MetaSet, cell: ThreatCell) => {
    if (!cell.theirs) return;
    useOptimizerStore.getState().open({
      slotKey: `${team.id}:${slot}`,
      goals: [{ kind: 'survive', attacker: threat.set, attackerCond: { ...defaultSide(threat.megaMode !== 'base'), megaMode: threat.megaMode, tailwind: !!field.theirTailwind }, moveId: cell.theirs.moveId, rolls: 16 }],
      field: sharedField(field),
    });
    useTeamStore.getState().setActiveSlot(slot);
    setView('builder');
    toast('Opened in the optimiser.', backToReport);
  };

  // Keep "survive this move" on the Pokémon as a benchmark, checked again when the meta changes.
  const keepBenchmark = async (slot: number, threat: MetaSet, cell: ThreatCell) => {
    const member = team.slots[slot];
    if (!cell.theirs || !member) return;
    const [{ benchmarkFromGoal, evaluateBenchmarks }, { mergeBenchmarks }] = await Promise.all([import('@/domain/benchmarkEval'), import('@/domain/benchmarks')]);
    const goal = { kind: 'survive' as const, attacker: threat.set, attackerCond: { ...defaultSide(threat.megaMode !== 'base'), megaMode: threat.megaMode, tailwind: !!field.theirTailwind }, moveId: cell.theirs.moveId, rolls: 16, foe: { speciesId: threat.speciesId, source: 'meta' as const } };
    const draft = benchmarkFromGoal(dex, format, goal, { snapshot: picked?.snapshot, field: sharedField(field), met: false });
    if (!draft) return;
    const [now] = evaluateBenchmarks(dex, format, member, [draft], picked?.snapshot);
    const b = { ...draft, metAtSave: now?.status === 'met' };
    useTeamStore.getState().updateSet(team.id, slot, { benchmarks: mergeBenchmarks(member.benchmarks, [b]) });
    toast(`Kept “survive ${dex.species(threat.speciesId)?.name}'s ${cell.theirs.move}” as a benchmark of ${dex.species(member.speciesId)?.name}.`);
  };

  // A hand-off from the match log: widen the list if needed, scroll to that species and mark its row.
  const focusId = useFocusStore((s) => s.speciesId);
  const clearFocus = useFocusStore((s) => s.clear);
  useEffect(() => () => clearFocus(), [clearFocus]);
  useEffect(() => {
    if (!focusId || threats.length === 0) return;
    if (!threats.some((t) => t.speciesId === focusId)) {
      // oxlint-disable-next-line react/set-state-in-effect -- reacts to a one-shot hand-off or a changed input, which is what this effect is for
      if (count < 30) setCount(30);
      return;
    }
    requestAnimationFrame(() => {
      const els = [...document.querySelectorAll<HTMLElement>(`[data-threat="${focusId}"]`)].filter((e) => e.offsetParent !== null);
      els[0]?.scrollIntoView({ block: 'center' });
    });
  }, [focusId, threats, count]);

  const calculated = rows.filter(Boolean).length;
  const age = useMemo(() => (picked ? snapshotAge(picked.snapshot) : undefined), [picked]);

  if (format.datasetId !== 'champions') {
    return (
      <EmptyState icon={ShieldAlert} title="The Threat report needs meta usage data, which only exists for Champions">
        Switch the team’s format to a Champions regulation to see how your team fares against the Pokémon people actually use.
      </EmptyState>
    );
  }
  if (loading) return <LoadingState label="Loading usage data…" />;
  if (!picked) {
    return (
      <EmptyState icon={ShieldAlert} title="No usage data to build a threat report from yet">
        Early numbers from tournaments and Showdown replays appear within days of a regulation starting, and Smogon’s usage statistics after its
        first month; the app picks them up with its next update.
      </EmptyState>
    );
  }

  const reg = champRegs.find((r) => r.id === picked.regulationId);
  const wantedReg = champRegs.find((r) => r.id === picked.fellBackFrom);
  const s = picked.snapshot.source;
  const set = <K extends keyof ThreatField>(k: K, v: ThreatField[K]) => setField((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <Panel bodyClassName="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 text-sm text-muted">
            <b className="text-fg">{reg?.name ?? picked.regulationId}</b>
            {s.month && ` · ${fmtMonth(s.month)} usage`}
            {s.season && ` · in-game ranked season ${s.season}`}
            {s.battles !== undefined ? ` · ${s.battles.toLocaleString()} battles` : ''}
            {isProvisional(picked.snapshot) && ` · ${provisionalNote(picked.snapshot, (id) => champRegs.find((r) => r.id === id)?.shortName)}`}
            {age ? ` · ${age.days} days old` : ''}
          </p>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            Top
            <Select aria-label="Threats shown" className="w-auto" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {THREAT_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} threats
                </option>
              ))}
            </Select>
          </label>
        </div>
        <ChipRow label="Battle">
          <Toggle pressed={field.gameType === 'Doubles'} onClick={() => set('gameType', 'Doubles')}>
            Doubles
          </Toggle>
          <Toggle pressed={field.gameType === 'Singles'} onClick={() => set('gameType', 'Singles')}>
            Singles
          </Toggle>
          <Toggle pressed={field.trickRoom} onClick={() => set('trickRoom', !field.trickRoom)}>
            Trick Room
          </Toggle>
          <Toggle pressed={!!field.myTailwind} onClick={() => set('myTailwind', !field.myTailwind)}>
            Your Tailwind
          </Toggle>
          <Toggle pressed={!!field.theirTailwind} onClick={() => set('theirTailwind', !field.theirTailwind)}>
            Their Tailwind
          </Toggle>
        </ChipRow>
        <ChipRow label="Weather">
          {WEATHERS.map((w) => (
            <Toggle key={w.id || 'none'} pressed={field.weather === w.id} onClick={() => set('weather', w.id)}>
              {w.label}
            </Toggle>
          ))}
        </ChipRow>
        <ChipRow label="Terrain">
          {TERRAINS.map((t) => (
            <Toggle key={t.id || 'none'} pressed={field.terrain === t.id} onClick={() => set('terrain', t.id)}>
              {t.label}
            </Toggle>
          ))}
        </ChipRow>
      </Panel>

      {picked.fellBackFrom && (
        <Notice icon={AlertTriangle} title={`No usage data for ${wantedReg?.shortName ?? 'this regulation'} yet`}>
          Showing {reg?.shortName ?? picked.regulationId}’s numbers, the newest published.
        </Notice>
      )}
      {age && !isProvisional(picked.snapshot) && age.days > META_STALE_DAYS && (
        <Notice icon={AlertTriangle} title={`These numbers are ${age.days} days old`}>
          They describe play up to {age.dataDate}. Newer usage statistics haven’t been published or built into the app yet.
        </Notice>
      )}
      {error && <Notice tone="bad" title="Couldn’t calculate the report">{error}</Notice>}

      {members.length === 0 ? (
        <EmptyState icon={ShieldAlert} title="Add Pokémon to your team first">
          Each of your Pokémon is calculated against each common set: damage both ways and who moves first.
        </EmptyState>
      ) : (
        <>
          <p role="status" className="text-xs text-muted">
            {done ? `${calculated} threats calculated against ${members.length} of your Pokémon.` : `Calculating… ${calculated} of ${threats.length}`}
          </p>

          <RisingThreats dex={dex} format={format} regulationId={picked?.regulationId} threatIds={threats.map((t) => t.speciesId)} rows={rows} />

          {summaries.length > 0 && (
            <Panel title="Biggest threats">
              <ol className="space-y-2">
                {summaries.slice(0, 5).map((sm) => {
                  const sp = dex.species(sm.speciesId);
                  return (
                    <li key={sm.speciesId} className="flex items-start gap-3">
                      <Sprite speciesId={sm.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={36} />
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="flex flex-wrap items-center gap-x-2">
                          <b>{sp?.name ?? sm.speciesId}</b>
                          <Chip tone={sm.tone === 'bad' ? 'bad' : sm.tone === 'warn' ? 'warn' : 'good'}>{sm.tone === 'bad' ? 'Big problem' : sm.tone === 'warn' ? 'Watch out' : 'Manageable'}</Chip>
                          <span className="text-xs text-muted">{usageText(sm)}</span>
                        </p>
                        {sm.lines.map((l) => (
                          <p key={l} className="text-muted">
                            {l}
                          </p>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </Panel>
          )}

          {/* Wide screens: threats down, my six across. */}
          <div className="scrollbar-thin hidden overflow-x-auto rounded-xl border border-border bg-surface sm:block">
            <table className="w-full min-w-max border-collapse text-xs">
              <caption className="sr-only">Threats against your team: each cell shows your best move and its best move, and who moves first.</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-surface p-2 text-left text-2xs font-bold tracking-wide text-muted uppercase">
                    Threat
                  </th>
                  {members.map((m) => (
                    <th key={m.slot} scope="col" className="p-2 text-center font-semibold">
                      <span className="flex flex-col items-center gap-0.5">
                        <Sprite speciesId={m.set.speciesId} name={dex.species(m.set.speciesId)?.name} types={dex.species(m.set.speciesId)?.types} set={format.spriteSet} size={32} />
                        {dex.species(m.set.speciesId)?.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody onFocus={(e) => { const id = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell ?? (e.target as HTMLElement).closest('td')?.querySelector<HTMLElement>('[data-cell]')?.dataset.cell; if (id) setActiveCell(id); }} onKeyDown={moveBetweenCells}>
                {threats.map((t, i) => {
                  const sp = dex.species(t.speciesId);
                  return (
                    <tr key={t.speciesId} data-threat={t.speciesId} className={cn('border-t border-border', focusId === t.speciesId && 'outline-2 -outline-offset-2 outline-accent')}>
                      <th scope="row" className="sticky left-0 z-10 bg-surface p-2 text-left font-normal">
                        <span className="flex items-center gap-2">
                          <Sprite speciesId={t.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={32} />
                          <span>
                            <b className="block text-sm">{sp?.name ?? t.speciesId}</b>
                            <span className="text-muted">{usageLabel(t)}</span>
                          </span>
                        </span>
                      </th>
                      {members.map((m, j) => (
                        <td key={m.slot} className="p-1 align-top">
                          <Cell cell={rows[i]?.[j]} sentence={rows[i]?.[j] ? cellSentence(dex, m.set, t, rows[i]![j]) : ''} survive={rows[i]?.[j]?.theirs ? `Optimise ${dex.species(m.set.speciesId)?.name} to survive ${dex.species(t.speciesId)?.name}'s ${rows[i]![j].theirs!.move}` : ''} onOpen={() => openCalc(m.set, m.slot, t)} onSurvive={() => openOptimizer(m.slot, t, rows[i]![j])} keep={`Keep surviving ${dex.species(t.speciesId)?.name}'s ${rows[i]?.[j]?.theirs?.move ?? 'move'} as a benchmark of ${dex.species(m.set.speciesId)?.name}`} onKeep={() => void keepBenchmark(m.slot, t, rows[i]![j])}  gridId={`${i}:${j}`} tabStop={activeKey === `${i}:${j}` ? 0 : -1} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phones: one card per threat. */}
          <ul className="space-y-2 sm:hidden" aria-label="Threats">
            {threats.map((t, i) => {
              const sp = dex.species(t.speciesId);
              const line = summaries.find((x) => x.speciesId === t.speciesId)?.lines[0];
              return (
                <li key={t.speciesId} data-threat={t.speciesId} aria-current={focusId === t.speciesId ? 'true' : undefined} className={cn('rounded-xl border bg-surface p-3', focusId === t.speciesId ? 'border-accent' : 'border-border')}>
                  <div className="mb-2 flex items-center gap-3">
                    <Sprite speciesId={t.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={40} />
                    <div className="min-w-0">
                      <b className="block text-sm">{sp?.name ?? t.speciesId}</b>
                      <span className="text-xs text-muted">{usageText(t)}</span>
                    </div>
                  </div>
                  {line && <p className="mb-2 text-xs text-muted">{line}</p>}
                  <div className="space-y-1.5">
                    {members.map((m, j) => (
                      <div key={m.slot} className="flex items-center gap-2">
                        <Sprite speciesId={m.set.speciesId} name={dex.species(m.set.speciesId)?.name} types={dex.species(m.set.speciesId)?.types} set={format.spriteSet} size={28} />
                        <div className="min-w-0 flex-1">
                          <Cell cell={rows[i]?.[j]} sentence={rows[i]?.[j] ? cellSentence(dex, m.set, t, rows[i]![j]) : ''} survive={rows[i]?.[j]?.theirs ? `Optimise ${dex.species(m.set.speciesId)?.name} to survive ${dex.species(t.speciesId)?.name}'s ${rows[i]![j].theirs!.move}` : ''} onOpen={() => openCalc(m.set, m.slot, t)} onSurvive={() => openOptimizer(m.slot, t, rows[i]![j])} keep={`Keep surviving ${dex.species(t.speciesId)?.name}'s ${rows[i]?.[j]?.theirs?.move ?? 'move'} as a benchmark of ${dex.species(m.set.speciesId)?.name}`} onKeep={() => void keepBenchmark(m.slot, t, rows[i]![j])} />
                        </div>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <Help label="How to read this table">
            Blue and ✓: good for you · orange and ✗: bad for you · ~ even. “You” is your best move, “It” the threat’s. Damage is % of the defender’s HP; Mega
            Stone holders are read at their best forme, for you and for the threat. Tap a cell to open it in the Damage Calc. On a keyboard the table is one Tab stop: arrow keys, Home and End move between cells.
          </Help>
        </>
      )}
    </div>
  );
}

const setCount = (n: number) => useViewStore.getState().set('threatCount', n);
const setField = (f: (cur: ThreatField) => ThreatField) => useViewStore.getState().set('threatField', f(useViewStore.getState().threatField));

/** Arrow keys, Home and End move between the report's cells (the cell buttons carry `data-cell="row:column"`). */
function moveBetweenCells(e: KeyboardEvent<HTMLElement>) {
  const here = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')?.dataset.cell;
  if (!here || e.altKey || e.ctrlKey || e.metaKey) return;
  const [row, col] = here.split(':').map(Number);
  const body = e.currentTarget;
  const rowCount = body.querySelectorAll('tr').length;
  const colCount = body.querySelectorAll('tr:first-child [data-cell]').length;
  const [r, c] =
    e.key === 'ArrowRight' ? [row, col + 1] : e.key === 'ArrowLeft' ? [row, col - 1] : e.key === 'ArrowDown' ? [row + 1, col] : e.key === 'ArrowUp' ? [row - 1, col] : e.key === 'Home' ? [row, 0] : e.key === 'End' ? [row, colCount - 1] : [-1, -1];
  if (r < 0 || c < 0 || r >= rowCount || c >= colCount) return;
  e.preventDefault();
  body.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`)?.focus();
}

function Cell({ cell, sentence, survive, onOpen, onSurvive, keep, onKeep, gridId, tabStop = 0 }: { cell: ThreatCell | undefined; sentence: string; survive: string; onOpen: () => void; onSurvive: () => void; keep: string; onKeep: () => void; /** Table cells only: `row:column`, for arrow-key movement. */ gridId?: string; /** 0 = in the tab order, -1 = reached by arrow keys only (the table keeps one stop). */ tabStop?: 0 | -1 }) {
  if (!cell) return <div className="min-h-16 rounded-lg border border-dashed border-border p-2 text-center text-muted">…</div>;
  const b = bucket(cell.verdict);
  const range = (m: NonNullable<ThreatCell['mine']>) => (m.percent[0] === m.percent[1] ? `${m.percent[0]}%` : `${m.percent[0]}–${m.percent[1]}%`);
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        data-cell={gridId}
        tabIndex={tabStop}
        onClick={onOpen}
        aria-label={sentence}
        title={sentence}
        className={cn(
          'block min-h-16 w-full min-w-28 rounded-lg border p-1.5 text-left leading-tight hover:brightness-95 pointer-coarse:min-h-14',
          VERDICT_CELL[b],
        )}
      >
        <span className="block font-semibold">
          {b === 'good' ? '✓' : b === 'bad' ? '✗' : '~'} You: {cell.mine ? `${KILL_SHORT[cell.mine.kill]} ${range(cell.mine)}` : '—'}
        </span>
        <span className="block">It: {cell.theirs ? `${KILL_SHORT[cell.theirs.kill]} ${range(cell.theirs)}` : '—'}</span>
        <span className="block text-muted">{speedText(cell)}</span>
      </button>
      {cell.theirs && (
        <button type="button" tabIndex={tabStop} onClick={onSurvive} aria-label={survive} title={survive} className="block w-full rounded px-1 py-0.5 text-left text-2xs font-semibold text-accent underline-offset-2 hover:underline pointer-coarse:min-h-11">
          Survive this…
        </button>
      )}
      {cell.theirs && (
        <button type="button" tabIndex={tabStop} onClick={onKeep} aria-label={keep} title={keep} className="block w-full rounded px-1 py-0.5 text-left text-2xs font-semibold text-accent underline-offset-2 hover:underline pointer-coarse:min-h-11">
          Keep as benchmark
        </button>
      )}
    </div>
  );
}
