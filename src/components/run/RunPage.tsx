import { useMemo, useState } from 'react';
import { Flag, Plus, Skull, Swords, Trash2, Users } from 'lucide-react';
import { wildByLocation } from '@/domain/atlas';
import { capWarnings, defaultRules, hasMilestones, milestones, summarize, type Run } from '@/domain/runs';
import { useActiveRun, useRunStore } from '@/store/runStore';
import { Button, Checkbox, Chip, ConfirmInline, EmptyState, Input, Notice, Panel, Select, Tabs } from '../ui/primitives';
import { useAtlasCtx } from '../atlas/context';
import { RunBoss } from './RunBoss';
import { RunEncounters } from './RunEncounters';
import { RunParty } from './RunParty';
import { RunRules } from './RunRules';

type RunTab = 'encounters' | 'party' | 'boss' | 'rules';

/** Pokénav's Run page: a playthrough (optionally a Nuzlocke) for the selected game, phone-first. */
export function RunPage() {
  const { game, file, pokedex, speciesName, dex } = useAtlasCtx();
  const run = useActiveRun(game.id);
  const runs = useRunStore((s) => s.runs);
  const order = useRunStore((s) => s.order);
  const runIds = useMemo(() => order.filter((id) => runs[id]?.game === game.id), [order, runs, game.id]);
  const [tab, setTab] = useState<RunTab>('encounters');
  const [creating, setCreating] = useState(false);

  const caps = useMemo(() => (hasMilestones(game.id) ? milestones(file, game.id) : []), [file, game.id]);
  const wild = useMemo(() => (pokedex ? wildByLocation(pokedex, game.dexGame) : new Map()), [pokedex, game.dexGame]);
  const hasBosses = caps.length > 0;

  if (!run || creating) {
    return (
      <div className="space-y-3">
        {runIds.length > 0 && (
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Back to {runs[runIds[0]].name}
          </Button>
        )}
        <NewRun gameName={game.name} onDone={() => setCreating(false)} first={!run} />
      </div>
    );
  }

  const summary = summarize(run, caps);
  const warnings = capWarnings(run, summary.next);
  const monName = (id: string) => {
    const m = run.mons.find((x) => x.id === id);
    return m ? m.nickname || speciesName(m.species) : id;
  };
  const activeTab: RunTab = !hasBosses && tab === 'boss' ? 'encounters' : tab;

  return (
    <div className="space-y-3">
      <RunSwitcher run={run} runIds={runIds} onNew={() => setCreating(true)} />

      {!hasBosses && (
        <Notice tone="accent">
          {game.lite
            ? `${game.name} has encounters only in the Pokénav, so this run tracks encounters, your party and deaths. There are no level caps or boss teams for it.`
            : `No level caps or boss teams for ${game.name} yet; the run tracks encounters, your party and deaths.`}
        </Notice>
      )}

      <Panel title={run.name} actions={<span className="text-xs text-muted">Started {run.startedAt}</span>} bodyClassName="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Run summary" role="group">
          {hasBosses && (
            <Chip tone="accent" icon={Flag}>
              Badges {summary.badges}/{summary.totalBadges}
            </Chip>
          )}
          <Chip icon={Users}>{summary.alive} alive</Chip>
          {run.rules.nuzlocke && (
            <Chip icon={Skull} tone={summary.dead ? 'bad' : 'neutral'}>
              {summary.dead} dead
            </Chip>
          )}
          {run.rules.nuzlocke ? <Chip>Nuzlocke</Chip> : <Chip>No Nuzlocke rules</Chip>}
        </div>
        {hasBosses && (
          <p role="status" className="text-lg font-bold">
            {summary.next ? (
              <>
                Next cap: {summary.next.level} <span className="font-semibold text-muted">({summary.next.name})</span>
              </>
            ) : (
              'You have beaten every Gym leader, the Elite Four and the Champion.'
            )}
          </p>
        )}
        {warnings.length > 0 && (
          <ul aria-label="Over the level cap" aria-live={run.rules.levelCaps === 'hard' ? 'assertive' : 'polite'} className="space-y-1">
            {warnings.map((w) => (
              <li key={w.monId} className={run.rules.levelCaps === 'hard' ? 'rounded-lg border border-bad/40 bg-bad/8 px-2.5 py-1.5 text-sm text-bad' : 'rounded-lg border border-warn/40 bg-warn/8 px-2.5 py-1.5 text-sm'}>
                {monName(w.monId)} (Lv {w.level}) is over the next level cap ({w.cap}).{run.rules.levelCaps === 'hard' ? ' Hard cap: leave it in the box.' : ' Soft cap: keep it out of battles if you can.'}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Tabs
        label="Run sections"
        value={activeTab}
        onChange={setTab}
        tabs={[
          { id: 'encounters', label: 'Encounters' },
          { id: 'party', label: 'Party' },
          ...(hasBosses ? [{ id: 'boss' as const, label: 'Next boss', icon: Swords }] : []),
          { id: 'rules', label: 'Rules' },
        ]}
        className="w-full sm:w-fit"
      />

      {activeTab === 'encounters' && <RunEncounters run={run} wild={wild} loading={!pokedex} />}
      {activeTab === 'party' && <RunParty run={run} next={summary.next} dex={dex} />}
      {activeTab === 'boss' && hasBosses && <RunBoss run={run} milestones={caps} next={summary.next} />}
      {activeTab === 'rules' && <RunRules run={run} />}
    </div>
  );
}

/** Pick one of this game's runs, start another, or delete this one (asks first). */
function RunSwitcher({ run, runIds, onNew }: { run: Run; runIds: string[]; onNew: () => void }) {
  const { game } = useAtlasCtx();
  const runs = useRunStore((s) => s.runs);
  const { selectRun, deleteRun } = useRunStore.getState();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Run" className="min-w-0 flex-1 sm:flex-none" value={run.id} onChange={(e) => selectRun(game.id, e.target.value)}>
        {runIds.map((id) => (
          <option key={id} value={id}>
            {runs[id].name} · {runs[id].startedAt}
          </option>
        ))}
      </Select>
      <Button onClick={onNew}>
        <Plus size={14} aria-hidden /> New run
      </Button>
      {confirm ? (
        <ConfirmInline question={<>Delete “{run.name}”?</>} onConfirm={() => (deleteRun(run.id), setConfirm(false))} onKeep={() => setConfirm(false)} />
      ) : (
        <Button size="icon" variant="ghost" aria-label={`Delete ${run.name}`} className="hover:text-bad" onClick={() => setConfirm(true)}>
          <Trash2 size={15} aria-hidden />
        </Button>
      )}
    </div>
  );
}

function NewRun({ gameName, onDone, first }: { gameName: string; onDone: () => void; first: boolean }) {
  const { game } = useAtlasCtx();
  const [name, setName] = useState('');
  const [nuzlocke, setNuzlocke] = useState(true);
  const start = () => {
    useRunStore.getState().newRun(game.id, name, defaultRules(nuzlocke));
    onDone();
  };
  const body = (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start();
      }}
    >
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Run name
        <Input value={name} maxLength={60} placeholder={`${game.shortName} run`} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
        <Checkbox checked={nuzlocke} onChange={(e) => setNuzlocke(e.target.checked)} />
        <span>
          <b>Nuzlocke rules</b> <span className="text-muted">(first encounter per area, dupes clause, shiny clause, soft level caps; change any of it under Rules)</span>
        </span>
      </label>
      <Button type="submit" variant="primary">
        Start run
      </Button>
    </form>
  );
  return first ? (
    <EmptyState title={`Start a ${gameName} run`} className="items-stretch text-left">
      <span className="block text-sm text-muted">Track your encounters, your party, deaths, badges and the next level cap. It stays on this device.</span>
      <span className="mt-3 block">{body}</span>
    </EmptyState>
  ) : (
    <Panel title="New run" bodyClassName="p-3">
      {body}
    </Panel>
  );
}

