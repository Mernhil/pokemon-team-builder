/**
 * The tournament teams (generated/tournament-teams.json), validated. Never import this statically:
 * it's loaded on first use through `useTournamentTeams` (./useTournamentTeams.ts).
 */
import json from './generated/tournament-teams.json';
import { EMPTY_TOURNAMENT_TEAMS, parseTournamentTeams, type TournamentTeamsFile } from '@/domain/tournamentTeams';

function load(): TournamentTeamsFile {
  try {
    return parseTournamentTeams(json);
  } catch (e) {
    console.error(`Ignoring generated/tournament-teams.json: ${(e as Error).message}`);
    return EMPTY_TOURNAMENT_TEAMS;
  }
}

export const BAKED_TOURNAMENT_TEAMS = load();
