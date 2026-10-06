/**
 * Focus return for dialogs that are opened from a menu or a shortcut (Radix only knows how to return
 * focus to a Dialog.Trigger, and a menu item is gone by the time the dialog closes, so focus fell to
 * <body> and keyboard users started again from the top of the page). The last element focused outside
 * any dialog or menu is remembered, and a closing dialog hands focus back to it.
 */
let last: HTMLElement | null = null;

const OVERLAY = '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]';

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (e) => {
      const el = e.target as HTMLElement | null;
      if (!el || el === document.body || el.closest(OVERLAY)) return;
      last = el;
    },
    true,
  );
  // A menu trigger doesn't take focus when it is clicked (Radix cancels the pointerdown), so remember the pressed control as well.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('button, a[href], summary, [role="button"]');
      if (el && !el.closest(OVERLAY)) last = el;
    },
    true,
  );
}

/** For `onCloseAutoFocus` on Radix dialog content. */
export function returnFocus(e: Event) {
  // A dialog opened from inside another one returns to that one (Radix does it right).
  if (document.querySelectorAll('[role="dialog"]').length > 1) return;
  if (last?.isConnected) {
    e.preventDefault();
    last.focus();
  }
}
