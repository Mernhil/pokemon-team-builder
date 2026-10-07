import { useMemo, useState } from 'react';
import { AlertTriangle, Crosshair, Skull } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { defaultSide, type FieldConditions } from '@/domain/battle/conditions';
import { usageLabel } from '@/domain/meta';
import type { MetaSet } from '@/domain/metaSets';
import { THREAT_COUNTS, ohkoEntries, type OhkoMode } from '@/domain/threats';
import type { FormatRules, PokemonSet, Team } from '@/domain/types';
import { useCalcStore } from '@/store/calcStore';
import { useTeamStore } from '@/store/teamStore';
import { ChipRow, Toggle } from '../ui/chips';
import { Sprite } from '../ui/Sprite';
import { Chip, EmptyState, Help, LoadingState, Notice, Panel, Select, Tabs } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useThreatReport } from './useThreatReport';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions');
const range = (p: [number, number]) => (p[0] === p[1] ? `${p[0]}%` : `${p[0]}–${p[1]}%`);

/**
 * Two reports in one view, on the Threat report's engine and data: which of the most-used Pokémon can
 * OHKO each of yours ('by'), and which of them each of yours can OHKO ('to'). Guaranteed OHKOs come
 * first, then ones that only happen on some damage rolls; tap a row to open it in the Damage Calc.
 */
export function OhkoReportView({ dex, format, team, mode, onMode }: { dex: Dex; format: FormatRules; team: Team; mode: OhkoMode; onMode: (m: OhkoMode) => void }) {
  const setView = useTeamStore((s) => s.setView);
  const [count, setCount] = useState<number>(30);
  const [possible, setPossible] = useState(true);
  const [field, setField] = useState<FieldConditions>({ gameType: 'Doubles', weather: '', terrain: '', trickRoom: false, gravity: false });
  const { picked, loading, threats, members, rows, done, error } = useThreatReport({ dex, format, team, count, field });
  const by = mode === 'by';
  const Icon = by ? Skull : Crosshair;
  const title = by ? 'Can be OHKO’d by' : 'Can OHKO';

  const entries = useMemo(
    () => members.map((_, j) => ohkoEntries(rows, j, mode).filter((e) => possible || e.kill === 'ohko')),
    [members, rows, mode, possible],
  );

  const open = (member: PokemonSet, slot: number, threat: MetaSet) => {
    const calc = useCalcStore.getState();
    const mine = { set: member, cond: defaultSide(!!dex.megaFor(member.speciesId, member.itemId)), crits: [false, false, false, false] as [boolean, boolean, boolean, boolean], origin: { teamName: team.name, slot: slot + 1 } };
    const theirs = { set: threat.set, cond: { ...defaultSide(threat.megaMode !== 'base'), megaMode: threat.megaMode }, crits: [false, false, false, false] as [boolean, boolean, boolean, boolean] };
    // The attacker is whoever does the OHKO.
    calc.setSide('attacker', by ? theirs : mine);
    calc.setSide('defender', by ? mine : theirs);
    calc.setField(field);
    setView('calc');
  };

  if (format.datasetId !== 'champions') {
    return (
      <EmptyState icon={Icon} title="This report needs meta usage data, which only exists for Champions">
        Switch the team’s format to a Champions regulation to see which Pokémon people actually use can OHKO yours, and which of theirs yours can OHKO.
      </EmptyState>
    );
  }
  if (loading) return <LoadingState label="Loading usage data…" />;
  if (!picked) {
    return (
      <EmptyState icon={Icon} title="No usage data to build this report from yet">
        Early numbers from tournaments and Showdown replays appear within days of a regulation starting; the app picks them up with its next update.
      </EmptyState>
    );
  }
  const reg = champRegs.find((r) => r.id === picked.regulationId);
  const set = <K extends keyof FieldConditions>(k: K, v: FieldConditions[K]) => setField((f) => ({ ...f, [k]: v }));
  const calculated = rows.filter(Boolean).length;

  return (
    <div className="space-y-3">
      <Panel bodyClassName="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Tabs<'ohkod' | 'ohko'>
            label="OHKO report"
            tabs={[
              { id: 'ohkod', label: 'Can be OHKO’d by', icon: Skull },
              { id: 'ohko', label: 'Can OHKO', icon: Crosshair },
            ]}
            value={by ? 'ohkod' : 'ohko'}
            onChange={(v) => onMode(v === 'ohkod' ? 'by' : 'to')}
          />
          <p className="min-w-0 text-sm text-muted">
            against the {count} most-used sets in <b className="text-fg">{reg?.name ?? picked.regulationId}</b>
          </p>
          <label className="ml-auto flex items-center gap-2 text-xs text-muted">
            Top
            <Select aria-label="Pokémon checked" className="w-auto" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {THREAT_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n} Pokémon
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
        <ChipRow label="Include">
          <Toggle pressed={possible} onClick={() => setPossible(!possible)} title="OHKOs that only happen on some damage rolls">
            Possible OHKOs
          </Toggle>
        </ChipRow>
      </Panel>

      {picked.fellBackFrom && (
        <Notice icon={AlertTriangle} title={`No usage data for ${champRegs.find((r) => r.id === picked.fellBackFrom)?.shortName ?? 'this regulation'} yet`}>
          Showing {reg?.shortName ?? picked.regulationId}’s numbers, the newest published.
        </Notice>
      )}
      {error && <Notice tone="bad" title="Couldn’t calculate the report">{error}</Notice>}

      {members.length === 0 ? (
        <EmptyState icon={Icon} title="Add Pokémon to your team first">
          Each of your Pokémon is calculated against each common set.
        </EmptyState>
      ) : (
        <>
          <p role="status" className="text-xs text-muted">
            {done ? `${calculated} Pokémon calculated against ${members.length} of yours.` : `Calculating… ${calculated} of ${threats.length}`}
          </p>
          <ul className="grid gap-3 lg:grid-cols-2" aria-label={title}>
            {members.map((m, j) => {
              const sp = dex.species(m.set.speciesId);
              const list = entries[j];
              const sure = list.filter((e) => e.kill === 'ohko').length;
              return (
                <li key={m.slot}>
                  <Panel
                    title={
                      <span className="flex items-center gap-2">
                        <Sprite speciesId={m.set.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={32} />
                        {sp?.name ?? m.set.speciesId}
                      </span>
                    }
                    actions={
                      <Chip tone={by ? (sure ? 'bad' : list.length ? 'warn' : 'good') : sure ? 'good' : 'neutral'}>
                        {list.length === 0 ? (done ? 'None' : '…') : `${sure} sure${list.length > sure ? ` · ${list.length - sure} possible` : ''}`}
                      </Chip>
                    }
                  >
                    {list.length === 0 ? (
                      <p className="text-sm text-muted">
                        {!done ? 'Calculating…' : by ? `None of the top ${count} OHKOs ${sp?.name ?? 'it'}.` : `${sp?.name ?? 'It'} can’t OHKO any of the top ${count}.`}
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {list.map((e) => {
                          const t = threats[e.threatIndex];
                          const tsp = dex.species(t.speciesId);
                          const speed = e.first === 'me' ? 'you move first' : e.first === 'them' ? 'it moves first' : 'speed tie';
                          const sentence = `${by ? `${tsp?.name} ${e.kill === 'ohko' ? 'OHKOs' : 'can OHKO'} ${sp?.name}` : `${sp?.name} ${e.kill === 'ohko' ? 'OHKOs' : 'can OHKO'} ${tsp?.name}`} with ${e.move.move} (${range(e.move.percent)}); ${speed}.`;
                          return (
                            <li key={e.threatIndex}>
                              <button
                                type="button"
                                onClick={() => open(m.set, m.slot, t)}
                                aria-label={`${sentence} Open in the Damage Calc.`}
                                title={sentence}
                                className={cn(
                                  'flex min-h-11 w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-sm hover:brightness-95',
                                  e.kill === 'ohko' ? (by ? 'border-warn/60 bg-warn/15' : 'border-accent/50 bg-accent/12') : 'border-border bg-surface-2',
                                )}
                              >
                                <Sprite speciesId={t.speciesId} name={tsp?.name} types={tsp?.types} set={format.spriteSet} size={28} />
                                <span className="min-w-0 flex-1">
                                  <b className="block truncate">{tsp?.name ?? t.speciesId}</b>
                                  <span className="block truncate text-xs text-muted">
                                    {e.move.move} · {range(e.move.percent)} · {usageLabel(t)}
                                  </span>
                                </span>
                                <span className="shrink-0 text-right text-xs">
                                  <b className="block">{e.kill === 'ohko' ? 'OHKO' : 'Possible'}</b>
                                  <span className="text-muted">{speed}</span>
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Panel>
                </li>
              );
            })}
          </ul>
          <Help label="How to read this list">
            “OHKO” means every damage roll knocks out from full HP; “Possible” only some rolls. Mega Stone holders, yours and theirs, are read at their best forme. Calculated
            with the Damage Calc on each Pokémon’s most-used set, under the conditions above. Tap a row to open it there.
          </Help>
        </>
      )}
    </div>
  );
}
