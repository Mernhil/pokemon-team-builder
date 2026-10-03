import { Copy, Users } from 'lucide-react';
import { nameOf } from '@/domain/sharing';
import type { Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { useShareStore } from '@/sync/shareStore';
import { Button, Notice } from '../ui/primitives';

/** Shown above a team someone else shared: whose it is, what I may do, and "Make my own copy". */
export function SharedTeamBanner({ team }: { team: Team }) {
  const names = useShareStore((s) => s.names);
  if (!team.shared) return null;
  const who = nameOf(team.shared.owner, names);
  const editable = team.shared.role === 'edit';
  return (
    <Notice tone="accent" icon={Users} title={editable ? `Shared by ${who}: you can edit` : `Shared by ${who}: view only`}>
      <p>
        {editable
          ? `Your changes go to ${who}'s copy too. If you both change the same team, the older change is kept as a team of your own.`
          : `You can look at everything and use it in the calculator, but not change it.`}
      </p>
      <div className="mt-2">
        <Button size="sm" onClick={() => useTeamStore.getState().copySharedToMine(team.id)}>
          <Copy size={14} aria-hidden /> Make my own copy
        </Button>
      </div>
    </Notice>
  );
}
