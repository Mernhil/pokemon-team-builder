import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { Issue } from '@/domain/validation';
import { useTeamStore } from '@/store/teamStore';
import { Chip, Panel, SeverityIcon } from '../ui/primitives';

/** Error/warning counts as chips (icon + words, never colour alone). */
export function IssueCounts({ issues }: { issues: Issue[] }) {
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  return (
    <span className="flex flex-wrap gap-1.5">
      <Chip tone={errors ? 'bad' : 'good'} icon={errors ? AlertCircle : CheckCircle2}>
        {errors} {errors === 1 ? 'error' : 'errors'}
      </Chip>
      <Chip tone={warnings ? 'warn' : 'neutral'} icon={AlertTriangle}>
        {warnings} {warnings === 1 ? 'warning' : 'warnings'}
      </Chip>
    </span>
  );
}

/** Errors and warnings; each one naming a slot jumps the editor to it. */
export function IssueList({ issues, onSelectSlot }: { issues: Issue[]; onSelectSlot?: (i: number) => void }) {
  const globalSetActiveSlot = useTeamStore((s) => s.setActiveSlot);
  const setActiveSlot = onSelectSlot ?? globalSetActiveSlot;
  const shown = issues.filter((i) => i.severity !== 'info');
  if (shown.length === 0)
    return (
      <p className="flex items-center gap-2 text-sm text-good">
        <CheckCircle2 size={16} aria-hidden /> Legal and fully trained.
      </p>
    );
  return (
    <ul className="scrollbar-thin max-h-64 space-y-0.5 overflow-auto">
      {shown.map((i, k) => {
        const Icon = i.severity === 'error' ? AlertCircle : i.severity === 'warning' ? AlertTriangle : Info;
        return (
          <li key={k}>
            <button
              type="button"
              disabled={i.slot === undefined}
              onClick={() => i.slot !== undefined && setActiveSlot(i.slot)}
              className="flex min-h-9 w-full items-start pointer-coarse:min-h-11 gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent"
            >
              <SeverityIcon icon={Icon} tone={i.severity === 'error' ? 'bad' : 'warn'} />
              <span>{i.message}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ValidationPanel({ issues, onSelectSlot }: { issues: Issue[]; onSelectSlot?: (i: number) => void }) {
  return (
    <Panel title="Validation" actions={<IssueCounts issues={issues} />}>
      <IssueList issues={issues} onSelectSlot={onSelectSlot} />
    </Panel>
  );
}
