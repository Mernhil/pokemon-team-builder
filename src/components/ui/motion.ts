/** 'smooth' for scripted scrolling, unless the person asked for reduced motion (CSS can't switch off scrollIntoView / scrollTo). */
export const scrollBehavior = (): ScrollBehavior =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/** Runs `fn` when the browser is idle (or soon after, where it has no idle callback): for preloading chunks that a click will need. */
export function whenIdle(fn: () => void, timeout = 3000): () => void {
  if (typeof window === 'undefined') return () => undefined;
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 1500);
  return () => clearTimeout(id);
}
