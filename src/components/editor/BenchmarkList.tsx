import { Check, CircleHelp, Trash2, X } from 'lucide-react';
import type { Dex } from '@/data/dex';
import type { BenchmarkResult } from '@/domain/benchmarkEval';
import type { Benchmark } from '@/domain/benchmarks';
import type { FormatRules, PokemonSet } from '@/domain/types';
import { toast } from '@/store/toastStore';
import { Button } from '../ui/primitives';
import { cn } from '../ui/styles';
import { useBenchmarkResults } from './useBenchmarks';

const STATUS = {
  met: { Icon: Check, label: 'Holds', tone: 'text-good' },
  notmet: { Icon: X, label: 'Does not hold', tone: 'text-bad' },
  cant: { Icon: CircleHelp, label: "Can't check", tone: 'text-warn' },
} as const;

/** The ✓ / ✗ rows of some benchmarks. The state is an icon and a word for screen readers, never colour alone. */
export function BenchmarkRows({ results, onRemove }: { results: BenchmarkResult[]; onRemove?: (id: string) => void }) {
  return (
    <ul className="space-y-1.5" aria-label="Benchmarks">
      {results.map((r) => {
        const { Icon, label, tone } = STATUS[r.status];
        return (
          <li key={r.id} className="flex items-start gap-2">
            <Icon size={16} className={cn('mt-0.5 shrink-0', tone)} aria-label={label} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{r.label}</p>
              <p className="text-xs text-muted">{r.text}</p>
              {r.change && <p className={cn('text-xs font-medium', r.status === 'notmet' ? 'text-bad' : 'text-good')}>{r.change}</p>}
            </div>
            {onRemove && (
              <Button size="icon-sm" variant="ghost" aria-label={`Remove benchmark: ${r.label}`} onClick={() => onRemove(r.id)}>
                <Trash2 size={14} aria-hidden />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A Pokémon's benchmarks as ✓/✗ for the set as it is now, next to its stats. `onChange` (the editor)
 * adds Remove; without it (Team overview) the list is read-only. Nothing renders without benchmarks.
 */
export function BenchmarkList({ dex, format, set, onChange }: { dex: Dex; format: FormatRules; set: PokemonSet; onChange?: (benchmarks: Benchmark[] | undefined) => void }) {
  const { results, ready } = useBenchmarkResults(dex, format, [set]);
  const list = set.benchmarks;
  if (!list?.length) return null;
  const mine = results.get(set.uid);
  return (
    <section aria-label="Benchmarks" className="space-y-1.5">
      <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
        Benchmarks <span className="font-normal tracking-normal normal-case">· goals this spread was built for{mine ? `, ${mine.filter((r) => r.status === 'met').length} of ${mine.length} hold` : ''}</span>
      </p>
      {!ready || !mine ? (
        <p className="text-xs text-muted" role="status">Checking {list.length} {list.length === 1 ? 'benchmark' : 'benchmarks'}…</p>
      ) : (
        <BenchmarkRows
          results={mine}
          onRemove={onChange ? (id) => { const next = list.filter((b) => b.id !== id); onChange(next.length ? next : undefined); toast('Removed the benchmark.', { label: 'Undo', run: () => onChange(list) }); } : undefined}
        />
      )}
    </section>
  );
}
