import * as DM from '@radix-ui/react-dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from './styles';

/**
 * Dropdown menu (Radix: arrow keys, typeahead, Esc and focus return come built in). Used for the
 * header's "More" destinations and the team actions overflow.
 */
export function Menu({ trigger, children, align = 'end', label }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end'; label: string }) {
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild aria-label={label}>
        {trigger}
      </DM.Trigger>
      <DM.Portal>
        <DM.Content
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="ui-panel z-50 min-w-52 rounded-xl border border-border bg-surface p-1 text-fg shadow-xl"
        >
          {children}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function MenuItem({
  icon: Icon,
  children,
  onSelect,
  disabled,
  current,
  tone,
  hint,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Marks the destination currently shown. */
  current?: boolean;
  tone?: 'danger';
  hint?: ReactNode;
}) {
  return (
    <DM.Item
      disabled={disabled}
      onSelect={onSelect}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex min-h-10 pointer-coarse:min-h-12 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-sm outline-none select-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2',
        current && 'font-semibold text-accent',
        tone === 'danger' && 'text-bad',
      )}
    >
      {Icon && <Icon size={16} className={cn('shrink-0', !current && tone !== 'danger' && 'text-muted')} aria-hidden />}
      <span className="flex-1">{children}</span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </DM.Item>
  );
}

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-border" />;

/** A small heading over a group of items ("Tools"). */
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <DM.Label className="px-2.5 pt-1.5 pb-0.5 text-2xs font-semibold tracking-wider text-muted uppercase">{children}</DM.Label>
);
