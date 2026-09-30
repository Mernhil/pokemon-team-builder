import { cn } from './styles';

/** Game-version icon: an orb in the game's signature colour (original artwork, not box art). */
export function GameBadge({ color, className }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className={cn('shrink-0', className)}>
      <circle cx="8" cy="8" r="7" fill={color} stroke="rgb(0 0 0 / 0.35)" strokeWidth="1" />
      <path d="M2.2 6.2a6 6 0 0 1 11.6 0" fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="8" r="2.3" fill="rgb(255 255 255 / 0.85)" stroke="rgb(0 0 0 / 0.35)" strokeWidth="0.8" />
    </svg>
  );
}
