import { useMemo, useState } from 'react';
import { useDex } from '@/data/useDex';
import { teamVsTeam, type MatchupRow } from '@/domain/coverage';
import { getFormat } from '@/domain/formats';
import { useMatchStore } from '@/store/matchStore';
import { useTeamStore } from '@/store/teamStore';
import { Button, Panel, TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';
import { sourcesFromTeam } from '@/domain/bringPlanner';
import { BringPlanner } from './BringPlanner';
import { TeamBuilderPanel } from './TeamBuilderPanel';

/**
 * Dual team builder for match prep: a full Builder-parity editor for "Your Team" and one for the
 * "Enemy Team" you're scouting, side by side, plus a head-to-head coverage readout between them.
 * The two team ids persist in matchStore so this tab remembers what you were building.
 */
export function MatchupBuilder({ defaultFormatId }: { defaultFormatId: string }) {
  const scoutYourTeamId = useMatchStore((s) => s.scoutYourTeamId);
  const scoutEnemyTeamId = useMatchStore((s) => s.scoutEnemyTeamId);
  const { setScoutYourTeam, setScoutEnemyTeam } = useMatchStore.getState();
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const teams = useTeamStore((s) => s.teams);

  // Default "Your Team" to whichever team is active in the Builder tab, the first time this is opened.
  const yourTeamId = scoutYourTeamId && teams[scoutYourTeamId] ? scoutYourTeamId : activeTeamId;
  const enemyTeamId = scoutEnemyTeamId && teams[scoutEnemyTeamId] ? scoutEnemyTeamId : undefined;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-2">
        <TeamBuilderPanel title="Your Team" teamId={yourTeamId} onTeamIdChange={setScoutYourTeam} newTeamFormatId={defaultFormatId} excludeTeamId={enemyTeamId} />
        <TeamBuilderPanel title="Enemy Team" teamId={enemyTeamId} onTeamIdChange={setScoutEnemyTeam} newTeamFormatId={defaultFormatId} excludeTeamId={yourTeamId} />
      </div>
      {yourTeamId && enemyTeamId && <Matchup yourTeamId={yourTeamId} enemyTeamId={enemyTeamId} />}
      {yourTeamId && enemyTeamId && <PlanVsTeam yourTeamId={yourTeamId} enemyTeamId={enemyTeamId} />}
    </div>
  );
}

/** "Plan vs this team": which four to bring and lead, with the enemy team's sets as they are built. */
function PlanVsTeam({ yourTeamId, enemyTeamId }: { yourTeamId: string; enemyTeamId: string }) {
  const yourTeam = useTeamStore((s) => s.teams[yourTeamId]);
  const enemyTeam = useTeamStore((s) => s.teams[enemyTeamId]);
  const format = getFormat(yourTeam.formatId);
  const dexState = useDex(format.datasetId);
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="primary" className="w-full sm:w-auto" onClick={() => setOpen(true)} disabled={dexState.status !== 'ready'}>
        Plan vs this team
      </Button>
    );
  if (dexState.status !== 'ready') return null;
  return <BringPlanner key={`${yourTeamId}:${enemyTeamId}`} dex={dexState.dex} format={format} team={yourTeam} initialOpponent={sourcesFromTeam(enemyTeam)} />;
}

function Matchup({ yourTeamId, enemyTeamId }: { yourTeamId: string; enemyTeamId: string }) {
  const yourTeam = useTeamStore((s) => s.teams[yourTeamId]);
  const enemyTeam = useTeamStore((s) => s.teams[enemyTeamId]);
  const yourFormat = getFormat(yourTeam.formatId);
  const enemyFormat = getFormat(enemyTeam.formatId);
  const yourDex = useDex(yourFormat.datasetId);
  const enemyDex = useDex(enemyFormat.datasetId);

  const yourOffense = useMemo(
    () => (yourDex.status === 'ready' ? teamVsTeam(yourTeam, enemyTeam, yourDex.dex) : []),
    [yourDex, yourTeam, enemyTeam],
  );
  const enemyOffense = useMemo(
    () => (enemyDex.status === 'ready' ? teamVsTeam(enemyTeam, yourTeam, enemyDex.dex) : []),
    [enemyDex, enemyTeam, yourTeam],
  );

  if (!yourOffense.length && !enemyOffense.length) return null;
  return (
    <Panel title="Matchup">
      <div className="grid gap-4 lg:grid-cols-2">
        <MatchupTable title="Their Pokémon, your best hit on each" rows={yourOffense} />
        <MatchupTable title="Your Pokémon, their best hit on each" rows={enemyOffense} />
      </div>
    </Panel>
  );
}

function MatchupTable({ title, rows }: { title: string; rows: MatchupRow[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">{title}</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.defender} className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium">{r.defender}</span>
            <span className="flex gap-0.5">
              {r.types.map((t) => (
                <TypeBadge key={t} type={t} size="xs" />
              ))}
            </span>
            {r.best ? (
              <span
                className={cn(
                  'shrink-0 font-mono font-semibold tabular-nums',
                  r.best.mult > 1 ? 'text-bad' : r.best.mult === 0 ? 'text-muted' : r.best.mult < 1 ? 'text-good' : 'text-fg',
                )}
                title={`${r.best.attacker} · ${r.best.move}`}
              >
                ×{r.best.mult}
              </span>
            ) : (
              <span className="shrink-0 text-muted">no damaging moves</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
