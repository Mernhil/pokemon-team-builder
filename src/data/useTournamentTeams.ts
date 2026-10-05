import { useEffect, useState } from 'react';
import type { TournamentRegulation } from '@/domain/tournamentTeams';

let cache: Promise<typeof import('./tournamentTeamsData')> | undefined;

/** A regulation's tournament teams (undefined while loading; empty lists when there are none). */
export function useTournamentTeams(regulationId: string | undefined): TournamentRegulation | undefined {
  const [state, setState] = useState<{ id?: string; data: TournamentRegulation }>();
  useEffect(() => {
    let live = true;
    cache ??= import('./tournamentTeamsData');
    cache.then(
      (m) => live && setState({ id: regulationId, data: (regulationId && m.BAKED_TOURNAMENT_TEAMS.regulations[regulationId]) || { events: [], teams: [] } }),
      () => {
        cache = undefined;
        if (live) setState({ id: regulationId, data: { events: [], teams: [] } });
      },
    );
    return () => {
      live = false;
    };
  }, [regulationId]);
  return state && state.id === regulationId ? state.data : undefined;
}
