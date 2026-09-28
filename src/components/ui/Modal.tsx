import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { buttonClass, cn } from './styles';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/55" />
        {/* Phones: a sheet from the bottom edge (above the home indicator). Wider: a centred dialog. */}
        <Dialog.Content
          className={cn(
            'fixed z-50 flex flex-col border border-border bg-surface text-fg shadow-2xl',
            'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
            'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[88dvh] sm:w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0',
            wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border-strong/60 sm:hidden" aria-hidden />
          <header className="flex items-start justify-between gap-4 px-5 pt-3 pb-2 sm:pt-4">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className={buttonClass('ghost', 'icon', '-mr-2 shrink-0')} aria-label="Close">
              <X size={18} />
            </Dialog.Close>
          </header>
          <div className="scrollbar-thin overflow-auto overscroll-contain px-5 pt-2 pb-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
