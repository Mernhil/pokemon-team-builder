import { Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Check, Flag, Swords, Trash2, Undo2, X } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useDex } from '@/data/useDex';
import { useMetaFor } from '@/data/useMeta';
import { suggestForMatch } from '@/domain/archetypeInputs';
import { planBring, resolveOpponent, sourcesFromLog, type Plan } from '@/domain/bringPlanner';
import { REGULATION_MANIFEST, getFormat } from '@/domain/formats';
import { MAX_OPPONENTS, MAX_PLANS, defaultTeam, opponentLog, playableTeams, recentOpponents, speedOrder, topOpponents, type Bring, type GameDayState } from '@/domain/gameday';
import { bringLimits, createMatch, normalizeBring, type MatchResult } from '@/domain/matches';
import { bucket, type Kill } from '@/domain/threats';
import { VERDICT_CELL } from '../threats/verdictStyle';
import { pickSpeedSnapshot } from '@/domain/speedTiers';
import type { FormatRules, Team } from '@/domain/types';
import { useGameDayStore } from '@/store/gamedayStore';
import { useMatchStore } from '@/store/matchStore';
import { toast } from '@/store/toastStore';
import { useTeamStore } from '@/store/teamStore';
import { SpeciesPicker } from '../editor/SpeciesPicker';
import { BringPicker } from '../matches/BringPicker';
import { LoggedMonDetails } from '../matches/LoggedMonEditor';
import { PlanCard } from '../matches/PlanCard';
import { Toggle } from '../ui/chips';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, Label, LoadingState, Panel, Select, Tabs, TextArea } from '../ui/primitives';
import { cn } from '../ui/styles';

const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

const KILL: Record<Kill, string> = { ohko: 'OHKO', pohko: 'maybe OHKO', '2hko': '2HKO', '3hko': '3HKO+', none: 'no KO' };

/**
 * Game day: team preview to a logged match on one scrolling phone screen. Tap their six, read the plan
 * (bring four, lead two, why, the main risk), the 6×6 matchups and the speed order, note what they show
 * as the game goes, then tap Win or Loss. The game in progress is saved as you go (`ptb:gameday:v1`),
 * so leaving the screen or reloading loses nothing.
 */
export function GameDayView() {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const matchesById = useMatchStore((s) => s.matches);
  const matchOrder = useMatchStore((s) => s.order);
  const myTeamId = useGameDayStore((s) => s.myTeamId);
  const setTeam = useGameDayStore((s) => s.setTeam);

  const playable = useMemo(() => playableTeams(teams, order, (t) => getFormat(t.formatId).datasetId === 'champions'), [teams, order]);
  const matches = useMemo(() => matchOrder.map((id) => matchesById[id]).filter(Boolean), [matchOrder, matchesById]);
  const team = playable.find((t) => t.id === myTeamId) ?? defaultTeam(playable, matches);
  // Remember the team the screen started on, so the match is logged with it.
  useEffect(() => {
    if (team && team.id !== myTeamId) setTeam(team.id);
  }, [team, myTeamId, setTeam]);

  if (!team) {
    return (
      <EmptyState icon={Swords} title="Save a Champions team to play a game with">
        Game day logs each game with the saved team you played (and which of its Pokémon you brought and led). Build a team, then Save it.
        <div className="mt-3">
          <Button variant="primary" onClick={() => useTeamStore.getState().setView('builder')}>
            Go to the builder
          </Button>
        </div>
      </EmptyState>
    );
  }
  return <Game team={team} playable={playable} />;
}

function Game({ team, playable }: { team: Team; playable: Team[] }) {
  const format = getFormat(team.formatId);
  const state = useDex(format.datasetId);
  if (state.status === 'error') return <p className="p-10 text-center text-sm text-bad" role="alert">{state.error}</p>;
  if (state.status !== 'ready') return <LoadingState label="Loading…" />;
  return <GameBody dex={state.dex} format={format} team={team} playable={playable} />;
}

function GameBody({ dex, format, team, playable }: { dex: Dex; format: FormatRules; team: Team; playable: Team[] }) {
  const g = useGameDayStore();
  const store = useGameDayStore.getState();
  const metaFor = useMetaFor();
  const matchesById = useMatchStore((s) => s.matches);
  const matchOrder = useMatchStore((s) => s.order);
  const teams = useTeamStore((s) => s.teams);
  const limits = bringLimits(format.regulationId);
  const picked = useMemo(() => pickSpeedSnapshot(format.regulationId, champRegIds, (id) => metaFor?.(id)), [format.regulationId, metaFor]);
  const nameOf = (id: string) => dex.species(id)?.name ?? id;

  // ---- the numbers ----
  const mine = useMemo(() => team.slots.flatMap((s) => (s ? [{ uid: s.uid, set: s }] : [])), [team.slots]);
  const log = useMemo(() => opponentLog(g), [g]);
  const resolved = useMemo(
    () => sourcesFromLog(log).flatMap((o) => resolveOpponent(dex, format, o.speciesId, { known: o.known, snapshot: picked?.snapshot }) ?? []),
    [log, dex, format, picked],
  );
  // The calculation can lag a tap or two behind on a slow phone; the tapping itself never waits for it.
  const deferred = useDeferredValue(resolved);
  const result = useMemo(() => (mine.length && deferred.length ? planBring({ dex, format, mine, opponents: deferred, limits }) : null), [dex, format, mine, deferred, limits]);
  const plans = result?.plans ?? [];
  const plan: Plan | undefined = plans[Math.min(g.planIndex, Math.max(plans.length - 1, 0))];
  const planBringOf: Bring | undefined = plan ? { brought: plan.brought, leads: plan.leads } : undefined;
  const sets = useMemo(() => new Map(mine.map((m) => [m.uid, m.set] as const)), [mine]);
  const mineRoster = mine.map((m) => ({ id: m.uid, speciesId: m.set.speciesId }));
  const myBring = normalizeBring(g.bring ?? planBringOf ?? { brought: [], leads: [] }, mine.map((m) => m.uid), limits);

  const finish = (result: MatchResult) => {
    const before: GameDayState = { myTeamId: g.myTeamId, opponents: g.opponents, reveals: g.reveals, planIndex: g.planIndex, bring: g.bring, oppBring: g.oppBring, notes: g.notes };
    const draft = { ...createMatch(), regulationId: format.regulationId, myTeamId: team.id, opponentTeam: opponentLog(g) };
    const s = suggestForMatch(draft, teams, dex, format, picked?.snapshot);
    const id = store.logMatch({
      result,
      team,
      plan: planBringOf,
      regulationId: format.regulationId,
      limits,
      archetypes: { ...(s.myArchetype ? { myArchetype: s.myArchetype.tag } : {}), ...(s.opponentArchetype ? { opponentArchetype: s.opponentArchetype.tag } : {}) },
    });
    window.scrollTo({ top: 0 });
    toast(`Logged a ${result === 'win' ? 'win' : 'loss'} in your match log. Next game is ready.`, {
      label: 'Undo',
      run: () => {
        useMatchStore.getState().deleteMatch(id);
        useGameDayStore.setState(before);
      },
    });
  };

  return (
    <div className="space-y-3">
      <MyTeam team={team} playable={playable} dex={dex} format={format} />
      <TheirSix dex={dex} format={format} g={g} top={topOpponents(picked?.snapshot, 30)} recent={recentOpponents(matchOrder.map((id) => matchesById[id]).filter(Boolean), g.opponents)} />

      {g.opponents.length > 0 && !result && <LoadingState label="Working out the plan…" />}
      {result && plan && (
        <Panel title="The plan" actions={<Chip>A suggestion, not a prediction</Chip>}>
          <div className="space-y-3">
            <p className="text-sm">
              They would probably bring: <b>{result.likelyBring.map(nameOf).join(', ')}</b>, leading <b>{result.likelyLeads.map(nameOf).join(' + ')}</b>.
            </p>
            {plans.length > 1 && (
              <Tabs<string>
                label="Plans"
                size="sm"
                tabs={plans.slice(0, MAX_PLANS).map((_, i) => ({ id: String(i), label: `Plan ${i + 1}` }))}
                value={String(Math.min(g.planIndex, plans.length - 1))}
                onChange={(id) => store.choosePlan(Number(id))}
              />
            )}
            <PlanCard plan={plan} index={Math.min(g.planIndex, plans.length - 1)} dex={dex} format={format} sets={sets} />
            <details className="rounded-lg border border-border p-2">
              <summary className="min-h-8 cursor-pointer text-sm font-semibold pointer-coarse:min-h-11">Change what I bring</summary>
              <div className="mt-2 space-y-2">
                <BringPicker dex={dex} format={format} label="I brought" roster={mineRoster} value={myBring} limits={limits} onChange={(b) => store.setBring(b)} />
                {g.bring && (
                  <Button size="sm" onClick={() => store.setBring(undefined)}>
                    <Undo2 size={13} aria-hidden /> Back to the plan’s four
                  </Button>
                )}
              </div>
            </details>
          </div>
        </Panel>
      )}

      {result && result.matrix.length > 0 && <Matchups dex={dex} format={format} mine={mine} opponents={deferred} matrix={result.matrix} />}
      {result && result.matrix.length > 0 && <SpeedOrder dex={dex} mine={mine} opponents={deferred} matrix={result.matrix} />}

      {g.opponents.length > 0 && (
        <Panel title="During the game">
          <div className="space-y-3">
            <p className="text-sm text-muted">Note what they show; the plan and matchups recalculate with it.</p>
            <ul className="space-y-1.5" aria-label="What they showed">
              {g.opponents.map((id) => (
                <RevealRow key={id} dex={dex} format={format} id={id} />
              ))}
            </ul>
            <BringPicker
              dex={dex}
              format={format}
              label="They brought"
              roster={g.opponents.map((id) => ({ id, speciesId: id }))}
              value={normalizeBring(g.oppBring, g.opponents, limits)}
              limits={limits}
              onChange={(b) => store.setOppBring(b)}
            />
            <label className="block space-y-1">
              <Label>Notes</Label>
              <TextArea rows={2} value={g.notes} onChange={(e) => store.setNotes(e.target.value)} placeholder="Anything worth remembering about this game…" />
            </label>
          </div>
        </Panel>
      )}

      <Panel title="After the game">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" className="min-h-14 text-base" onClick={() => finish('win')} disabled={g.opponents.length === 0}>
              <Check size={18} aria-hidden /> Win
            </Button>
            <Button variant="danger" className="min-h-14 text-base" onClick={() => finish('loss')} disabled={g.opponents.length === 0}>
              <Flag size={18} aria-hidden /> Loss
            </Button>
          </div>
          <p className="text-xs text-muted">Logs the game in the match log with what you brought and led, what they showed and brought, and the archetypes the app worked out. Then Next game starts on the same team.</p>
          {g.opponents.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => store.nextGame()}>
              <Trash2 size={13} aria-hidden /> Discard this game
            </Button>
          )}
        </div>
      </Panel>
    </div>
  );
}

function MyTeam({ team, playable, dex, format }: { team: Team; playable: Team[]; dex: Dex; format: FormatRules }) {
  const setTeam = useGameDayStore((s) => s.setTeam);
  return (
    <Panel title="My team" bodyClassName="space-y-2 p-3">
      <Select aria-label="My team" value={team.id} onChange={(e) => setTeam(e.target.value)} className="w-full">
        {playable.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
            {t.variationLabel ? ` · ${t.variationLabel}` : ''}
          </option>
        ))}
      </Select>
      <ul className="flex flex-wrap gap-1" aria-label="My team's Pokémon">
        {team.slots.flatMap((s) => (s ? [s] : [])).map((s) => (
          <li key={s.uid}>
            <Sprite speciesId={s.speciesId} name={dex.species(s.speciesId)?.name} types={dex.species(s.speciesId)?.types} set={format.spriteSet} size={34} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function TheirSix({ dex, format, g, top, recent }: { dex: Dex; format: FormatRules; g: GameDayState; top: string[]; recent: string[] }) {
  const { add, remove, undo, nextGame } = useGameDayStore.getState();
  const [adding, setAdding] = useState<string | undefined>();
  const full = g.opponents.length >= MAX_OPPONENTS;
  const tap = (id: string) => (g.opponents.includes(id) ? remove(id) : add(id));
  const legal = (id: string) => !!dex.species(id) && (!format.regulationId || dex.species(id)!.legalIn.includes(format.regulationId));
  return (
    <Panel
      title={`Their six (${g.opponents.length}/${MAX_OPPONENTS})`}
      actions={
        <span className="flex gap-1">
          <Button size="sm" onClick={() => undo()} disabled={g.opponents.length === 0} aria-label="Undo the last Pokémon">
            <Undo2 size={13} aria-hidden /> Undo
          </Button>
          <Button size="sm" variant="ghost" onClick={() => nextGame()} disabled={g.opponents.length === 0}>
            Clear
          </Button>
        </span>
      }
      bodyClassName="space-y-3 p-3"
    >
      <ul className="flex min-h-11 flex-wrap gap-1.5" aria-label="Their Pokémon">
        {g.opponents.map((id) => (
          <li key={id} className="flex items-center gap-1 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-1">
            <Sprite speciesId={id} name={dex.species(id)?.name} types={dex.species(id)?.types} set={format.spriteSet} size={28} />
            <span className="text-xs font-semibold">{dex.species(id)?.name ?? id}</span>
            <button type="button" aria-label={`Remove ${dex.species(id)?.name ?? id}`} onClick={() => remove(id)} className="rounded-full p-1 text-muted hover:text-bad pointer-coarse:p-2.5">
              <X size={13} aria-hidden />
            </button>
          </li>
        ))}
        {g.opponents.length === 0 && <li className="text-sm text-muted">Tap the Pokémon you see at Team Preview.</li>}
      </ul>

      {top.length > 0 && (
        <div>
          <Label>Most used</Label>
          <ul aria-label="Most used Pokémon" className="mt-1 grid grid-cols-5 gap-1 sm:grid-cols-8 lg:grid-cols-10">
            {top.filter(legal).map((id) => {
              const on = g.opponents.includes(id);
              const sp = dex.species(id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={`${sp?.name ?? id}${on ? ', picked' : ''}`}
                    disabled={!on && full}
                    onClick={() => tap(id)}
                    className={cn(
                      'flex min-h-14 w-full flex-col items-center justify-center rounded-lg border p-0.5 text-3xs leading-tight font-semibold pointer-coarse:min-h-16',
                      on ? 'border-accent bg-accent/15' : 'border-border bg-surface-2 disabled:opacity-40',
                    )}
                  >
                    <Sprite speciesId={id} name={sp?.name} types={sp?.types} set={format.spriteSet} size={32} />
                    <span className="w-full truncate">{sp?.name ?? id}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {recent.length > 0 && !full && (
        <div>
          <Label>Recent opponents</Label>
          <ul aria-label="Recent opponents" className="mt-1 flex flex-wrap gap-1.5">
            {recent.filter(legal).map((id) => (
              <li key={id}>
                <Button size="sm" onClick={() => add(id)} aria-label={`Add ${dex.species(id)?.name ?? id}`}>
                  <Sprite speciesId={id} name={dex.species(id)?.name} types={dex.species(id)?.types} set={format.spriteSet} size={20} />
                  {dex.species(id)?.name ?? id}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!full && (
        <SpeciesPicker
          dex={dex}
          format={format}
          value={adding}
          onChange={(id) => {
            add(id);
            setAdding(undefined);
          }}
          showGenFilter={false}
          placeholder="Search any Pokémon in the regulation…"
        />
      )}
    </Panel>
  );
}

function RevealRow({ dex, format, id }: { dex: Dex; format: FormatRules; id: string }) {
  const reveal = useGameDayStore((s) => s.reveals[id]);
  const set = useGameDayStore.getState().reveal;
  const sp = dex.species(id);
  const shown = [reveal?.itemId && 'item', reveal?.abilityId && 'ability', reveal?.moves?.length && `${reveal.moves.length} move${reveal.moves.length === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  return (
    <li className="rounded-lg border border-border bg-surface-2 p-2">
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
          <Sprite speciesId={id} name={sp?.name} types={sp?.types} set={format.spriteSet} size={30} />
          {sp?.name ?? id}
          {shown && <span className="text-xs font-normal text-muted">showed {shown}</span>}
        </summary>
        <Suspense fallback={null}>
          <LoggedMonDetails dex={dex} format={format} tera={false} mon={{ speciesId: id, ...reveal }} onChange={(m) => set(id, { itemId: m.itemId, abilityId: m.abilityId, moves: m.moves })} />
        </Suspense>
      </details>
    </li>
  );
}

function Matchups({ dex, format, mine, opponents, matrix }: { dex: Dex; format: FormatRules; mine: { uid: string; set: { speciesId: string } }[]; opponents: { speciesId: string }[]; matrix: import('@/domain/threats').ThreatCell[][] }) {
  return (
    <Panel title="Matchups">
      <p className="mb-2 text-xs text-muted">Each of yours against each of theirs, on their most-used sets (or what they showed). → is your best move, ← is theirs; the first line says who moves first.</p>
      <div role="region" aria-label="Matchups table, scrolls sideways" tabIndex={0} className="scrollbar-thin relative overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        <table className="w-full min-w-[34rem] border-separate border-spacing-1 text-center text-2xs">
          <caption className="sr-only">Matchups: your Pokémon in rows, theirs in columns</caption>
          <thead>
            <tr>
              <td />
              {opponents.map((o) => (
                <th key={o.speciesId} scope="col" className="font-semibold">
                  <Sprite speciesId={o.speciesId} name={dex.species(o.speciesId)?.name} types={dex.species(o.speciesId)?.types} set={format.spriteSet} size={28} className="mx-auto" />
                  <span className="block truncate">{dex.species(o.speciesId)?.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mine.map((m, i) => (
              <tr key={m.uid}>
                <th scope="row" className="text-left font-semibold">
                  <span className="flex items-center gap-1">
                    <Sprite speciesId={m.set.speciesId} name={dex.species(m.set.speciesId)?.name} types={dex.species(m.set.speciesId)?.types} set={format.spriteSet} size={26} />
                    <span className="max-w-16 truncate">{dex.species(m.set.speciesId)?.name}</span>
                  </span>
                </th>
                {opponents.map((o, j) => {
                  const c = matrix[i]?.[j];
                  if (!c) return <td key={o.speciesId} />;
                  const b = bucket(c.verdict);
                  const first = c.first === 'me' ? 'you first' : c.first === 'them' ? 'they first' : 'speed tie';
                  const mineKill = c.mine ? KILL[c.mine.kill] : 'no attack';
                  const theirKill = c.theirs ? KILL[c.theirs.kill] : 'no attack';
                  return (
                    <td
                      key={o.speciesId}
                      className={cn('rounded-md border p-1 align-top', VERDICT_CELL[b])}
                    >
                      {/* The row and column headers name the pair; the cell says the rest once, in words. */}
                      <span className="sr-only">{`${b === 'good' ? 'Good for you' : b === 'bad' ? 'Bad for you' : 'Even'}: you ${mineKill}, they ${theirKill}, ${first}`}</span>
                      <span aria-hidden>
                        <b className="block">{b === 'good' ? '▲ good' : b === 'bad' ? '▼ bad' : '◆ even'}</b>
                        <span className="block text-muted">{first}</span>
                        <span className="block">→ {mineKill}</span>
                        <span className="block">← {theirKill}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function SpeedOrder({ dex, mine, opponents, matrix }: { dex: Dex; mine: { uid: string; set: { speciesId: string } }[]; opponents: { speciesId: string }[]; matrix: import('@/domain/threats').ThreatCell[][] }) {
  const [myTailwind, setMy] = useState(false);
  const [theirTailwind, setTheir] = useState(false);
  const [trickRoom, setTr] = useState(false);
  const rows = useMemo(
    () =>
      speedOrder(
        [
          ...mine.flatMap((m, i) => (matrix[i]?.[0] ? [{ id: `m:${m.uid}`, name: dex.species(m.set.speciesId)?.name ?? m.set.speciesId, side: 'mine' as const, speed: matrix[i][0].mySpeed }] : [])),
          ...opponents.flatMap((o, j) => (matrix[0]?.[j] ? [{ id: `t:${o.speciesId}`, name: dex.species(o.speciesId)?.name ?? o.speciesId, side: 'theirs' as const, speed: matrix[0][j].theirSpeed }] : [])),
        ],
        { myTailwind, theirTailwind, trickRoom },
      ),
    [dex, mine, opponents, matrix, myTailwind, theirTailwind, trickRoom],
  );
  return (
    <Panel title="Speed order">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Speed conditions">
          <Toggle pressed={myTailwind} onClick={() => setMy(!myTailwind)}>My Tailwind</Toggle>
          <Toggle pressed={theirTailwind} onClick={() => setTheir(!theirTailwind)}>Their Tailwind</Toggle>
          <Toggle pressed={trickRoom} onClick={() => setTr(!trickRoom)}>Trick Room</Toggle>
        </div>
        <ol aria-label={trickRoom ? 'Speed order, slowest first (Trick Room)' : 'Speed order, fastest first'} className="grid gap-1 sm:grid-cols-2">
          {rows.map((r, i) => (
            <li key={r.id} className={cn('flex min-h-9 items-center gap-2 rounded-md border px-2 text-sm', r.side === 'mine' ? 'border-accent/40 bg-accent/10' : 'border-border bg-surface-2')}>
              <span className="w-5 shrink-0 text-xs text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
              <span className="shrink-0 text-xs text-muted">{r.side === 'mine' ? 'mine' : 'theirs'}{r.tie ? ' · tie' : ''}</span>
              <span className="w-12 shrink-0 text-right font-mono text-xs">{r.effective}</span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
