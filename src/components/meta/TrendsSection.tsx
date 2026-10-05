import { useMemo, useState } from 'react';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useMetaHistory } from '@/data/useMetaHistory';
import { TREND_PERIODS, TREND_PERIOD_LABEL, TREND_TOP_N, computeTrends, trendRows, trendText, type SpeciesTrend, type TrendPeriod, type TrendReport } from '@/domain/metaHistory';
import type { FormatRules } from '@/domain/types';
import { Sprite } from '../ui/Sprite';
import { Chip, EmptyState, LoadingState, Notice, Panel, Tabs } from '../ui/primitives';

const fmtDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const periodLabel = (p: TrendPeriod) => (p === 'season' ? 'Season' : `${p} days`);

/**
 * What's moving in the meta: Rising / Falling / New / Dropped lists comparing the newest numbers with
 * an earlier day. Gains are blue ▲, losses amber ▼ (colour-blind safe), and every row says it in words.
 */
export function TrendsSection({ regulationId, dex, format, sourceName }: { regulationId: string; dex: Dex; format: FormatRules; sourceName?: string }) {
  const history = useMetaHistory(regulationId);
  const [period, setPeriod] = useState<TrendPeriod>(7);
  const report = useMemo(() => (history ? computeTrends(history, period) : null), [history, period]);

  if (!history) return <LoadingState label="Loading history…" />;
  if (!report) {
    return (
      <EmptyState icon={TrendingUp} title="Not enough history yet">
        Trends compare two days of the same ranking. The app keeps one snapshot a day; check back once there are at least two for this regulation.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-3">
      <Panel bodyClassName="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <Tabs<string>
          label="Trend period"
          size="sm"
          tabs={TREND_PERIODS.map((p) => ({ id: String(p), label: periodLabel(p) }))}
          value={String(period)}
          onChange={(id) => setPeriod(id === 'season' ? 'season' : (Number(id) as TrendPeriod))}
        />
        <p className="min-w-0 text-sm text-muted">
          {report.kind === 'ingame' ? 'In-game ranking' : 'Smogon usage'}: {fmtDate(report.baseline)} → <b className="text-fg">{fmtDate(report.latest)}</b> ({report.days} {report.days === 1 ? 'day' : 'days'}){sourceName ? ` · ${sourceName}` : ''}
        </p>
      </Panel>
      {report.shortened && (
        <Notice tone="accent" icon={AlertTriangle} title={`Only ${report.days} ${report.days === 1 ? 'day' : 'days'} of comparable data`}>
          The history doesn’t reach back {TREND_PERIOD_LABEL[String(period)]}, so this compares with the earliest comparable day.
        </Notice>
      )}
      {report.breakAt && (
        <Notice tone="accent" icon={AlertTriangle} title="The data source changed">
          Before {fmtDate(report.breakAt.date)} the numbers were the {report.breakAt.from}; from then they’re the {report.breakAt.to}. Ranks and percentages can’t be compared, so
          nothing is measured across that point.
        </Notice>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <TrendList title="Rising" empty="Nobody moved up notably." rows={trendRows(report, 'rising')} report={report} dex={dex} format={format} />
        <TrendList title="Falling" empty="Nobody moved down notably." rows={trendRows(report, 'falling')} report={report} dex={dex} format={format} />
        <TrendList title={`New in the top ${TREND_TOP_N}`} empty={`Nobody new in the top ${TREND_TOP_N}.`} rows={trendRows(report, 'new')} report={report} dex={dex} format={format} />
        <TrendList title={`Dropped out of the top ${TREND_TOP_N}`} empty={`Nobody left the top ${TREND_TOP_N}.`} rows={trendRows(report, 'dropped')} report={report} dex={dex} format={format} />
      </div>
    </div>
  );
}

function TrendList({ title, rows, empty, report, dex, format }: { title: string; rows: SpeciesTrend[]; empty: string; report: TrendReport; dex: Dex; format: FormatRules }) {
  return (
    <Panel title={title} actions={<Chip>{rows.length}</Chip>}>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 10).map((r) => {
            const sp = dex.species(r.speciesId);
            return (
              <li key={r.speciesId} className="flex items-center gap-2 text-sm">
                <Sprite speciesId={r.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={28} />
                <span className="min-w-0 flex-1 truncate font-semibold">{sp?.name ?? r.speciesId}</span>
                <span className={r.status === 'rising' || r.status === 'new' ? 'text-accent' : 'text-warn'}>{trendText(r, report)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
