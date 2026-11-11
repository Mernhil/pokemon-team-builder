import { useState, type ReactNode } from 'react';
import { Button, ConfirmInline } from '../ui/primitives';

/**
 * A ghost button for something that is hard to take back (unlinking a device, stopping or leaving a share): the first
 * tap asks (docs/UI.md), the second does it. The safe answer is focused.
 */
export function ConfirmAction({ children, ariaLabel, question, confirmLabel, onConfirm, disabled }: { children: ReactNode; ariaLabel?: string; question: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <ConfirmInline
        question={question}
        confirmLabel={confirmLabel}
        keepLabel="Cancel"
        onConfirm={() => {
          setAsking(false);
          onConfirm();
        }}
        onKeep={() => setAsking(false)}
      />
    );
  }
  return (
    <Button size="sm" variant="ghost" disabled={disabled} aria-label={ariaLabel} onClick={() => setAsking(true)}>
      {children}
    </Button>
  );
}
