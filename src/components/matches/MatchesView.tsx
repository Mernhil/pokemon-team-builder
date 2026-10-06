import { useMemo, useState } from 'react';
import { Check, Copy, Crosshair, Flag, ListChecks, Plus, Swords } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { regulationInfo } from '@/domain/formats';
import { matchesToCSV, type Match } from '@/domain/matches';
import { createSet } from '@/domain/team';
import type { FormatRules } from '@/domain/types';
import { useCalcStore } from '@/store/calcStore';
import { useMatchStore } from '@/store/matchStore';
import { useTeamStore } from '@/store/teamStore';
import { MATCH_SOURCE_LABEL, matchesForSource, nameOf, type MatchSource, type SharedMatch } from '@/domain/sharing';
import { useShareStore } from '@/sync/shareStore';
import { Sprite } from '../ui/Sprite';
import { MatchForm } from './MatchForm';
import { MatchStats } from './MatchStats';
import { MatchupBuilder } from './MatchupBuilder';
import { Button, Checkbox, EmptyState, Panel, Select, Tabs } from '../ui/primitives';
import { cn } from '../ui/styles';

/** A friend's match, read only: the result, the event, what they faced and their notes. */
function SharedMatchCard({ dex, match, who, spriteSet }: { dex: Dex; match: SharedMatch; who: string; spriteSet: FormatRules['spriteSet'] }) {
  return (
    <Panel title={`${who}'s match · ${match.date}`} bodyClassName="space-y-2 p-3">
      <p className="text-sm">
        <b className={match.result === 'win' ? 'text-good' : 'text-bad'}>{match.result === 'win' ? 'Win' : 'Loss'}</b>
        {match.eventName ? ` · ${match.eventName}` : ''}
        <span className="text-muted"> · view only</span>
      </p>
      {match.opponentTeam.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Opponent's team">
          {match.opponentTeam.map((o, i) => {
            const sp = dex.species(o.speciesId);
            return (
              <li key={i} title={sp?.name ?? o.speciesId}>
                <Sprite speciesId={o.speciesId} name={sp?.name} types={sp?.types} set={spriteSet} size={40} />
              </li>
            );
          })}
        </ul>
      )}
      {match.notes && <p className="text-sm whitespace-pre-wrap text-muted">{match.notes}</p>}
    </Panel>
  );
}

export function MatchesView({ dex, format }: { dex: Dex; format: FormatRules }) {
  const [tab, setTab] = useState<'log' | 'builder'>('log');
  const matchesById = useMatchStore((s) => s.matches);
  const order = useMatchStore((s) => s.order);
  const mine = useMemo(() => order.map((id) => matchesById[id]).filter(Boolean), [order, matchesById]);
  // A friend's shared log is a separate source: it only counts in the stats when I pick "Both of us".
  const theirs = useShareStore((s) => s.matches);
  const names = useShareStore((s) => s.names);
  const [source, setSource] = useState<MatchSource>('mine');
  const effectiveSource = theirs.length ? source : 'mine';
  const matches = useMemo<(Match | SharedMatch)[]>(
    () => matchesForSource<Match>(mine, theirs, effectiveSource).sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt),
    [mine, theirs, effectiveSource],
  );
  const theirName = theirs[0] ? nameOf(theirs[0].owner, names) : '';
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
  const activeIsTheirs = !!active && 'owner' in active;
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
      <div className="flex flex-wrap items-center gap-2">
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
        <Button variant="primary" className="max-sm:w-full sm:ml-auto" onClick={() => useTeamStore.getState().setView('gameday')}>
          <Flag size={15} aria-hidden /> Start a match
        </Button>
      </div>

      {tab === 'builder' ? (
        <MatchupBuilder defaultFormatId={format.id} />
      ) : (
        <>
          {matches.length > 0 && (
          <Panel bodyClassName="flex flex-wrap items-center gap-2 p-3">
            <Select aria-label="Filter by regulation" className="w-full sm:w-auto" value={regFilter} onChange={(e) => setRegFilter(e.target.value)}>
              <option value="">All regulations</option>
              {regsUsed.map((id) => (
                <option key={id} value={id}>
                  {regulationInfo(id)?.shortName ?? id}
                </option>
              ))}
            </Select>
            <Select aria-label="Filter by my team" className="w-full sm:w-auto" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="">All teams</option>
              {teamOrder.map((id) => (
                <option key={id} value={id}>
                  {teams[id]?.name}
                </option>
              ))}
            </Select>
            {theirs.length > 0 && (
              <Select aria-label="Whose matches" className="w-full sm:w-auto" value={effectiveSource} onChange={(e) => { setSource(e.target.value as MatchSource); setSelected(null); }}>
                {(Object.keys(MATCH_SOURCE_LABEL) as MatchSource[]).map((k) => (
                  <option key={k} value={k}>
                    {k === 'theirs' ? `${theirName}'s` : MATCH_SOURCE_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
            <label className="flex min-min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
              <Checkbox checked={lossOnly} onChange={(e) => setLossOnly(e.target.checked)} />
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
                        {'owner' in m && <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-3xs font-semibold text-muted">{nameOf(m.owner, names)}</span>}
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
                {active && activeIsTheirs ? <SharedMatchCard dex={dex} spriteSet={format.spriteSet} match={active as SharedMatch} who={nameOf((active as SharedMatch).owner, names)} /> : active ? <MatchForm dex={dex} format={format} match={active} /> : <EmptyState title="Pick a match on the left to see or edit it." />}
                <MatchStats dex={dex} format={format} matches={matches} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
