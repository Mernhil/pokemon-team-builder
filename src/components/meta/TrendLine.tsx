import { useMemo } from 'react';
import { speciesSeries, TREND_PERIOD_LABEL, type HistoryEntry, type TrendPeriod } from '@/domain/metaHistory';

/**
 * A small trend line for one Pokémon's rank (higher on the line = better) or usage %, with the
 * numbers in words beside it: "#14 → #9 over 7 days". Blue and an arrow, never colour alone.
 */
export function TrendLine({ history, speciesId, period }: { history: HistoryEntry[]; speciesId: string; period: TrendPeriod }) {
  const series = useMemo(() => speciesSeries(history, speciesId, period), [history, speciesId, period]);
  if (!series) return null;
  const { kind, points } = series;
  const vals = points.map((p) => p.value);
  const known = vals.filter((v): v is number => v !== undefined);
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const W = 90;
  const H = 24;
  // Rank: 1 is best, so it's drawn at the top; %: more is higher.
  const y = (v: number) => (hi === lo ? H / 2 : kind === 'ingame' ? 2 + ((v - lo) / (hi - lo)) * (H - 4) : H - 2 - ((v - lo) / (hi - lo)) * (H - 4));
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * (W - 4) + 2);
  const path = vals.map((v, i) => (v === undefined ? null : `${x(i)},${y(v)}`)).filter(Boolean);
  const fmt = (v: number | undefined) => (v === undefined ? 'unlisted' : kind === 'ingame' ? `#${v}` : `${v.toFixed(1)}%`);
  const first = vals[0];
  const last = vals.at(-1);
  const better = first !== undefined && last !== undefined && (kind === 'ingame' ? last < first : last > first);
  const worse = first !== undefined && last !== undefined && (kind === 'ingame' ? last > first : last < first);
  const span = TREND_PERIOD_LABEL[String(period)];
  const text = `${fmt(first)} → ${fmt(last)} over ${period === 'season' ? span : `up to ${span}`}`;
  return (
    <div className="flex items-center gap-2 text-xs" data-testid="trend-line">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Trend: ${text}`} className={worse ? 'text-warn' : 'text-accent'}>
        <polyline points={path.join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {last !== undefined && <circle cx={x(vals.length - 1)} cy={y(last)} r="2.5" fill="currentColor" />}
      </svg>
      <span className="text-muted">
        <span aria-hidden>{better ? '▲ ' : worse ? '▼ ' : '＝ '}</span>
        {text}
      </span>
    </div>
  );
}
