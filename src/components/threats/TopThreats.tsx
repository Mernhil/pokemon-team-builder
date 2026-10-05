import { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { defaultField } from '@/domain/battle/conditions';
import type { FormatRules, Team } from '@/domain/types';
import { Label } from '../ui/primitives';
import { useThreatReport } from './useThreatReport';

/** Team check's "Top threats" line: the worst three of the Threat report (default field, top 20), linking to it. */
export function TopThreats({ team, dex, format }: { team: Team; dex: Dex; format: FormatRules }) {
  const field = useMemo(() => defaultField(), []);
  const { summaries, done, picked } = useThreatReport({ dex, format, team, count: 20, field, delay: 400 });
  if (!picked) return null;
  const worst = summaries.filter((s) => s.tone !== 'good').slice(0, 3);
  return (
    <div className="space-y-1.5">
      <Label>Top threats</Label>
      {worst.length > 0 ? (
        <ul className="space-y-0.5 text-sm">
          {worst.map((s) => (
            <li key={s.speciesId} className="flex items-baseline gap-1.5">
              <b className="shrink-0">{dex.species(s.speciesId)?.name ?? s.speciesId}</b>
              <span className="min-w-0 truncate text-xs text-muted" title={s.lines.join(' ')}>
                {s.tone === 'bad' ? 'big problem' : 'watch out'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">{done ? 'No clear problems against the most-used sets.' : 'Checking the most-used sets…'}</p>
      )}
      <a href="#analyse/threats" className="inline-flex min-h-8 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-2 hover:underline pointer-coarse:min-h-11">
        <ShieldAlert size={15} aria-hidden /> Threat report
        <span className="font-normal text-muted">your whole team against the meta, both ways</span>
      </a>
    </div>
  );
}
