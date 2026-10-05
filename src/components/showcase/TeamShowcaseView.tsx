import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useDex } from '@/data/useDex';
import { getFormat } from '@/domain/formats';
import { isSavedTeam } from '@/domain/team';
import { teamChoices } from '@/domain/teamCompare';
import { calcStats } from '@/domain/stats';
import type { FormatRules, Team } from '@/domain/types';
import { useShowcaseStore } from '@/store/showcaseStore';
import { editingTeam, useTeamStore } from '@/store/teamStore';
import { DefenseMatrix } from '../analysis/DefenseMatrix';
import { OffenseMatrix } from '../analysis/OffenseMatrix';
import { Sprite } from '../ui/Sprite';
import { Chip, EmptyState, LoadingState, Panel, Select, Tabs } from '../ui/primitives';
import { cn } from '../ui/styles';
import { SetCard, type CardView } from './SetCard';

type Tab = 'moves' | 'stats' | 'team';

/**
 * Team overview: pick a saved team (or the build in progress) and see everything about it at a
 * glance, like the in-game team showcase: the six sets with stats, Megas and moves on one tab, and the
 * team as a whole (type matrices, speed order) on the other. Read-only; use Edit team to change it.
 * Inside Analyse the team comes from its shared picker (`team`); without one the view has its own.
 */
export function TeamShowcaseView({ team: given }: { team?: Team } = {}) {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const activeId = useTeamStore((s) => s.activeTeamId);
  const editingId = useTeamStore((s) => editingTeam(s)?.id);
  const choices = useMemo(() => teamChoices(teams, order), [teams, order]);
  // Start on the team Saved teams handed over, else the saved team being edited, else the open build.
  const [pickedId, setPicked] = useState(() => {
    const handed = useShowcaseStore.getState().teamId;
    return handed && teams[handed] ? handed : editingId && teams[editingId] ? editingId : teams[activeId] ? activeId : choices[0]?.id ?? '';
  });
  useEffect(() => () => useShowcaseStore.getState().clear(), []);
  const [tab, setTab] = useState<Tab>('moves');
  const [mega, setMega] = useState(false);
  const team = given ?? teams[pickedId] ?? teams[activeId];

  if (!team) return <EmptyState icon={LayoutGrid} title="No team to show">Build or save a team and it appears here.</EmptyState>;

  const labelOf = (id: string, label: string) => (id === activeId && teams[id] && !isSavedTeam(teams[id]) ? 'Current build' : label);
  return (
    <div className="space-y-3">
      <Panel bodyClassName="flex flex-wrap items-center gap-2 p-2 sm:p-3">
        {!given && <label className="min-w-0 flex-1 basis-40">
          <span className="sr-only">Team</span>
          <Select aria-label="Team to show" value={team.id} onChange={(e) => setPicked(e.target.value)} className="w-full">
            {(['mine', 'shared'] as const).map((g) => {
              const list = choices.filter((c) => c.group === g);
              return list.length ? (
                <optgroup key={g} label={g === 'mine' ? 'My teams' : 'Shared with me'}>
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {labelOf(c.id, c.label)}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </Select>
        </label>}
        <Tabs<Tab>
          label="Team overview"
          size="sm"
          tabs={[
            { id: 'moves', label: 'Moves & More' },
            { id: 'stats', label: 'Stats' },
            { id: 'team', label: 'Team' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </Panel>
      <Showcase team={team} tab={tab} mega={mega} onMega={setMega} />
    </div>
  );
}

function Showcase({ team, tab, mega, onMega }: { team: Team; tab: Tab; mega: boolean; onMega: (on: boolean) => void }) {
  const format = getFormat(team.formatId);
  const state = useDex(format.datasetId);
  if (state.status === 'error') return <p className="p-10 text-center text-sm text-bad" role="alert">Couldn’t load the Pokédex data.</p>;
  if (state.status !== 'ready') return <LoadingState label="Loading…" />;
  const dex = state.dex;
  const members = team.slots.flatMap((set, slot) => (set && dex.species(set.speciesId) ? [{ set, slot }] : []));
  if (members.length === 0) {
    return (
      <EmptyState icon={LayoutGrid} title="This team is empty">
        Add Pokémon in the builder, or pick another team.
      </EmptyState>
    );
  }
  return tab === 'team' ? <TeamTab team={team} dex={dex} format={format} members={members} /> : <SetsTab team={team} dex={dex} format={format} members={members} view={tab} mega={mega} onMega={onMega} />;
}

type Members = { set: NonNullable<Team['slots'][number]>; slot: number }[];

function SetsTab({ team, dex, format, members, view, mega, onMega }: { team: Team; dex: Dex; format: FormatRules; members: Members; view: CardView; mega: boolean; onMega: (on: boolean) => void }) {
  const anyMega = format.capabilities.mega && members.some(({ set }) => !!dex.megaFor(set.speciesId, set.itemId));
  return (
    <section aria-label={`${team.name}: ${view === 'stats' ? 'stats' : 'moves and more'}`} className="space-y-2">
      <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted', !anyMega && 'max-sm:hidden')}>
        <b className="text-fg max-sm:hidden">{team.name}{team.variationLabel ? ` · ${team.variationLabel}` : ''}</b>
        <Chip className="max-sm:hidden">{team.category || format.shortName}</Chip>
        {anyMega && (
          <label className="ml-auto flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={mega} onChange={(e) => onMega(e.target.checked)} className="size-4 pointer-coarse:size-5" /> Show Megas
          </label>
        )}
      </div>
      {/* Two to a row, on a phone too: the whole team on one screen, like the in-game team view. */}
      <ul className="mx-auto grid max-w-5xl grid-cols-2 gap-2 sm:gap-3">
        {members.map(({ set, slot }) => (
          <li key={slot} className="min-w-0">
            <SetCard dex={dex} format={format} set={set} view={view} mega={mega} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function TeamTab({ team, dex, format, members }: { team: Team; dex: Dex; format: FormatRules; members: Members }) {
  // Final Speed of each member (a Mega's too), fastest first.
  const speeds = useMemo(() => {
    const out = members.flatMap(({ set }) => {
      const sp = dex.species(set.speciesId);
      if (!sp) return [];
      const nature = dex.nature(set.nature);
      const mega = format.capabilities.mega ? dex.megaFor(set.speciesId, set.itemId) : undefined;
      const rows = [{ id: sp.id, name: sp.name, types: sp.types, speed: calcStats(sp.baseStats, set, format, nature).spe, mega: false }];
      if (mega) rows.push({ id: mega.id, name: mega.name, types: mega.types, speed: calcStats(mega.baseStats, set, format, nature).spe, mega: true });
      return rows;
    });
    return out.sort((a, b) => b.speed - a.speed || a.name.localeCompare(b.name));
  }, [members, dex, format]);
  const top = speeds[0]?.speed ?? 1;

  return (
    <section aria-label={`${team.name}: team`} className="space-y-3">
      <Panel title="Speed order">
        <ol className="space-y-1" aria-label="Speed, fastest first">
          {speeds.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <Sprite speciesId={r.id} name={r.name} types={r.types} set={format.spriteSet} size={28} />
              <span className="w-36 shrink-0 truncate font-medium">{r.name}</span>
              <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, (r.speed / top) * 100)}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right font-mono tabular-nums">{r.speed}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted">Final Speed with each Pokémon’s spread and nature, before any boosts. Megas are listed as their own rows.</p>
      </Panel>
      <div className="grid gap-3 lg:grid-cols-2">
        <DefenseMatrix team={team} dex={dex} format={format} />
        <OffenseMatrix team={team} dex={dex} mega={format.capabilities.mega} />
      </div>
    </section>
  );
}
