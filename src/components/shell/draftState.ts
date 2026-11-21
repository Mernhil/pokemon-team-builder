import { useMemo } from 'react';
import { isDirty } from '@/domain/team';
import type { Team } from '@/domain/types';
import { editingTeam, isLocked, useTeamStore } from '@/store/teamStore';

/** What the open draft is, for the header: a new team, a saved team being edited (clean or changed), or someone else's view-only team. */
export type DraftState =
  | { kind: 'new'; empty: boolean }
  | { kind: 'clean' | 'dirty'; saved: Team }
  | { kind: 'view' };

export function useDraftState(team: Team): DraftState {
  const saved = useTeamStore(editingTeam);
  return useMemo((): DraftState => {
    if (isLocked(team)) return { kind: 'view' };
    if (!saved) return { kind: 'new', empty: team.slots.every((s) => s === null) };
    return { kind: isDirty(team, saved) ? 'dirty' : 'clean', saved };
  }, [team, saved]);
}
