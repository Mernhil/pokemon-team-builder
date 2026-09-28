import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';

const GAP = 8;

/**
 * Shared behaviour of the info and move cards: a mouse opens them by hovering, a finger by tapping
 * (tap again or anywhere else to close), the keyboard by focusing (Enter/Space toggle, Esc closes).
 * Nothing is hover-only. Returns the props for the trigger element and the card's position.
 */
export function useTooltipTrigger(
  width: number,
  { label, room = 250, wrapsControl = false }: { label?: string; room?: number; wrapsControl?: boolean } = {},
) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    let left = rect.left;
    if (left + width > window.innerWidth - GAP) left = window.innerWidth - width - GAP;
    if (left < GAP) left = GAP;
    const spaceBelow = window.innerHeight - rect.bottom;
    const above = spaceBelow < room && rect.top > spaceBelow;
    setPos({ top: above ? rect.top - GAP : rect.bottom + GAP, left, above });
  }, [open, width, room]);

  // A tap anywhere else closes a card opened by tapping.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);
  useEffect(
    () => () => {
      clearTimeout(hoverTimer.current);
      clearTimeout(pressTimer.current);
    },
    [],
  );

  const hover = {
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => setOpen(true), 150);
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(hoverTimer.current);
      setOpen(false);
    },
  };

  /**
   * Wrapping a control (a weather chip): the wrapper can't be a second button, so the card opens
   * on hover, when the control gets keyboard focus, or on a long press on touch (a tap still
   * presses the control).
   */
  if (wrapsControl)
    return {
      open,
      pos,
      id,
      triggerProps: {
        ref: anchorRef,
        ...hover,
        onFocusCapture: (e: FocusEvent<HTMLElement>) => {
          if ((e.target as HTMLElement).matches(':focus-visible')) setOpen(true);
        },
        onBlurCapture: () => setOpen(false),
        onKeyDownCapture: (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false),
        onPointerDown: (e: PointerEvent) => {
          if (e.pointerType === 'mouse') return;
          clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => setOpen(true), 450);
        },
        onPointerUp: () => clearTimeout(pressTimer.current),
        onPointerCancel: () => clearTimeout(pressTimer.current),
      },
    };

  const triggerProps = {
    ref: anchorRef,
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    'aria-expanded': open,
    'aria-describedby': open ? id : undefined,
    ...hover,
    onClick: () => setOpen((o) => !o),
    // Keyboard focus opens it; a tap's focus doesn't (the click handles taps).
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.currentTarget.matches(':focus-visible')) setOpen(true);
    },
    onBlur: () => setOpen(false),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    },
  };
  return { open, pos, id, triggerProps };
}
