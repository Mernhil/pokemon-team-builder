import { useSyncExternalStore } from 'react';

/** Live result of a CSS media query (false where matchMedia doesn't exist, e.g. tests). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && !!window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Phone-sized screen (below Tailwind's `sm`): pickers become bottom sheets, dense panels collapse. */
export const useIsPhone = () => useMedia('(max-width: 639px)');
