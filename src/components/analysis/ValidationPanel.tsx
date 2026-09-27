import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { Issue } from '@/domain/validation';
import { useTeamStore } from '@/store/teamStore';
import { Panel, cn } from '../ui/primitives';

export function ValidationPanel({ issues }: { issues: Issue[] }) {
  const setActiveSlot = useTeamStore((s) => s.setActiveSlot);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const shown = issues.filter((i) => i.severity !== 'info');

  return (
    <Panel
      title="Validation"
      actions={
        <span className="flex gap-2 text-[11px] font-semibold">
          <span className={errors ? 'text-bad' : 'text-muted'}>{errors} errors</span>
          <span className={warnings ? 'text-warn' : 'text-muted'}>{warnings} warnings</span>
        </span>
      }
    >
      {shown.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-good">
          <CheckCircle2 size={16} /> Team is legal and fully allocated.
        </p>
      ) : (
        <ul className="scrollbar-thin max-h-56 space-y-1 overflow-auto">
          {shown.map((i, k) => {
            const Icon = i.severity === 'error' ? AlertCircle : i.severity === 'warning' ? AlertTriangle : Info;
            return (
              <li key={k}>
                <button
                  type="button"
                  disabled={i.slot === undefined}
                  onClick={() => i.slot !== undefined && setActiveSlot(i.slot)}
                  className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-surface-2 disabled:hover:bg-transparent"
                >
                  <Icon size={14} className={cn('mt-px shrink-0', i.severity === 'error' ? 'text-bad' : 'text-warn')} />
                  <span>{i.message}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
