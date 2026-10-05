import { Suspense, lazy, useMemo, useState } from 'react';
import { ExternalLink, Flag, Swords, Trophy, Columns2, Download, X } from 'lucide-react';
import { useDex } from '@/data/useDex';
import { useTournamentTeams } from '@/data/useTournamentTeams';
import { detectArchetypes, type ArchetypeMon } from '@/domain/archetypes';
import { metaSetLookup } from '@/domain/archetypeInputs';
import { formatForRegulation, getFormat } from '@/domain/formats';
import { playableTeams } from '@/domain/gameday';
import { sourcesFromTeam } from '@/domain/bringPlanner';
import { ARCHETYPE_PRESETS } from '@/domain/matches';
import type { MetaSnapshot } from '@/domain/meta';
import { tournamentTeamToTeam } from '@/domain/tournamentImport';
import { filterTournamentTeams, placingLabel, sortTournamentTeams, type TeamFilter, type TournamentRegulation, type TournamentTeam } from '@/domain/tournamentTeams';
import type { Team } from '@/domain/types';
import { useGameDayStore } from '@/store/gamedayStore';
import { useTeamStore } from '@/store/teamStore';
import { toast } from '@/store/toastStore';
import { SpeciesPicker } from '../editor/SpeciesPicker';
import { ItemSprite } from '../ui/ItemSprite';
import { Modal } from '../ui/Modal';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, Input, Label, LoadingState, Notice, Panel, Select } from '../ui/primitives';

const CompareTeams = lazy(() => import('../compare/CompareView').then((m) => ({ default: m.CompareTeams })));
const BringPlanner = lazy(() => import('../matches/BringPlanner').then((m) => ({ default: m.BringPlanner })));

const fmtDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const PAGE = 30;

/**
 * Meta → Teams: the top cuts of recent online VGC tournaments (Limitless open team sheets), to
 * browse and use: filter by species, archetype, Mega and date; open a team to import it, compare it
 * with one of yours, plan a bring against it or practise on it in Game day. Team sheets show no
 * spreads, so a team used in the app gets estimated ones and says so.
 */
export function TeamsSection({ regulationId, snapshot }: { regulationId: string; snapshot?: MetaSnapshot }) {
  const data = useTournamentTeams(regulationId);
  const dexState = useDex('champions');
  const format = formatForRegulation(regulationId) ?? getFormat('champions-vgc-reg-mc');
  const [filter, setFilter] = useState<TeamFilter>({});
  const [by, setBy] = useState<'date' | 'placing'>('date');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<TournamentTeam | undefined>();
  const dex = dexState.status === 'ready' ? dexState.dex : undefined;

  const archetypeOf = useMemo(() => {
    if (!dex) return undefined;
    const lookup = metaSetLookup(snapshot, dex, format);
    const cache = new Map<TournamentTeam, string | undefined>();
    return (t: TournamentTeam) => {
      if (!cache.has(t)) {
        const mons: ArchetypeMon[] = t.m.map(([speciesId, itemId, abilityId, moves]) => ({ speciesId, itemId: itemId || undefined, abilityId: abilityId || undefined, moves }));
        cache.set(t, detectArchetypes(mons, dex, format, lookup).tags[0]?.tag);
      }
      return cache.get(t);
    };
  }, [dex, format, snapshot]);

  const list = useMemo(() => {
    if (!data || !dex) return [];
    const filtered = filterTournamentTeams(data, filter, { isMega: (s, i) => !!i && !!dex.megaFor(s, i), archetypeOf });
    return sortTournamentTeams(data, filtered, by);
  }, [data, dex, filter, by, archetypeOf]);

  if (!data || !dex) return dexState.status === 'error' ? <p role="alert" className="text-sm text-bad">Couldn’t load the Pokédex data.</p> : <LoadingState label="Loading tournament teams…" />;
  if (!data.teams.length) {
    return (
      <EmptyState icon={Trophy} title="No tournament teams for this regulation yet">
        The top 8 of online tournaments with at least 32 players (Limitless open team sheets) appear here once the daily data job has read some. Pick a regulation that has them, or check back after the next weekend’s events.
      </EmptyState>
    );
  }
  const newest = data.events[0]?.date;
  const set = (patch: Partial<TeamFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };
  const species = filter.species ?? [];

  return (
    <div className="space-y-3">
      <Panel bodyClassName="space-y-3 p-3">
        <p className="text-sm text-muted">
          {data.teams.length} top-cut teams from {data.events.length} tournaments, newest {newest ? fmtDate(newest) : '—'}. Source:{' '}
          <a className="inline-flex items-center gap-1 font-semibold text-fg underline-offset-2 hover:underline" href="https://play.limitlesstcg.com/tournaments/completed?game=VGC" target="_blank" rel="noreferrer">
            Limitless <ExternalLink size={13} aria-hidden />
          </a>
          . Open team sheets show no spreads.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 sm:col-span-2">
            <Label>Contains</Label>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {species.map((id) => (
                <button key={id} type="button" className="inline-flex h-8 items-center gap-1 rounded-md border border-border-strong px-2 text-xs font-semibold" onClick={() => set({ species: species.filter((x) => x !== id) })} aria-label={`Remove ${dex.species(id)?.name ?? id} from the filter`}>
                  {dex.species(id)?.name ?? id} <X size={12} aria-hidden />
                </button>
              ))}
              {species.length < 6 && (
                <div className="min-w-40 flex-1">
                  <SpeciesPicker dex={dex} format={format} showGenFilter={false} placeholder="Add a Pokémon…" onChange={(id) => id && !species.includes(id) && set({ species: [...species, id] })} />
                </div>
              )}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted uppercase">
            Archetype
            <Select aria-label="Archetype" value={filter.archetype ?? ''} onChange={(e) => set({ archetype: e.target.value || undefined })}>
              <option value="">Any</option>
              {ARCHETYPE_PRESETS.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted uppercase">
            Mega
            <Select aria-label="Mega Evolution" value={filter.mega === undefined ? '' : filter.mega ? 'yes' : 'no'} onChange={(e) => set({ mega: e.target.value === '' ? undefined : e.target.value === 'yes' })}>
              <option value="">Any</option>
              <option value="yes">Uses a Mega</option>
              <option value="no">No Mega</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted uppercase">
            From
            <Input type="date" aria-label="From date" value={filter.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted uppercase">
            To
            <Input type="date" aria-label="To date" value={filter.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted uppercase">
            Sort by
            <Select aria-label="Sort by" value={by} onChange={(e) => setBy(e.target.value as 'date' | 'placing')}>
              <option value="date">Newest first</option>
              <option value="placing">Best placing first</option>
            </Select>
          </label>
        </div>
      </Panel>

      <p role="status" className="text-sm text-muted">{list.length} {list.length === 1 ? 'team' : 'teams'}</p>
      {list.length === 0 ? (
        <EmptyState icon={Trophy} title="No team matches these filters">Remove a species or widen the dates.</EmptyState>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2" aria-label="Tournament teams">
          {list.slice(0, shown).map((t) => {
            const ev = data.events[t.e];
            const arch = archetypeOf?.(t);
            return (
              <li key={`${ev.id}:${t.p}:${t.n}`}>
                <button type="button" onClick={() => setOpen(t)} className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-surface p-2.5 text-left hover:bg-surface-2 focus-visible:outline-2">
                  <span className="flex items-center gap-1" aria-hidden>
                    {t.m.map(([id]) => (
                      <Sprite key={id} speciesId={id} name={dex.species(id)?.name} types={dex.species(id)?.types} set={format.spriteSet} size={40} />
                    ))}
                  </span>
                  <span className="text-sm">
                    <b>{placingLabel(t.p)}</b> · {ev.name} · {fmtDate(ev.date)}
                    {arch && <> · <Chip>{arch}</Chip></>}
                  </span>
                  <span className="text-xs text-muted">{t.m.map(([id]) => dex.species(id)?.name ?? id).join(', ')} · {t.n}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {list.length > shown && <Button onClick={() => setShown(shown + PAGE)}>Show more ({list.length - shown} left)</Button>}

      {open && (
        <Modal open onOpenChange={(o) => !o && setOpen(undefined)} title={`${placingLabel(open.p)} · ${data.events[open.e].name}`} description={`${fmtDate(data.events[open.e].date)} · ${data.events[open.e].players} players · ${open.n}`} wide>
          <TeamDetail t={open} data={data} dex={dex} snapshot={snapshot} regulationId={regulationId} onClose={() => setOpen(undefined)} />
        </Modal>
      )}
    </div>
  );
}

function TeamDetail({ t, data, dex, snapshot, regulationId, onClose }: { t: TournamentTeam; data: TournamentRegulation; dex: import('@/data/dex').Dex; snapshot?: MetaSnapshot; regulationId: string; onClose: () => void }) {
  const ev = data.events[t.e];
  const format = formatForRegulation(regulationId) ?? getFormat('champions-vgc-reg-mc');
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const mine = useMemo(() => playableTeams(teams, order, (x) => getFormat(x.formatId).datasetId === 'champions'), [teams, order]);
  const [mineId, setMineId] = useState(mine[0]?.id ?? '');
  const [panel, setPanel] = useState<'compare' | 'plan' | undefined>();
  const imported = useMemo(() => tournamentTeamToTeam(t, ev, dex, format, snapshot), [t, ev, dex, format, snapshot]);
  const already = Object.values(teams).some((x) => x.category === imported.team.category && x.name === imported.team.name);
  const myTeam: Team | undefined = teams[mineId] ?? mine[0];

  const doImport = () => {
    const team = imported.team;
    useTeamStore.getState().addTeams([team], false);
    toast(`Saved “${team.name}” in Tournament teams (spreads estimated).`, { label: 'Undo', run: () => useTeamStore.getState().deleteTeam(team.id) });
  };
  const practise = () => {
    useGameDayStore.getState().startAgainst(
      imported.team.slots.flatMap((s) => (s ? [{ speciesId: s.speciesId, itemId: s.itemId, abilityId: s.abilityId, moves: s.moves.filter(Boolean) }] : [])),
    );
    useTeamStore.getState().setView('gameday');
    onClose();
  };

  return (
    <div className="space-y-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {t.m.map(([speciesId, itemId, abilityId, moves]) => {
          const sp = dex.species(speciesId);
          return (
            <li key={speciesId} className="flex gap-2 rounded-lg border border-border p-2">
              <Sprite speciesId={speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={48} />
              <div className="min-w-0 text-sm">
                <b>{sp?.name ?? speciesId}</b>
                <p className="flex items-center gap-1 text-xs text-muted">
                  {itemId && <ItemSprite itemId={itemId} name={dex.item(itemId)?.name} size={16} />}
                  {dex.item(itemId)?.name ?? itemId ?? 'no item'} · {dex.ability(abilityId)?.name ?? abilityId}
                </p>
                <p className="text-xs">{moves.map((m) => dex.move(m)?.name ?? m).join(' · ')}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted">
        Spreads aren’t on an open team sheet: used in the app, each Pokémon gets its most common spread (or an estimate from base stats), marked “spread estimated”.
      </p>
      <p className="text-sm">
        Source: <a className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline" href={ev.url} target="_blank" rel="noreferrer">Limitless <ExternalLink size={13} aria-hidden /></a>
      </p>
      {imported.dropped.length > 0 && <Notice title="Left out (not legal in this regulation)">{imported.dropped.join(' ')}</Notice>}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={doImport} disabled={already}><Download size={14} aria-hidden /> {already ? 'Already imported' : 'Import as a team'}</Button>
        <Button onClick={() => setPanel(panel === 'compare' ? undefined : 'compare')} disabled={!myTeam} aria-pressed={panel === 'compare'}><Columns2 size={14} aria-hidden /> Compare with mine</Button>
        <Button onClick={() => setPanel(panel === 'plan' ? undefined : 'plan')} disabled={!myTeam} aria-pressed={panel === 'plan'}><Swords size={14} aria-hidden /> Plan vs this team</Button>
        <Button onClick={practise}><Flag size={14} aria-hidden /> Practice in Game day</Button>
      </div>
      {!myTeam && <p className="text-xs text-muted">Save a Champions team of your own to compare with it or plan a bring against this one.</p>}
      {myTeam && panel && (
        <div className="space-y-2">
          <label className="flex flex-col gap-1 text-xs font-bold text-muted uppercase">
            My team
            <Select aria-label="My team" value={myTeam.id} onChange={(e) => setMineId(e.target.value)}>
              {mine.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </label>
          <Suspense fallback={<LoadingState label="Loading…" />}>
            {panel === 'compare' ? (
              <CompareTeams a={myTeam} b={imported.team} />
            ) : (
              <BringPlanner key={`${myTeam.id}:${t.p}:${ev.id}`} dex={dex} format={getFormat(myTeam.formatId)} team={myTeam} initialOpponent={sourcesFromTeam(imported.team)} />
            )}
          </Suspense>
        </div>
      )}
    </div>
  );
}
