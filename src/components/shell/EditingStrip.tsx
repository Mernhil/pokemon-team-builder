import { useMemo, type ReactNode } from 'react';
import { ChevronDown, FolderOpen, Plus } from 'lucide-react';
import { isHiddenDraft } from '@/domain/team';
import type { Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import type { DraftState } from './draftState';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../ui/Menu';
import { controlClass, cn } from '../ui/styles';

const RECENT = 5;

/**
 * Which team the builder is on, and whether it differs from the saved one: the team switcher (the last few teams, Saved
 * teams, New team) with the state next to it. `children` is the format picker, which shares the row.
 */
export function EditingStrip({ team, state, onOpenTeams, children }: { team: Team; state: DraftState; onOpenTeams: () => void; children: ReactNode }) {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const { editTeam, newTeam } = useTeamStore.getState();

  const recent = useMemo(
    () =>
      order
        .map((id) => teams[id])
        .filter((t): t is Team => !!t && !t.groupId && !t.shared && !isHiddenDraft(t, activeTeamId))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, RECENT),
    [teams, order, activeTeamId],
  );

  const saved = state.kind === 'clean' || state.kind === 'dirty' ? state.saved : undefined;
  const name = saved ? `${saved.name}${saved.variationLabel ? ` · ${saved.variationLabel}` : ''}` : state.kind === 'view' ? team.name : 'New team';
  const rootId = saved ? (saved.groupId ?? saved.id) : undefined;
  const status =
    state.kind === 'dirty' ? 'Unsaved changes' : state.kind === 'new' ? (state.empty ? '' : 'Not saved') : state.kind === 'view' ? 'View only' : '';

  return (
    <div className="order-last flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 xl:order-none xl:w-auto xl:flex-1">
      <Menu
        label="Switch team"
        align="start"
        trigger={
          <button type="button" className={controlClass(false, 'flex min-w-0 max-w-full items-center gap-2 px-2.5 text-left font-semibold sm:max-w-[20rem]')}>
            <span className="truncate">{name}</span>
            {status && (
              <span className={cn('flex shrink-0 items-center gap-1 text-xs font-medium', state.kind === 'dirty' ? 'text-warn' : 'text-muted')}>
                {state.kind === 'dirty' && <span aria-hidden className="size-2 rounded-full bg-warn" />}
                {status}
              </span>
            )}
            <ChevronDown size={14} className="shrink-0 text-muted" aria-hidden />
          </button>
        }
      >
        {recent.length > 0 && <MenuLabel>Recent teams</MenuLabel>}
        {recent.map((t) => (
          <MenuItem key={t.id} current={t.id === rootId} onSelect={() => editTeam(t.id)}>
            {t.name}
          </MenuItem>
        ))}
        {recent.length > 0 && <MenuSeparator />}
        <MenuItem icon={FolderOpen} onSelect={onOpenTeams}>
          Saved teams…
        </MenuItem>
        <MenuItem icon={Plus} onSelect={() => newTeam(team.formatId)}>
          New team
        </MenuItem>
      </Menu>
      {/* Said once when the state changes, not on every edit. */}
      <span role="status" className="sr-only">
        {state.kind === 'dirty' ? 'Unsaved changes' : ''}
      </span>
      {children}
    </div>
  );
}
