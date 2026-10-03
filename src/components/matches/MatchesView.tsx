import { useMemo, useState } from 'react';
import { Check, Copy, Crosshair, ListChecks, Plus, Swords } from 'lucide-react';
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
import { SourceSelect } from './SourceSelect';
import { useMatchSource } from './useMatchSource';
import { MatchupBuilder } from './MatchupBuilder';
import { Button, EmptyState, Panel, Select, Tabs } from '../ui/primitives';
import { cn } from '../ui/styles';

export function MatchesView({ dex, format }: { dex: Dex; format: FormatRules }) {
  const [tab, setTab] = useState<'log' | 'builder'>('log');
  const matchesById = useMatchStore((s) => s.matches);
  const order = useMatchStore((s) => s.order);
  const mine = useMemo(() => order.map((id) => matchesById[id]).filter(Boolean), [order, matchesById]);
  // A friend's shared matches: only ever shown on their own or together with mine, on request.
  const { source, setSource, options, matches, foreign, friendName } = useMatchSource(mine);
  const { addMatch } = useMatchStore.getState();
  const teams = useTeamStore((s) => s.teams);
  const teamOrder = useTeamStore((s) => s.order);
  const [selected, setSelected] = useState<string | null>(mine[0]?.id ?? null);
  const [lossOnly, setLossOnly] = useState(false);
  const [regFilter, setRegFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(
    () =>
      matches
        .filter((m) => !lossOnly || m.result === 'loss')
        .filter((m) => !regFilter || m.regulationId === regFilter)
        .filter((m) => source !== 'mine' || !teamFilter || m.myTeamId === teamFilter),
    [matches, lossOnly, regFilter, teamFilter, source],
  );

  // A friend's list starts on its first match (nothing of theirs can already be selected).
  const active = matches.find((m) => m.id === selected) ?? (source !== 'mine' ? (filtered[0] ?? null) : null);
  const regsUsed = useMemo(() => [...new Set(matches.map((m) => m.regulationId).filter(Boolean))] as string[], [matches]);

  const newMatch = () => {
    setSource('mine');
    const id = addMatch();
    setSelected(id);
  };

  const exportCsv = async () => {
    const csv = matchesToCSV(
      filtered,
      (id) => dex.species(id)?.name ?? id,
      (id) => teams[id]?.name ?? 'Deleted team',
      // My brought/led ids are Pokémon uids for a saved team.
      (m, id) => {
        const sid = (m.myTeamId ? teams[m.myTeamId]?.slots.find((s) => s?.uid === id)?.speciesId : undefined) ?? id;
        return dex.species(sid)?.name ?? sid;
      },
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
    if (first.teraType && format.capabilities.tera) set.teraType = first.teraType;
    if (first.moves?.length) set.moves = [first.moves[0] ?? '', first.moves[1] ?? '', first.moves[2] ?? '', first.moves[3] ?? ''];
    useCalcStore.getState().patchSide('defender', { set, cond: useCalcStore.getState().defender.cond, crits: [false, false, false, false] });
    useTeamStore.getState().setView('calc');
  };

  return (
    <div className="space-y-3">
      <Tabs
        label="Matches"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'log', label: 'Match log', icon: ListChecks },
          { id: 'builder', label: 'Your team vs. theirs', icon: Swords },
        ]}
        className="w-full sm:w-fit"
      />

      {tab === 'builder' ? (
        <MatchupBuilder defaultFormatId={format.id} />
      ) : (
        <>
          {(matches.length > 0 || options.length > 1) && (
          <Panel bodyClassName="flex flex-wrap items-center gap-2 p-3">
            <SourceSelect source={source} options={options} onChange={setSource} className="w-full sm:w-auto" />
            <Select aria-label="Filter by regulation" className="w-full sm:w-auto" value={regFilter} onChange={(e) => setRegFilter(e.target.value)}>
              <option value="">All regulations</option>
              {regsUsed.map((id) => (
                <option key={id} value={id}>
                  {regulationInfo(id)?.shortName ?? id}
                </option>
              ))}
            </Select>
            {source === 'mine' && (
            <Select aria-label="Filter by my team" className="w-full sm:w-auto" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="">All teams</option>
              {teamOrder.filter((id) => !teams[id]?.shared).map((id) => (
                <option key={id} value={id}>
                  {teams[id]?.name}
                </option>
              ))}
            </Select>
            )}
            <label className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={lossOnly} onChange={(e) => setLossOnly(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
              Losses only
            </label>
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" onClick={exportCsv} disabled={!filtered.length}>
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? 'Copied CSV' : 'Copy CSV'}
              </Button>
              <Button size="sm" variant="primary" onClick={newMatch}>
                <Plus size={14} aria-hidden /> Log match
              </Button>
            </div>
          </Panel>
          )}

          {matches.length === 0 ? (
            <EmptyState
              icon={Swords}
              title="No matches logged yet"
              action={
                <Button variant="primary" onClick={newMatch}>
                  <Plus size={15} aria-hidden /> Log your first match
                </Button>
              }
            >
              Record wins, losses and what your opponents brought. Win rates and the most common opponents appear here once you have a few.
            </EmptyState>
          ) : (
            <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
              <Panel as="aside" bodyClassName="scrollbar-thin max-h-[70dvh] space-y-0.5 overflow-y-auto p-1.5">
                <ul aria-label="Logged matches">
                  {filtered.map((m) => (
                    <li key={m.id} className={cn('flex items-center rounded-lg', m.id === selected ? 'bg-accent/15' : 'hover:bg-surface-2')}>
                      <button
                        type="button"
                        onClick={() => setSelected(m.id)}
                        aria-current={m.id === selected}
                        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm"
                      >
                        <span className={cn('shrink-0 text-xs font-bold', m.result === 'win' ? 'text-good' : 'text-bad')}>{m.result === 'win' ? 'W' : 'L'}</span>
                        <span className="font-mono text-xs text-muted">{m.date}</span>
                        <span className="min-w-0 flex-1 truncate">{m.eventName || (m.opponentTeam[0] ? (dex.species(m.opponentTeam[0].speciesId)?.name ?? '') : 'Untitled')}</span>
                      </button>
                      {m.opponentTeam.length > 0 && (
                        <Button size="icon-sm" variant="ghost" aria-label="Send their first Pokémon to the damage calculator" title="Send to damage calculator" onClick={() => sendThreatToCalc(m)}>
                          <Crosshair size={15} aria-hidden />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
                {!filtered.length && <p className="p-4 text-center text-sm text-muted">No matches fit these filters.</p>}
              </Panel>

              <div className="min-w-0 space-y-3">
                {active ? (
                  foreign.has(active.id) ? <FriendMatch dex={dex} match={active} owner={friendName ?? 'a friend'} /> : <MatchForm dex={dex} format={format} match={active} />
                ) : (
                  <EmptyState title="Pick a match on the left to see or edit it." />
                )}
                {source !== 'mine' && (
                  <p role="status" className="text-sm text-muted">
                    {source.startsWith('both:') ? `These numbers count both of your logs together${friendName ? ` (you and ${friendName})` : ''}.` : `These are ${friendName ?? 'a friend'}’s matches, read-only.`} Switch to “My matches” for your own.
                  </p>
                )}
                <MatchStats dex={dex} format={format} matches={matches} foreign={foreign} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A friend's logged match: everything they recorded, read-only. */
function FriendMatch({ dex, match, owner }: { dex: Dex; match: Match; owner: string }) {
  const name = (id: string) => dex.species(id)?.name ?? id;
  return (
    <Panel title={`${owner}’s match · ${match.date}`} actions={<span className={match.result === 'win' ? 'text-sm font-bold text-good' : 'text-sm font-bold text-bad'}>{match.result === 'win' ? 'Win' : 'Loss'}</span>}>
      <dl className="space-y-2 text-sm">
        {match.eventName && (
          <div>
            <dt className="text-xs font-semibold text-muted">Event</dt>
            <dd>{match.eventName}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-semibold text-muted">Opponent’s team</dt>
          <dd>{match.opponentTeam.length ? match.opponentTeam.map((m) => name(m.speciesId)).join(', ') : 'Not recorded'}</dd>
        </div>
        {match.notes && (
          <div>
            <dt className="text-xs font-semibold text-muted">Notes</dt>
            <dd className="whitespace-pre-wrap">{match.notes}</dd>
          </div>
        )}
      </dl>
      <p className="mt-2 text-xs text-muted">Shared with you by {owner}. You can’t change it.</p>
    </Panel>
  );
}
