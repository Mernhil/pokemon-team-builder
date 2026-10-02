import { AlertCircle, AlertTriangle } from 'lucide-react';
import type { Suggestion } from '@/domain/coverage';
import { Label, SeverityIcon } from '../ui/primitives';

/** Plain-language read-out of a coverage matrix's danger rows, worst first. */
export function SuggestionList({ suggestions }: { suggestions: Suggestion[] }) {
  if (suggestions.length === 0) return null;
  return (
    <div className="mt-3 space-y-1.5 border-t border-border pt-3">
      <Label>Suggestions</Label>
      <ul className="space-y-1.5">
        {suggestions.map((s) => (
          <li key={s.id} className="flex items-start gap-2 text-sm">
            <SeverityIcon icon={s.severity === 'high' ? AlertCircle : AlertTriangle} tone={s.severity === 'high' ? 'bad' : 'warn'} />
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
