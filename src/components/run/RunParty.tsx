import { useState } from 'react';
import { Download, RotateCcw, Skull } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { capWarnings, markDeath, partyOf, partyProblems, partyToTeam, reviveMon, setMonLevel, setMonState, type Milestone, type Run, type RunMon } from '@/domain/runs';
import { useRunStore } from '@/store/runStore';
import { useTeamStore } from '@/store/teamStore';
import { toast } from '@/store/toastStore';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, Input, Panel, Select } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useAtlasCtx } from '../atlas/context';

/** Party, box and graveyard of a run: levels, moving between party and box, deaths with where and why. */
export function RunParty({ run, next, dex }: { run: Run; next?: Milestone; dex: Dex }) {
  const { file, format, locName } = useAtlasCtx();
  const update = useRunStore.getState().update;
  const party = partyOf(run);
  const box = run.mons.filter((m) => m.state === 'box');
  const dead = run.mons.filter((m) => m.state === 'dead');
  const over = new Set(capWarnings(run, next).map((w) => w.monId));
  const problems = partyProblems(run, (id) => dex.species(id));
  const [dying, setDying] = useState<string>();

  const loadIntoBuilder = () => {
    const team = partyToTeam(run, dex, format);
    useTeamStore.getState().addTeams([team], true);
    useTeamStore.getState().setView('builder');
    toast(`Loaded your party as a ${format.shortName} team.`);
  };

  const row = (m: RunMon) => (
    <MonRow
      key={m.id}
      mon={m}
      dex={dex}
      over={over.has(m.id)}
      cap={next?.level}
      dying={dying === m.id}
      places={Object.keys(file.locations).sort((a, b) => locName(a).localeCompare(locName(b), undefined, { numeric: true }))}
      onDying={(v) => setDying(v ? m.id : undefined)}
      onLevel={(lv) => update(run.id, (r, now) => setMonLevel(r, m.id, lv, now))}
      onMove={(to) => {
        const before = run;
        update(run.id, (r, now) => setMonState(r, m.id, to, now));
        if (to === 'party' && partyOf(before).length >= 6) toast('The party is full: move someone to the box first.');
      }}
      onDie={(loc, cause) => {
        update(run.id, (r, now) => markDeath(r, m.id, { loc, cause }, now));
        setDying(undefined);
      }}
      onRevive={() => update(run.id, (r, now) => reviveMon(r, m.id, now))}
      nuzlocke={run.rules.nuzlocke}
    />
  );

  return (
    <div className="space-y-3">
      <Panel
        title={`Party (${party.length}/6)`}
        actions={
          <Button size="sm" onClick={loadIntoBuilder} disabled={party.length === 0}>
            <Download size={14} aria-hidden /> Load party into Builder
          </Button>
        }
        bodyClassName="p-3"
      >
        {problems.length > 0 && (
          <ul className="mb-2 space-y-0.5 text-sm text-warn" aria-label="Species clause">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {party.length === 0 ? <p className="text-sm text-muted">Nobody in the party yet. Log a catch under Encounters.</p> : <ul className="space-y-2" aria-label="Party">{party.map(row)}</ul>}
      </Panel>
      <Panel title={`Box (${box.length})`} bodyClassName="p-3">
        {box.length === 0 ? <p className="text-sm text-muted">The box is empty.</p> : <ul className="space-y-2" aria-label="Box">{box.map(row)}</ul>}
      </Panel>
      {(dead.length > 0 || run.rules.nuzlocke) && (
        <Panel title={`Graveyard (${dead.length})`} bodyClassName="p-3">
          {dead.length === 0 ? <p className="text-sm text-muted">No deaths yet.</p> : <ul className="space-y-2" aria-label="Graveyard">{dead.map(row)}</ul>}
        </Panel>
      )}
    </div>
  );
}

function MonRow({
  mon,
  dex,
  over,
  cap,
  dying,
  places,
  nuzlocke,
  onDying,
  onLevel,
  onMove,
  onDie,
  onRevive,
}: {
  mon: RunMon;
  dex: Dex;
  over: boolean;
  cap?: number;
  dying: boolean;
  places: string[];
  nuzlocke: boolean;
  onDying: (v: boolean) => void;
  onLevel: (n: number) => void;
  onMove: (to: 'party' | 'box') => void;
  onDie: (loc: string | undefined, cause: string) => void;
  onRevive: () => void;
}) {
  const { speciesName, format, locName } = useAtlasCtx();
  const sp = dex.species(mon.species);
  const name = mon.nickname || speciesName(mon.species);
  const [cause, setCause] = useState('');
  const [where, setWhere] = useState('');
  return (
    <li data-state={mon.state} className={cn('rounded-xl border p-2', over ? 'border-bad/60 bg-bad/8' : 'border-border bg-surface')}>
      <div className="flex flex-wrap items-center gap-2">
        <Sprite speciesId={mon.species} name={speciesName(mon.species)} types={sp?.types} set={format.spriteSet} size={40} className={mon.state === 'dead' ? 'grayscale' : undefined} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{name}</span>
          {mon.nickname && <span className="block truncate text-xs text-muted">{speciesName(mon.species)}</span>}
          {mon.state === 'dead' && mon.death && (
            <span className="block text-xs text-muted">
              Died{mon.death.loc ? ` at ${locName(mon.death.loc)}` : ''}
              {mon.death.cause ? `: ${mon.death.cause}` : ''}
            </span>
          )}
        </span>
        {over && cap !== undefined && <Chip tone="bad">Over cap {cap}</Chip>}
        {mon.state !== 'dead' ? (
          <>
            <label className="flex items-center gap-1 text-xs font-semibold text-muted">
              Lv
              <Input type="number" min={1} max={100} value={mon.level} onChange={(e) => onLevel(Number(e.target.value))} aria-label={`Level of ${name}`} className="w-16" />
            </label>
            <Button size="sm" onClick={() => onMove(mon.state === 'party' ? 'box' : 'party')} aria-label={`${mon.state === 'party' ? 'Move to the box' : 'Move to the party'}: ${name}`}>
              {mon.state === 'party' ? 'To box' : 'To party'}
            </Button>
            {nuzlocke && (
              <Button size="sm" variant="ghost" className="hover:text-bad" aria-label={`${name} died`} aria-expanded={dying} onClick={() => onDying(!dying)}>
                <Skull size={14} aria-hidden /> Died
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" variant="ghost" aria-label={`Bring ${name} back`} onClick={onRevive}>
            <RotateCcw size={14} aria-hidden /> Undo
          </Button>
        )}
      </div>
      {dying && (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            onDie(where || undefined, cause);
          }}
        >
          <Select value={where} onChange={(e) => setWhere(e.target.value)} aria-label={`Where ${name} died`}>
            <option value="">Where? (optional)</option>
            {places.map((p) => (
              <option key={p} value={p}>
                {locName(p)}
              </option>
            ))}
          </Select>
          <Input value={cause} maxLength={200} onChange={(e) => setCause(e.target.value)} placeholder="Cause (optional)" aria-label={`Cause of ${name}'s death`} />
          <Button type="submit" variant="danger">
            Confirm
          </Button>
        </form>
      )}
    </li>
  );
}
