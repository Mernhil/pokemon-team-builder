import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useDex } from '@/data/useDex';
import { getFormat } from '@/domain/formats';
import { createTeam } from '@/domain/team';
import type { FormatRules, Team } from '@/domain/types';
import { validateTeam } from '@/domain/validation';
import { useTeamStore } from '@/store/teamStore';
import { ValidationPanel } from '../analysis/ValidationPanel';
import { SetEditor } from '../editor/SetEditor';
import { TeamSlots } from '../team/TeamSlots';
import { Button, Panel, Select } from '../ui/primitives';

/**
 * One full team builder (species, item, ability, moves, spread — everything the Builder tab has),
 * bound to an explicit team id instead of "the" active team, so the Matches tab can show two of
 * these side by side (Your Team / Enemy Team) without them fighting over shared state.
 */
export function TeamBuilderPanel({
  title,
  teamId,
  onTeamIdChange,
  newTeamFormatId,
  excludeTeamId,
}: {
  title: string;
  teamId: string | undefined;
  onTeamIdChange: (id: string) => void;
  /** Format for a freshly created team when none is picked yet. */
  newTeamFormatId: string;
  /** The other panel's team id, hidden from this panel's picker so the two can't collapse onto one team. */
  excludeTeamId?: string;
}) {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order).filter((id) => id !== excludeTeamId && !teams[id]?.shared);
  const { addTeams } = useTeamStore.getState();
  const team = teamId ? teams[teamId] : undefined;
  const format = team ? getFormat(team.formatId) : undefined;
  const dexState = useDex(format?.datasetId ?? newTeamFormatId);
  const [activeSlot, setActiveSlot] = useState(0);

  // Adds the new team to the store without touching the Builder tab's own active team — `newTeam()`
  // would otherwise hijack it, and this panel isn't necessarily editing the active team at all.
  const startNew = () => {
    const t = createTeam(getFormat(newTeamFormatId));
    addTeams([t], false);
    onTeamIdChange(t.id);
  };

  return (
    <div className="space-y-3">
      <Panel
        title={title}
        actions={
          <div className="flex items-center gap-1.5">
            <Select aria-label={`${title}: load a saved team`} className="h-8 w-auto max-w-48 text-xs" value={teamId ?? ''} onChange={(e) => e.target.value && onTeamIdChange(e.target.value)}>
              <option value="">Pick a saved team…</option>
              {order.map((id) => (
                <option key={id} value={id}>
                  {teams[id]?.name}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={startNew}>
              <Plus size={13} /> New
            </Button>
          </div>
        }
      >
        {!team ? (
          <p className="p-6 text-center text-sm text-muted">Pick a saved team above, or start a new one.</p>
        ) : dexState.status !== 'ready' ? (
          <p className="p-6 text-center text-sm text-muted">{dexState.status === 'error' ? dexState.error : 'Loading…'}</p>
        ) : (
          <PanelBody team={team} activeSlot={Math.min(activeSlot, 5)} setActiveSlot={setActiveSlot} dex={dexState.dex} format={format!} />
        )}
      </Panel>
    </div>
  );
}

function PanelBody({
  team,
  activeSlot,
  setActiveSlot,
  dex,
  format,
}: {
  team: Team;
  activeSlot: number;
  setActiveSlot: (i: number) => void;
  dex: Dex;
  format: FormatRules;
}) {
  const issues = validateTeam(team, format, dex);
  const filled = team.slots.filter(Boolean).length;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {team.name} · {format.shortName} · {filled}/{format.teamSize}
      </p>
      <TeamSlots team={team} dex={dex} format={format} issues={issues} activeSlot={activeSlot} onActiveSlot={setActiveSlot} />
      <SetEditor teamId={team.id} slot={activeSlot} set={team.slots[activeSlot]} dex={dex} format={format} issues={issues} />
      <ValidationPanel issues={issues} onSelectSlot={setActiveSlot} />
    </div>
  );
}
