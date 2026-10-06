import { Lightbulb } from 'lucide-react';
import type { Suggestion } from '@/domain/coverage';
import { Label, TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';

/**
 * Plain-language read-out of a coverage matrix's danger rows, worst first, behind a collapsed
 * disclosure so it doesn't crowd the matrix — each one a compact type-badge chip (long-press or
 * hover for the full sentence) rather than a wrapped line of text. `fix` — a single type that
 * would resolve several problems at once — stays as its full sentence, visible even when collapsed.
 */
export function SuggestionList({ suggestions, fix }: { suggestions: Suggestion[]; fix?: Suggestion | null }) {
  if (suggestions.length === 0 && !fix) return null;
  // Collapsed by default to stay out of the way, except when there's a high-severity problem —
  // that stays visible without a tap, same as before this list could be collapsed at all.
  const defaultOpen = suggestions.some((s) => s.severity === 'high');
  return (
    <div className="mt-3 space-y-1.5 border-t border-border pt-3">
      {fix && (
        <div className="space-y-1">
          <p className="flex items-start gap-2 text-sm">
            <Lightbulb size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            <span>{fix.text}</span>
          </p>
          {fix.related && fix.related.length > 0 && (
            <div className="ml-[23px] flex flex-wrap gap-1">
              {fix.related.map((t) => (
                <TypeBadge key={t} type={t} size="xs" />
              ))}
            </div>
          )}
        </div>
      )}
      {suggestions.length > 0 && (
        <details className={cn('group', fix && 'pt-0.5')} open={defaultOpen}>
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-muted [&::-webkit-details-marker]:hidden">
            <Label>
              {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}
            </Label>
            <span className="text-[10px] text-muted group-open:hidden">(tap to show)</span>
          </summary>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <li key={s.id}>
                {/* title is a mouse-hover bonus; aria-label carries the full sentence to screen readers,
                    since the chip itself only shows a type badge and two numbers. */}
                <span
                  title={s.text}
                  aria-label={s.text}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border py-0.5 pr-1.5 pl-0.5',
                    s.severity === 'high' ? 'border-bad/50 bg-bad/10' : 'border-warn/40 bg-warn/5',
                  )}
                >
                  <TypeBadge type={s.type} size="xs" />
                  {s.stats && (
                    <span className="font-mono text-[11px] font-bold tabular-nums" aria-hidden>
                      <span className={s.stats[0].tone === 'bad' ? 'text-bad' : 'text-good'}>{s.stats[0].value}</span>
                      <span className="text-muted">/</span>
                      <span className={s.stats[1].tone === 'bad' ? 'text-bad' : 'text-good'}>{s.stats[1].value}</span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
