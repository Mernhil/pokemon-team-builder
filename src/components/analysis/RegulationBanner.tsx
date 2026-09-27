import { CalendarClock, RadioTower } from 'lucide-react';
import { REGULATION_MANIFEST, currentRegulation, formatForRegulation, regulationInfo } from '@/domain/formats';
import type { FormatRules, Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { Button } from '../ui/primitives';

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/**
 * Regulation status strip: which set is live, when it ends, what's announced next, and when the
 * data was last checked by the weekly updater. Offers a one-click move to the live regulation.
 */
export function RegulationBanner({ team, format }: { team: Team; format: FormatRules }) {
  const updateTeam = useTeamStore((s) => s.updateTeam);
  const live = currentRegulation();
  const teamReg = regulationInfo(format.regulationId);
  const next = REGULATION_MANIFEST.upcoming[0];
  const liveFormat = formatForRegulation(live?.id);
  const outdated = !!live && !!teamReg && teamReg.id !== live.id;

  if (!live) return null;
  const daysLeft = live.end ? Math.ceil((new Date(live.end).getTime() - Date.now()) / 86_400_000) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs">
      <span className="flex items-center gap-1.5">
        <RadioTower size={14} className="text-good" />
        <b className="text-fg">{live.shortName} is live</b>
        <span className="text-muted">
          {fmtDate(live.start)} – {fmtDate(live.end)}
          {daysLeft !== undefined && daysLeft >= 0 && ` · ${daysLeft} days left`}
        </span>
      </span>
      <span className="text-muted">
        {live.speciesCount} Pokémon · {live.megaCount} Megas · {live.itemCount} items
      </span>
      {next ? (
        <span className="flex items-center gap-1.5">
          <CalendarClock size={14} className="text-accent" />
          <b>Next: {next.name}</b>
          <span className="text-muted">from {fmtDate(next.start)}</span>
        </span>
      ) : (
        <span className="text-muted">Next regulation not announced yet</span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {REGULATION_MANIFEST.lastChecked && <span className="text-muted">Checked {fmtDate(REGULATION_MANIFEST.lastChecked)}</span>}
        {outdated && liveFormat && (
          <Button size="sm" variant="primary" onClick={() => updateTeam(team.id, { formatId: liveFormat.id, category: liveFormat.shortName })}>
            Move team to {live.shortName}
          </Button>
        )}
      </span>
    </div>
  );
}
