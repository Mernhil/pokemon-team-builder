import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { META_STALE_DAYS } from '@/domain/meta';
import { TERRAINS, WEATHERS, defaultSide, type FieldConditions } from '@/domain/battle/conditions';
import type { MetaSet } from '@/domain/metaSets';
import { snapshotAge } from '@/domain/speedTiers';
import { THREAT_COUNTS, bucket, KILL_LABEL, KILL_SHORT, type ThreatCell } from '@/domain/threats';
import type { FormatRules, PokemonSet, Team } from '@/domain/types';
import { useCalcStore } from '@/store/calcStore';
import { useFocusStore } from '@/store/focusStore';
import { useOptimizerStore } from '@/store/optimizerStore';
import { useTeamStore } from '@/store/teamStore';
import { ChipRow, Toggle } from '../ui/chips';
import { Sprite } from '../ui/Sprite';
import { Chip, EmptyState, Notice, Panel, Select } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useThreatReport } from './useThreatReport';

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
  const [count, setCount] = useState<number>(20);
  const [field, setField] = useState<FieldConditions>({ gameType: 'Doubles', weather: '', terrain: '', trickRoom: false, gravity: false });
  const report = useThreatReport({ dex, format, team, count, field });
  const { picked, threats, members, rows, done, summaries, error } = report;

  const openCalc = (member: PokemonSet, slot: number, threat: MetaSet) => {
    const calc = useCalcStore.getState();
    const hasMega = !!dex.megaFor(member.speciesId, member.itemId);
    calc.setSide('attacker', { set: member, cond: defaultSide(hasMega), crits: [false, false, false, false], origin: { teamName: team.name, slot: slot + 1 } });
    calc.setSide('defender', { set: threat.set, cond: { ...defaultSide(threat.megaMode !== 'base'), megaMode: threat.megaMode }, crits: [false, false, false, false] });
    calc.setField(field);
    setView('calc');
  };

  const openOptimizer = (slot: number, threat: MetaSet, cell: ThreatCell) => {
    if (!cell.theirs) return;
    useOptimizerStore.getState().open({
      slotKey: `${team.id}:${slot}`,
      goals: [{ kind: 'survive', attacker: threat.set, attackerCond: { ...defaultSide(threat.megaMode !== 'base'), megaMode: threat.megaMode }, moveId: cell.theirs.moveId, rolls: 16 }],
      field,
    });
    useTeamStore.getState().setActiveSlot(slot);
    setView('builder');
  };

  // A hand-off from the match log: widen the list if needed, scroll to that species and mark its row.
  const focusId = useFocusStore((s) => s.speciesId);
  const clearFocus = useFocusStore((s) => s.clear);
  useEffect(() => () => clearFocus(), [clearFocus]);
  useEffect(() => {
    if (!focusId || threats.length === 0) return;
    if (!threats.some((t) => t.speciesId === focusId)) {
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
  if (!picked) {
    return (
      <EmptyState icon={ShieldAlert} title="No usage data to build a threat report from yet">
        Smogon publishes each month’s usage statistics after the month ends; the app picks them up with its next update.
      </EmptyState>
    );
  }

  const reg = champRegs.find((r) => r.id === picked.regulationId);
  const wantedReg = champRegs.find((r) => r.id === picked.fellBackFrom);
  const s = picked.snapshot.source;
  const set = <K extends keyof FieldConditions>(k: K, v: FieldConditions[K]) => setField((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <Panel bodyClassName="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="min-w-0 text-sm text-muted">
            <b className="text-fg">{reg?.name ?? picked.regulationId}</b>
            {s.month && ` · ${fmtMonth(s.month)} usage`}
            {s.battles !== undefined ? ` · ${s.battles.toLocaleString()} battles` : ''}
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
      {age && age.days > META_STALE_DAYS && (
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
                          <span className="text-xs text-muted">{sm.usagePct.toFixed(1)}% usage</span>
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
                  <th scope="col" className="sticky left-0 z-10 bg-surface p-2 text-left text-[11px] font-bold tracking-wide text-muted uppercase">
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
              <tbody>
                {threats.map((t, i) => {
                  const sp = dex.species(t.speciesId);
                  return (
                    <tr key={t.speciesId} data-threat={t.speciesId} className={cn('border-t border-border', focusId === t.speciesId && 'outline-2 -outline-offset-2 outline-accent')}>
                      <th scope="row" className="sticky left-0 z-10 bg-surface p-2 text-left font-normal">
                        <span className="flex items-center gap-2">
                          <Sprite speciesId={t.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={32} />
                          <span>
                            <b className="block text-sm">{sp?.name ?? t.speciesId}</b>
                            <span className="text-muted">{t.usagePct.toFixed(1)}%</span>
                          </span>
                        </span>
                      </th>
                      {members.map((m, j) => (
                        <td key={m.slot} className="p-1 align-top">
                          <Cell cell={rows[i]?.[j]} sentence={rows[i]?.[j] ? cellSentence(dex, m.set, t, rows[i]![j]) : ''} survive={rows[i]?.[j]?.theirs ? `Optimise ${dex.species(m.set.speciesId)?.name} to survive ${dex.species(t.speciesId)?.name}'s ${rows[i]![j].theirs!.move}` : ''} onOpen={() => openCalc(m.set, m.slot, t)} onSurvive={() => openOptimizer(m.slot, t, rows[i]![j])} />
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
                      <span className="text-xs text-muted">{t.usagePct.toFixed(1)}% usage</span>
                    </div>
                  </div>
                  {line && <p className="mb-2 text-xs text-muted">{line}</p>}
                  <div className="space-y-1.5">
                    {members.map((m, j) => (
                      <div key={m.slot} className="flex items-center gap-2">
                        <Sprite speciesId={m.set.speciesId} name={dex.species(m.set.speciesId)?.name} types={dex.species(m.set.speciesId)?.types} set={format.spriteSet} size={28} />
                        <div className="min-w-0 flex-1">
                          <Cell cell={rows[i]?.[j]} sentence={rows[i]?.[j] ? cellSentence(dex, m.set, t, rows[i]![j]) : ''} survive={rows[i]?.[j]?.theirs ? `Optimise ${dex.species(m.set.speciesId)?.name} to survive ${dex.species(t.speciesId)?.name}'s ${rows[i]![j].theirs!.move}` : ''} onOpen={() => openCalc(m.set, m.slot, t)} onSurvive={() => openOptimizer(m.slot, t, rows[i]![j])} />
                        </div>
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="text-xs text-muted">
            Blue and ✓: good for you · orange and ✗: bad for you · ~ even. “You” is your best move, “It” the threat’s. Damage is % of the defender’s HP; Mega
            Stone holders are read at their worse forme for you and their better one for the threat. Tap a cell to open it in the Damage Calc.
          </p>
        </>
      )}
    </div>
  );
}

function Cell({ cell, sentence, survive, onOpen, onSurvive }: { cell: ThreatCell | undefined; sentence: string; survive: string; onOpen: () => void; onSurvive: () => void }) {
  if (!cell) return <div className="min-h-16 rounded-lg border border-dashed border-border p-2 text-center text-muted">…</div>;
  const b = bucket(cell.verdict);
  const range = (m: NonNullable<ThreatCell['mine']>) => (m.percent[0] === m.percent[1] ? `${m.percent[0]}%` : `${m.percent[0]}–${m.percent[1]}%`);
  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={onOpen}
        aria-label={sentence}
        title={sentence}
        className={cn(
          'block min-h-16 w-full min-w-28 rounded-lg border p-1.5 text-left leading-tight hover:brightness-95 pointer-coarse:min-h-14',
          b === 'good' && 'border-accent/50 bg-accent/12',
          b === 'bad' && 'border-warn/60 bg-warn/15',
          b === 'even' && 'border-border bg-surface-2',
        )}
      >
        <span className="block font-semibold">
          {b === 'good' ? '✓' : b === 'bad' ? '✗' : '~'} You: {cell.mine ? `${KILL_SHORT[cell.mine.kill]} ${range(cell.mine)}` : '—'}
        </span>
        <span className="block">It: {cell.theirs ? `${KILL_SHORT[cell.theirs.kill]} ${range(cell.theirs)}` : '—'}</span>
        <span className="block text-muted">{speedText(cell)}</span>
      </button>
      {cell.theirs && (
        <button type="button" onClick={onSurvive} aria-label={survive} title={survive} className="block w-full rounded px-1 py-0.5 text-left text-[11px] font-semibold text-accent underline-offset-2 hover:underline pointer-coarse:min-h-11">
          Survive this…
        </button>
      )}
    </div>
  );
}
