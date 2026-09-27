import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { REGULATION_MANIFEST, currentRegulation } from '@/domain/formats';
import { localMetaFromMatches, loadMetaSnapshot, MetaDataError } from '@/domain/meta';
import { STAT_LABELS, type FormatRules } from '@/domain/types';
import { useMatchStore } from '@/store/matchStore';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Panel, Select } from '../ui/primitives';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions').sort((a, b) => b.start.localeCompare(a.start));

/**
 * Popular teams / stat spreads: a static, checked-in usage snapshot per regulation (see
 * src/domain/meta.ts and src/data/meta/) — no live third-party fetch, so there's nothing to retry
 * or fail here at runtime.
 */
export function MetaView({ dex, format }: { dex: Dex; format: FormatRules }) {
  const [regId, setRegId] = useState(currentRegulation()?.id ?? champRegs[0]?.id ?? '');
  const matches = useMatchStore((s) => s.matches);

  const { snapshot, error } = useMemo(() => {
    try {
      return { snapshot: loadMetaSnapshot(regId), error: undefined as string | undefined };
    } catch (e) {
      const message = e instanceof MetaDataError ? e.message : 'Usage data for this regulation could not be loaded.';
      const local = localMetaFromMatches(Object.values(matches), regId);
      return { snapshot: local ?? undefined, error: message };
    }
  }, [regId, matches]);

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
          {snapshot ? `Last updated: ${snapshot.lastUpdated} · ${snapshot.source}` : 'No usage data for this regulation'}
        </span>
        <a
          href="https://www.smogon.com/stats/"
          target="_blank"
          rel="noreferrer"
          className="ml-auto flex items-center gap-1 text-xs font-medium text-accent hover:underline"
        >
          Live/full usage stats on Smogon <ExternalLink size={12} />
        </a>
      </div>

      {error && (
        <Panel title="No checked-in usage data for this regulation">
          <p className="text-xs text-warn">{error}</p>
          <p className="mt-1 text-xs text-muted">
            {snapshot
              ? 'Showing usage derived from your own logged matches below instead.'
              : 'Log some matches on the Matches tab to see usage stats from your own games, or check the Smogon link above for live stats.'}
          </p>
        </Panel>
      )}

      {!entries.length && !error && <Panel title="No data yet">No usage entries in the checked-in snapshot for this regulation.</Panel>}

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
