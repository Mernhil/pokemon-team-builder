import { CalendarClock, RadioTower } from 'lucide-react';
import { REGULATION_MANIFEST, currentRegulation, formatForRegulation, regulationInfo } from '@/domain/formats';
import type { FormatRules, Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { formatMechanics, gameInfo } from '@/domain/games';
import { GEN_GAMES, genInfo } from '@/domain/generations';
import { GenBadge } from '../ui/GenBadge';
import { Button } from '../ui/primitives';

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs">
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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs">
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

function ChampionsBanner({ team, format }: { team: Team; format: FormatRules }) {
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
