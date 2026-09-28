import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { REGULATION_MANIFEST, currentRegulation } from '@/domain/formats';
import { STAT_LABELS, type FormatRules } from '@/domain/types';
import { useMetaStore } from '@/store/metaStore';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Button, Panel, Select } from '../ui/primitives';
import { cn } from '../ui/styles';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions').sort((a, b) => b.start.localeCompare(a.start));

const fmtAge = (ms: number) => {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 60) return `${mins || 1} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

/**
 * Real usage data (most-used species/cores and common spreads) from championsbattledata.com — kept
 * as its own read/write-to-cache section, independent of the personal match log.
 */
export function MetaView({ dex, format }: { dex: Dex; format: FormatRules }) {
  const [regId, setRegId] = useState(currentRegulation()?.id ?? champRegs[0]?.id ?? '');
  const snapshot = useMetaStore((s) => s.snapshots[regId]);
  const loading = useMetaStore((s) => s.loading[regId]);
  const error = useMetaStore((s) => s.errors[regId]);
  const { fetchRegulation } = useMetaStore.getState();

  useEffect(() => {
    if (!snapshot && !loading && regId) fetchRegulation(regId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regId]);

  const entries = snapshot?.entries ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Popular teams &amp; spreads</span>
        <Select aria-label="Regulation" className="h-8 w-auto text-xs" value={regId} onChange={(e) => setRegId(e.target.value)}>
          {champRegs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.shortName}
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted">
          {snapshot ? `Data last updated ${fmtAge(snapshot.fetchedAt)} · ${snapshot.source}` : 'Not fetched yet'}
        </span>
        <Button size="sm" className="ml-auto" onClick={() => fetchRegulation(regId)} disabled={!!loading}>
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} /> {loading ? 'Fetching…' : 'Refresh from championsbattledata.com'}
        </Button>
      </div>

      {error && (
        <Panel title="Couldn't fetch usage data">
          <p className="text-xs text-warn">{error}</p>
          <p className="mt-1 text-xs text-muted">
            championsbattledata.com is an unofficial third-party source and may be unreachable, rate-limited or have changed its API shape.
            {snapshot?.source.startsWith('championsbattledata.com')
              ? ' Showing the last successful fetch below.'
              : snapshot
                ? ' Showing usage derived from your own logged matches below instead.'
                : ' Log some matches on the Matches tab to see usage stats from your own games while this is down.'}
          </p>
        </Panel>
      )}

      {!entries.length && !error && !loading && <Panel title="No data yet">Click "Refresh" to fetch usage stats for this regulation.</Panel>}

      <div className="grid gap-3 lg:grid-cols-2">
        {entries.map((e) => {
          const sp = dex.species(e.speciesId);
          const topSpread = [...e.spreads].sort((a, b) => b.pct - a.pct)[0];
          return (
            <Panel
              key={e.speciesId}
              title={
                <span className="flex items-center gap-2">
                  <Sprite speciesId={e.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={28} />
                  {sp?.name ?? e.speciesId}
                  <span className="font-mono text-xs font-normal text-muted">{e.usagePct.toFixed(1)}% usage</span>
                </span>
              }
            >
              <div className="space-y-2 text-xs">
                {e.items.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Common items</p>
                    <div className="flex flex-wrap gap-2">
                      {e.items.slice(0, 4).map((it) => (
                        <span key={it.itemId} className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5">
                          <ItemSprite itemId={it.itemId} name={it.itemId} size={16} />
                          {dex.item(it.itemId)?.name ?? it.itemId} · {it.pct.toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {e.moves.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Common moves</p>
                    <div className="flex flex-wrap gap-1.5">
                      {e.moves.slice(0, 4).map((mv) => (
                        <span key={mv.moveId} className="rounded-full bg-surface-2 px-2 py-0.5">
                          {dex.move(mv.moveId)?.name ?? mv.moveId} · {mv.pct.toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {topSpread && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Common spread</p>
                    <p className="font-mono">
                      {topSpread.nature ? `${topSpread.nature} · ` : ''}
                      {topSpread.sp ? Object.entries(topSpread.sp).map(([k, v]) => `${v} ${STAT_LABELS[k as keyof typeof STAT_LABELS]}`).join(' / ') : '—'}
                    </p>
                  </div>
                )}
                {e.teammates && e.teammates.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Common core</p>
                    <p>{e.teammates.slice(0, 3).map((t) => dex.species(t.speciesId)?.name ?? t.speciesId).join(', ')}</p>
                  </div>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
