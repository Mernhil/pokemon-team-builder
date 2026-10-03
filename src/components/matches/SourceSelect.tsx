import type { MatchSource } from '@/domain/sharedMatches';
import { Select } from '../ui/primitives';

export function SourceSelect({ source, options, onChange, className }: { source: MatchSource; options: { value: MatchSource; label: string }[]; onChange: (s: MatchSource) => void; className?: string }) {
  if (options.length < 2) return null;
  return (
    <Select aria-label="Whose matches" className={className} value={source} onChange={(e) => onChange(e.target.value as MatchSource)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}
