import { useMemo, useState } from 'react';
import { CalendarClock, Copy, RadioTower } from 'lucide-react';
import { create } from 'zustand';
import { useRegulationChanges } from '@/data/regulationChanges';
import { useDex } from '@/data/useDex';
import { copyTeamToRegulation, daysUntil, teamImpact } from '@/domain/regulationImpact';
import { toast } from '@/store/toastStore';
import { REGULATION_MANIFEST, currentRegulation, formatForRegulation, regulationInfo } from '@/domain/formats';
import type { FormatRules, Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { formatMechanics, gameInfo } from '@/domain/games';
import { GEN_GAMES, genInfo } from '@/domain/generations';
import { GenBadge } from '../ui/GenBadge';
import { Button } from '../ui/primitives';
import { ImpactList, impactSummary } from './ImpactList';

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * Regulation status strip: which set is live, when it ends, what's announced next, and when the
 * data was last checked by the weekly updater. Offers a one-click move to the live regulation.
 */
export function RegulationBanner({ team, format }: { team: Team; format: FormatRules }) {
  if (format.datasetId !== 'champions') return <GenerationStrip format={format} />;
  return <ChampionsBanner team={team} format={format} />;
}

/** Main-series formats: which games the data follows and what that generation had. */
function GenerationStrip({ format }: { format: FormatRules }) {
  const g = genInfo(format.generation);
  const m = formatMechanics(format);
  const game = gameInfo(format.game);
  if (game)
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs sm:px-4 sm:py-2.5">
        <span className="flex items-center gap-1.5">
          <GenBadge gen={g.gen} />
          <b className="text-fg">{game.name}</b>
          <span className="text-muted">· {game.region}</span>
        </span>
        <span className="text-muted">
          {game.summary}
          {!game.battleSim && ' · the damage calculator can’t model these battles'}
        </span>
      </div>
    );
  const missing = [!m.abilities && 'abilities', !m.natures && 'natures', !m.heldItems && 'held items', !m.splitSpecial && 'a split Special stat'].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs sm:px-4 sm:py-2.5">
      <span className="flex items-center gap-1.5">
        <GenBadge gen={g.gen} />
        <b className="text-fg">{g.region}</b>
        <span className="text-muted">· {GEN_GAMES[g.gen]}</span>
      </span>
      <span className="text-muted">
        Movepools, move power/accuracy/type and effects as in these games
        {m.moveCategorySplit ? '' : ' · physical/special by type'}
        {missing.length ? ` · no ${missing.join(', ')}` : ''}
      </span>
    </div>
  );
}

/** The "what to fix" list of the last "Copy to <regulation>", kept until dismissed. Not persisted. */
const useChecklist = create<{ teamId?: string; regulation?: string; items: string[]; set: (teamId: string, regulation: string, items: string[]) => void; clear: () => void }>()((set) => ({
  items: [],
  set: (teamId, regulation, items) => set({ teamId, regulation, items }),
  clear: () => set({ teamId: undefined, regulation: undefined, items: [] }),
}));

function ChampionsBanner({ team, format }: { team: Team; format: FormatRules }) {
  const switchFormat = useTeamStore((s) => s.switchFormat);
  const live = currentRegulation();
  const teamReg = regulationInfo(format.regulationId);
  const next = REGULATION_MANIFEST.upcoming[0];
  const liveFormat = formatForRegulation(live?.id);
  const outdated = !!live && !!teamReg && teamReg.id !== live.id;

  const dexState = useDex('champions');
  const changes = useRegulationChanges();
  const [showImpact, setShowImpact] = useState(false);
  const checklist = useChecklist();
  const addTeams = useTeamStore((st) => st.addTeams);
  const impact = useMemo(
    () => (outdated && live && dexState.status === 'ready' ? teamImpact(team, live.id, dexState.dex, changes) : undefined),
    [outdated, live, dexState, team, changes],
  );

  if (!live) return null;
  const daysLeft = live.end ? Math.ceil((new Date(live.end).getTime() - Date.now()) / 86_400_000) : undefined;

  const copyToLive = () => {
    if (dexState.status !== 'ready') return;
    const r = copyTeamToRegulation(team, live.id, dexState.dex, changes);
    if (!r) return;
    addTeams([r.team], true);
    // The builder opens a draft copy of the new variation: the checklist follows what's open.
    useChecklist.getState().set(r.team.id, live.shortName, r.checklist);
    useChecklist.getState().set(useTeamStore.getState().activeTeamId, live.shortName, r.checklist);
    toast(`Copied “${team.name}” to ${live.shortName} as a variation. The original is unchanged.`);
  };

  return (
    <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs sm:px-4 sm:py-2.5">
      <span className="flex items-center gap-1.5">
        <RadioTower size={14} className="text-good" />
        <b className="text-fg">{live.shortName} is live</b>
        <span className="text-muted">
          {fmtDate(live.start)} – {fmtDate(live.end)}
          {daysLeft !== undefined && daysLeft >= 0 && ` · ${daysLeft} days left`}
        </span>
      </span>
      <span className="hidden text-muted sm:inline">
        {live.speciesCount} Pokémon · {live.megaCount} Megas · {live.itemCount} items
      </span>
      {next ? (
        <span className="hidden items-center gap-1.5 sm:flex">
          <CalendarClock size={14} className="text-accent" />
          <b>Next: {next.name}</b>
          <span className="text-muted">
            from {fmtDate(next.start)} · {daysUntil(next.start) > 0 ? `in ${daysUntil(next.start)} days` : 'starts today'}
          </span>
        </span>
      ) : (
        <span className="hidden text-muted sm:inline">Next regulation not announced yet</span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {REGULATION_MANIFEST.lastChecked && <span className="hidden text-muted sm:inline">Checked {fmtDate(REGULATION_MANIFEST.lastChecked)}</span>}
        <a href="#regdiff" className="font-semibold text-accent underline-offset-2 hover:underline pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
          Regulation diff
        </a>
        {outdated && liveFormat && (
          <>
            {impact && (
              <Button size="sm" variant="ghost" aria-expanded={showImpact} onClick={() => setShowImpact((v) => !v)}>
                {impact.counts.breaks > 0 ? `${impact.counts.breaks} ${impact.counts.breaks === 1 ? 'problem' : 'problems'} in ${live.shortName}` : `What changes in ${live.shortName}`}
              </Button>
            )}
            <Button size="sm" onClick={copyToLive} title="Makes a variation in the live regulation with what isn't legal there removed; this team stays as it is">
              <Copy size={13} aria-hidden /> Copy to {live.shortName}
            </Button>
            <Button size="sm" onClick={() => switchFormat(team.id, liveFormat.id)}>
              Move team to {live.shortName}
            </Button>
          </>
        )}
      </span>
    </div>
    {outdated && impact && showImpact && dexState.status === 'ready' && (
      <div className="rounded-xl border border-border bg-surface p-3 sm:p-4" role="region" aria-label={`What ${live.shortName} does to this team`}>
        <p className="mb-2 text-sm font-semibold">
          Moving to {live.shortName}: {impactSummary(impact.counts)}
        </p>
        <ImpactList impact={impact} dex={dexState.dex} format={liveFormat ?? format} />
        <p className="mt-2 text-xs text-muted">
          “Move team” switches this team to {live.shortName} as it is; “Copy to {live.shortName}” keeps this team and adds a variation with the illegal parts removed.
        </p>
      </div>
    )}
    {checklist.teamId === team.id && checklist.items.length > 0 && (
      <div className="rounded-xl border border-warn/40 bg-warn/8 p-3 text-sm sm:p-4" role="region" aria-label={`To fix for ${checklist.regulation}`}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="font-semibold">To fix for {checklist.regulation}</p>
          <Button size="sm" variant="ghost" onClick={checklist.clear}>
            Dismiss
          </Button>
        </div>
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          {checklist.items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
    )}
    </div>
  );
}
