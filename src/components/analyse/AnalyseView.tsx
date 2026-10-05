import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { useDex } from '@/data/useDex';
import { getFormat } from '@/domain/formats';
import { ANALYSE_TABS, type AnalyseTab } from '@/domain/routes';
import { isSavedTeam } from '@/domain/team';
import { teamChoices } from '@/domain/teamCompare';
import type { Team } from '@/domain/types';
import { useShowcaseStore } from '@/store/showcaseStore';
import { useTeamStore } from '@/store/teamStore';
import { EmptyState, LoadingState, Panel, Select, Tabs } from '../ui/primitives';

// Each tab loads when first opened.
const TeamShowcaseView = lazy(() => import('../showcase/TeamShowcaseView').then((m) => ({ default: m.TeamShowcaseView })));
const SpeedTiersView = lazy(() => import('../speed/SpeedTiersView').then((m) => ({ default: m.SpeedTiersView })));
const ThreatReportView = lazy(() => import('../threats/ThreatReportView').then((m) => ({ default: m.ThreatReportView })));
const OhkoReportView = lazy(() => import('../threats/OhkoReportView').then((m) => ({ default: m.OhkoReportView })));
const CompareView = lazy(() => import('../compare/CompareView').then((m) => ({ default: m.CompareView })));

const TAB_LABELS: Record<AnalyseTab, string> = { overview: 'Overview', speed: 'Speed', threats: 'Threats', ohko: 'OHKO', compare: 'Compare' };

/**
 * Analyse: everything that looks at a team, behind one team picker — the Overview, its Speed order,
 * the Threat report, the OHKO lists and a Compare with a second team. The picker starts on the build
 * you have open; any saved or shared team works, without opening it in the builder.
 */
export function AnalyseView() {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const activeId = useTeamStore((s) => s.activeTeamId);
  const tab = useTeamStore((s) => s.analyseTab);
  const openAnalyse = useTeamStore((s) => s.openAnalyse);
  const choices = useMemo(() => teamChoices(teams, order), [teams, order]);
  // Start on the team Saved teams handed over (its Overview button), else the build in progress.
  const [pickedId, setPicked] = useState(() => {
    const handed = useShowcaseStore.getState().teamId;
    return handed && teams[handed] ? handed : teams[activeId] ? activeId : choices[0]?.id ?? '';
  });
  useEffect(() => () => useShowcaseStore.getState().clear(), []);
  const team = teams[pickedId] ?? teams[activeId];

  if (!team) return <EmptyState icon={Activity} title="No team to analyse">Build or save a team and it appears here.</EmptyState>;

  const labelOf = (id: string, label: string) => (id === activeId && teams[id] && !isSavedTeam(teams[id]) ? 'Current build' : label);
  return (
    <div className="space-y-3">
      <Panel bodyClassName="flex flex-wrap items-center gap-2 p-2 sm:p-3">
        <label className="min-w-0 flex-1 basis-48">
          <span className="sr-only">Team to analyse</span>
          <Select aria-label="Team to analyse" value={team.id} onChange={(e) => setPicked(e.target.value)} className="w-full">
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
        </label>
        <Tabs<AnalyseTab>
          label="Analyse"
          size="sm"
          tabs={ANALYSE_TABS.map((id) => ({ id, label: TAB_LABELS[id] }))}
          value={tab}
          onChange={(id) => openAnalyse(id)}
        />
      </Panel>
      <TabBody team={team} tab={tab} />
    </div>
  );
}

function TabBody({ team, tab }: { team: Team; tab: AnalyseTab }) {
  const ohkoMode = useTeamStore((s) => s.ohkoMode);
  const openAnalyse = useTeamStore((s) => s.openAnalyse);
  const format = getFormat(team.formatId);
  const state = useDex(format.datasetId);
  const loading = (label: string) => <LoadingState label={label} />;

  if (tab === 'overview') return <Suspense fallback={loading('Loading team overview…')}><TeamShowcaseView team={team} /></Suspense>;
  if (tab === 'compare') return <Suspense fallback={loading('Loading compare…')}><CompareView teamId={team.id} /></Suspense>;
  if (state.status === 'error') return <p className="p-10 text-center text-sm text-bad" role="alert">{state.error}</p>;
  if (state.status !== 'ready') return loading('Loading Pokédex data…');
  const dex = state.dex;
  if (tab === 'speed') return <Suspense fallback={loading('Loading speed tiers…')}><SpeedTiersView dex={dex} format={format} team={team} /></Suspense>;
  if (tab === 'threats') return <Suspense fallback={loading('Loading threat report…')}><ThreatReportView dex={dex} format={format} team={team} /></Suspense>;
  return (
    <Suspense fallback={loading('Loading OHKO report…')}>
      <OhkoReportView dex={dex} format={format} team={team} mode={ohkoMode} onMode={(m) => openAnalyse('ohko', m)} />
    </Suspense>
  );
}
