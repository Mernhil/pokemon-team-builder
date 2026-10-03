import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { TOAST_MS, useToastStore, type Toast } from '@/store/toastStore';
import { Button } from './primitives';

/** Renders the toast queue above the bottom tab bar, announced politely to screen readers. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (paused) return;
    timer.current = setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer.current);
  }, [paused, toast.id, dismiss]);

  return (
    <div
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-xl border border-border bg-fg py-1.5 pr-1.5 pl-4 text-sm text-bg shadow-2xl"
    >
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <Button
          variant="ghost"
          size="sm"
          className="text-bg! hover:bg-bg/15! hover:text-bg!"
          onClick={() => {
            toast.action!.run();
            dismiss(toast.id);
          }}
        >
          {toast.action.label}
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Dismiss" className="text-bg/80! hover:bg-bg/15! hover:text-bg!" onClick={() => dismiss(toast.id)}>
        <X size={15} />
      </Button>
    </div>
  );
}
