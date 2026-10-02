import { AlertCircle, AlertTriangle, Lightbulb } from 'lucide-react';
import type { Suggestion } from '@/domain/coverage';
import { Label, SeverityIcon } from '../ui/primitives';
import { cn } from '../ui/styles';

/**
 * Plain-language read-out of a coverage matrix's danger rows, worst first, behind a collapsed
 * disclosure so it doesn't crowd the matrix. `fix` — a single type that would resolve several
 * problems at once — stays visible as a teaser even when collapsed.
 */
export function SuggestionList({ suggestions, fix }: { suggestions: Suggestion[]; fix?: Suggestion | null }) {
  if (suggestions.length === 0 && !fix) return null;
  // Collapsed by default to stay out of the way, except when there's a high-severity problem —
  // that stays visible without a tap, same as before this list could be collapsed at all.
  const defaultOpen = suggestions.some((s) => s.severity === 'high');
  return (
    <div className="mt-3 space-y-1.5 border-t border-border pt-3">
      {fix && (
        <p className="flex items-start gap-2 text-sm">
          <Lightbulb size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden />
          <span>{fix.text}</span>
        </p>
      )}
      {suggestions.length > 0 && (
        <details className={cn('group', fix && 'pt-0.5')} open={defaultOpen}>
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold text-muted [&::-webkit-details-marker]:hidden">
            <Label>
              {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}
            </Label>
            <span className="text-[10px] text-muted group-open:hidden">(tap to show)</span>
          </summary>
          <ul className="mt-2 space-y-1.5">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-start gap-2 text-sm">
                <SeverityIcon icon={s.severity === 'high' ? AlertCircle : AlertTriangle} tone={s.severity === 'high' ? 'bad' : 'warn'} />
                <span>{s.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
