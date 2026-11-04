import { useMemo, useState } from 'react';
import { Check, Crosshair, Shield } from 'lucide-react';
import { monToSet, trainerToTeam, trainerVariants, type AtlasMon } from '@/domain/atlas';
import { defaultSide } from '@/domain/battle/conditions';
import { bestMatchups, partyOf, partyToTeam, toggleBeaten, type Milestone, type Run } from '@/domain/runs';
import { useCalcStore } from '@/store/calcStore';
import { useRunStore } from '@/store/runStore';
import { useTeamStore } from '@/store/teamStore';
import { Sprite } from '../ui/Sprite';
import { Button, Checkbox, Chip, Panel, Select, TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useAtlasCtx } from '../atlas/context';

/** The next boss: their team, how your party's types fare against it, and Calc / Load into Builder. Below, every milestone to tick off. */
export function RunBoss({ run, milestones, next }: { run: Run; milestones: Milestone[]; next?: Milestone }) {
  const { file, dex, format, speciesName, openTrainer, locName } = useAtlasCtx();
  const toggle = (id: string) => useRunStore.getState().update(run.id, (r, now) => toggleBeaten(r, id, now));
  const trainer = useMemo(() => (next?.group ? trainerVariants(file, next.group)[0] : undefined), [file, next]);
  const bossTeam = useMemo(() => (trainer ? trainerToTeam(trainer, dex, format) : undefined), [trainer, dex, format]);
  const party = partyOf(run);
  const [attackerId, setAttackerId] = useState(party[0]?.id ?? '');
  const attacker = party.find((m) => m.id === attackerId) ?? party[0];

  const typesOf = (id: string) => dex.species(id)?.types ?? [];
  const eff = (atk: string, def: string[]) => dex.effectiveness(atk as never, def as never);
  const matchups = useMemo(() => {
    if (!trainer) return undefined;
    const mine = party.map((m) => ({ name: m.nickname || speciesName(m.species), types: typesOf(m.species) }));
    const theirs = trainer.party.map((m) => ({ name: speciesName(m.species), types: typesOf(m.species) }));
    // Their attacks are their real moves; mine are my Pokémon's own types (their moves aren't tracked here).
    const theirAttacks = trainer.party.map((m) => ({
      name: speciesName(m.species),
      types: [...new Set(m.moves.map((mv) => dex.move(mv)).filter((mv) => mv && mv.category !== 'Status').map((mv) => mv!.type))],
    }));
    return { mine: bestMatchups(mine, theirs, eff), theirs: bestMatchups(theirAttacks, mine, eff) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trainer, party, dex]);

  /** The calculator follows the active team's format, so the party becomes the active team in the game's format first. */
  const calc = (side: 'attacker' | 'defender', mon: AtlasMon, index: number) => {
    if (!trainer || !attacker) return;
    const store = useTeamStore.getState();
    const team = partyToTeam(run, dex, format);
    const existing = Object.values(store.teams).find((t) => !t.shared && t.name === team.name && t.formatId === team.formatId);
    if (existing) {
      store.restoreSlots(existing.id, team.slots);
      store.selectTeam(existing.id);
    } else store.addTeams([team], true);
    const slot = team.slots.findIndex((s) => s?.nickname === attacker.nickname && s?.speciesId === attacker.species);
    const mine = (existing ? useTeamStore.getState().teams[existing.id].slots : team.slots)[Math.max(0, slot)];
    if (!mine) return;
    const theirs = monToSet(mon, dex, format, `atlas:${trainer.id}:${index}`);
    const calcStore = useCalcStore.getState();
    const bySide = { attacker: side === 'attacker' ? mine : theirs, defender: side === 'attacker' ? theirs : mine };
    calcStore.setSide('attacker', { set: bySide.attacker, cond: defaultSide(), crits: [false, false, false, false] });
    calcStore.setSide('defender', { set: bySide.defender, cond: defaultSide(), crits: [false, false, false, false] });
    store.setView('calc');
  };

  const loadParty = () => {
    const store = useTeamStore.getState();
    store.addTeams([partyToTeam(run, dex, format)], true);
    store.setView('builder');
  };

  return (
    <div className="space-y-3">
      {next && trainer && bossTeam ? (
        <Panel
          title={`${next.kind === 'gym' ? 'Gym' : next.kind === 'champion' ? 'Champion' : 'Elite Four'}: ${next.name}`}
          actions={
            <Button size="sm" variant="primary" onClick={() => toggle(next.id)} aria-label={`Mark ${next.name} as beaten`}>
              <Check size={14} aria-hidden /> Mark beaten
            </Button>
          }
          bodyClassName="space-y-3 p-3"
        >
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <Chip tone="accent">Level cap {next.level}</Chip>
            {next.loc && <span className="text-muted">{locName(next.loc)}</span>}
            {next.badge && <span className="text-muted">· {next.badge.replace(/ Badge$/, '')} Badge</span>}
            <button type="button" className="ml-auto text-sm font-semibold text-accent hover:underline" onClick={() => openTrainer(trainer.group)}>
              Full team and details
            </button>
          </p>

          {party.length > 0 && (
            <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
              Calculate with
              <Select aria-label="Calculate with" value={attacker?.id} onChange={(e) => setAttackerId(e.target.value)}>
                {party.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nickname || speciesName(m.species)} (Lv {m.level})
                  </option>
                ))}
              </Select>
            </label>
          )}

          <ol className="space-y-1.5" aria-label={`${next.name}'s team`}>
            {trainer.party.map((m, i) => {
              const sp = dex.species(m.species);
              const mine = matchups?.mine[i];
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
                  <Sprite speciesId={m.species} name={speciesName(m.species)} types={sp?.types} set={format.spriteSet} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {speciesName(m.species)} <span className="font-mono text-xs font-normal text-muted">Lv {m.level}</span>
                    </span>
                    <span className="flex flex-wrap gap-1">{sp?.types.map((t) => <TypeBadge key={t} type={t} size="xs" />)}</span>
                    {mine?.best && party.length > 0 && (
                      <span className={cn('mt-0.5 block text-xs', mine.best.mult >= 2 ? 'font-semibold text-good' : mine.best.mult < 1 ? 'text-bad' : 'text-muted')}>
                        Your best: {mine.best.attacker}, {mine.best.type} ×{mine.best.mult}
                      </span>
                    )}
                  </span>
                  {attacker && (
                    <span className="flex gap-1">
                      <Button size="sm" onClick={() => calc('attacker', m, i)} aria-label={`Calc: ${attacker.nickname || speciesName(attacker.species)} attacks ${speciesName(m.species)}`}>
                        <Crosshair size={13} aria-hidden /> I attack
                      </Button>
                      <Button size="sm" onClick={() => calc('defender', m, i)} aria-label={`Calc: ${speciesName(m.species)} attacks ${attacker.nickname || speciesName(attacker.species)}`}>
                        <Shield size={13} aria-hidden /> They attack
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          {party.length > 0 && matchups && (
            <div>
              <h3 className="mb-1 text-sm font-semibold">Their best against your party</h3>
              <ul className="space-y-0.5 text-sm" aria-label="Their best type against each of your Pokémon">
                {matchups.theirs.map((r) => (
                  <li key={r.defender} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">{r.defender}</span>
                    <span className={cn('shrink-0 text-xs', r.best && r.best.mult >= 2 ? 'font-semibold text-bad' : 'text-muted')}>{r.best ? `${r.best.attacker}: ${r.best.type} ×${r.best.mult}` : '—'}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted">Type matchups only: their real moves against your Pokémon's types, and your Pokémon's own types against theirs. The calculator has the damage.</p>
            </div>
          )}
          <Button size="sm" onClick={loadParty} disabled={party.length === 0}>
            Load party into Builder
          </Button>
        </Panel>
      ) : next ? (
        <Panel title={next.label} bodyClassName="p-3">
          <p className="text-sm text-muted">Level cap {next.level}. The Pokénav has no team for this one.</p>
          <Button size="sm" className="mt-2" onClick={() => toggle(next.id)}>
            Mark beaten
          </Button>
        </Panel>
      ) : (
        <Panel title="All done" bodyClassName="p-3">
          <p className="text-sm text-muted">Every Gym leader, the Elite Four and the Champion are beaten.</p>
        </Panel>
      )}

      <Panel title="Gym leaders, Elite Four, Champion" bodyClassName="p-3">
        <ol className="space-y-1" aria-label="Milestones in order">
          {milestones.map((m) => {
            const done = run.beaten.includes(m.id);
            return (
              <li key={m.id}>
                <label className={cn('flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11', next?.id === m.id && 'font-semibold')}>
                  <Checkbox checked={done} onChange={() => toggle(m.id)} aria-label={`${m.label} beaten`} />
                  <span className={cn('min-w-0 flex-1 truncate', done && 'text-muted line-through')}>
                    {m.label}
                    {m.region && <span className="text-muted"> · {m.region}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-muted">cap {m.level}</span>
                </label>
              </li>
            );
          })}
        </ol>
      </Panel>
    </div>
  );
}
