import { useMemo, useState } from 'react';
import { Check, Copy, Crosshair, Plus } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { regulationInfo } from '@/domain/formats';
import { matchesToCSV, type Match } from '@/domain/matches';
import { createSet } from '@/domain/team';
import type { FormatRules } from '@/domain/types';
import { useCalcStore } from '@/store/calcStore';
import { useMatchStore } from '@/store/matchStore';
import { useTeamStore } from '@/store/teamStore';
import { MatchForm } from './MatchForm';
import { MatchStats } from './MatchStats';
import { MatchupBuilder } from './MatchupBuilder';
import { Button, Select, cn } from '../ui/primitives';

export function MatchesView({ dex, format }: { dex: Dex; format: FormatRules }) {
  const [tab, setTab] = useState<'log' | 'builder'>('log');
  const matchesById = useMatchStore((s) => s.matches);
  const order = useMatchStore((s) => s.order);
  const matches = useMemo(() => order.map((id) => matchesById[id]).filter(Boolean), [order, matchesById]);
  const { addMatch } = useMatchStore.getState();
  const teams = useTeamStore((s) => s.teams);
  const teamOrder = useTeamStore((s) => s.order);
  const [selected, setSelected] = useState<string | null>(matches[0]?.id ?? null);
  const [lossOnly, setLossOnly] = useState(false);
  const [regFilter, setRegFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(
    () =>
      matches
        .filter((m) => !lossOnly || m.result === 'loss')
        .filter((m) => !regFilter || m.regulationId === regFilter)
        .filter((m) => !teamFilter || m.myTeamId === teamFilter),
    [matches, lossOnly, regFilter, teamFilter],
  );

  const active = matches.find((m) => m.id === selected) ?? null;
  const regsUsed = useMemo(() => [...new Set(matches.map((m) => m.regulationId).filter(Boolean))] as string[], [matches]);

  const newMatch = () => {
    const id = addMatch();
    setSelected(id);
  };

  const exportCsv = async () => {
    const csv = matchesToCSV(
      filtered,
      (id) => dex.species(id)?.name ?? id,
      (id) => teams[id]?.name ?? 'Deleted team',
    );
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — nothing more we can do in a sandboxed frame */
    }
  };

  const sendThreatToCalc = (m: Match) => {
    if (!m.opponentTeam.length) return;
    const first = m.opponentTeam[0];
    const set = createSet(dex, first.speciesId, format);
    if (first.itemId) set.itemId = first.itemId;
    if (first.abilityId) set.abilityId = first.abilityId;
    if (first.teraType) set.teraType = first.teraType;
    if (first.moves?.length) set.moves = [first.moves[0] ?? '', first.moves[1] ?? '', first.moves[2] ?? '', first.moves[3] ?? ''];
    useCalcStore.getState().patchSide('defender', { set, cond: useCalcStore.getState().defender.cond, crits: [false, false, false, false] });
    useTeamStore.getState().setView('calc');
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg bg-surface-2 p-1 text-sm" role="tablist" aria-label="Matches">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'log'}
          onClick={() => setTab('log')}
          className={cn('flex-1 rounded-md px-3 py-1.5 font-semibold sm:flex-none', tab === 'log' ? 'bg-surface shadow-sm' : 'text-muted hover:text-fg')}
        >
          Match log
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'builder'}
          onClick={() => setTab('builder')}
          className={cn('flex-1 rounded-md px-3 py-1.5 font-semibold sm:flex-none', tab === 'builder' ? 'bg-surface shadow-sm' : 'text-muted hover:text-fg')}
        >
          Team Builder
        </button>
      </div>

      {tab === 'builder' ? (
        <MatchupBuilder defaultFormatId={format.id} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Match log</span>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={lossOnly} onChange={(e) => setLossOnly(e.target.checked)} className="accent-[var(--color-accent)]" />
              Losses only
            </label>
            <Select aria-label="Filter by regulation" className="h-8 w-auto text-xs" value={regFilter} onChange={(e) => setRegFilter(e.target.value)}>
              <option value="">All regulations</option>
              {regsUsed.map((id) => (
                <option key={id} value={id}>
                  {regulationInfo(id)?.shortName ?? id}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by my team" className="h-8 w-auto text-xs" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="">All teams</option>
              {teamOrder.map((id) => (
                <option key={id} value={id}>
                  {teams[id]?.name}
                </option>
              ))}
            </Select>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" onClick={exportCsv} disabled={!filtered.length}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied CSV' : 'Copy CSV'}
              </Button>
              <Button size="sm" variant="primary" onClick={newMatch}>
                <Plus size={13} /> Log match
              </Button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="scrollbar-thin max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border border-border bg-surface p-1.5">
              {filtered.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelected(m.id)}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs', m.id === selected ? 'bg-accent/15' : 'hover:bg-surface-2')}
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', m.result === 'win' ? 'bg-good' : 'bg-bad')} />
                  <span className="font-mono text-muted">{m.date}</span>
                  <span className="min-w-0 flex-1 truncate">{m.eventName || (m.opponentTeam[0] ? (dex.species(m.opponentTeam[0].speciesId)?.name ?? '') : 'Untitled')}</span>
                  {m.opponentTeam.length > 0 && (
                    <Crosshair
                      size={13}
                      className="shrink-0 text-muted hover:text-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        sendThreatToCalc(m);
                      }}
                      aria-label="Send first opponent Pokémon to the damage calculator"
                    />
                  )}
                </button>
              ))}
              {!filtered.length && <p className="p-4 text-center text-xs text-muted">No matches logged yet.</p>}
            </aside>

            <div className="space-y-3">
              {active ? <MatchForm dex={dex} format={format} match={active} /> : <p className="p-10 text-center text-sm text-muted">Log your first match to get started.</p>}
              <MatchStats dex={dex} matches={matches} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
