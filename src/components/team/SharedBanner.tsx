import { Copy, Eye, Pencil } from 'lucide-react';
import { isReadOnly, useTeamStore } from '@/store/teamStore';
import type { Team } from '@/domain/types';
import { toast } from '@/store/toastStore';
import { Button, Notice } from '../ui/primitives';

/** Shown above a team that belongs to someone else's shared folder: whose it is, what I can do, and the way to a copy of my own. */
export function SharedBanner({ team }: { team: Team }) {
  const mark = team.shared;
  if (!mark) return null;
  const who = mark.ownerName || mark.owner;
  const readOnly = isReadOnly(team);
  const copy = () => {
    useTeamStore.getState().makeOwnCopy(team.id);
    toast(`Made your own copy of “${team.name}”. Changes to it stay with you.`);
  };
  return (
    <Notice tone="accent" icon={readOnly ? Eye : Pencil} title={readOnly ? `Shared by ${who} · view only` : `Shared by ${who} · you can edit`}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">{readOnly ? 'You can look at everything, but nothing here can be changed.' : 'Your changes sync to them, and theirs to you. If you both change the same team, the older change is kept as a “Conflict copy” variation.'}</span>
        <Button size="sm" variant={readOnly ? 'primary' : 'default'} onClick={copy}>
          <Copy size={14} aria-hidden /> Make my own copy
        </Button>
      </span>
    </Notice>
  );
}
