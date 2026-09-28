import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AlertTriangle, BarChart3, CloudOff, ExternalLink, RefreshCw } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { metaFor } from '@/data/meta';
import { REGULATION_MANIFEST, currentRegulation } from '@/domain/formats';
import { META_STALE_DAYS, localMetaFromMatches, metaAgeDays, metaDataDate, type MetaEntry, type MetaSnapshot } from '@/domain/meta';
import { STAT_IDS, STAT_LABELS, type FormatRules } from '@/domain/types';
import { useMatchStore } from '@/store/matchStore';
import { useMetaStore } from '@/store/metaStore';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, Label, Notice, Panel, Select } from '../ui/primitives';
import { cn } from '../ui/styles';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions').sort((a, b) => b.start.localeCompare(a.start));

/** Refresh only makes sense where a newer deploy can exist: the hosted web app (not the desktop app or the single-file build). */
const CAN_REFRESH = import.meta.env.MODE !== 'singlefile' && typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window) && /^https?:$/.test(location.protocol);

const fmtDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

function useOnline() {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Meta tab: the most-used Pokémon of a Champions regulation with their common items, moves,
 * abilities, spreads and teammates. Always shows something: published usage data built into the
 * app (Smogon's monthly stats, or the hand-maintained file), otherwise your own logged matches,
 * otherwise a clear "no data yet".
 */
export function MetaView({ dex, format }: { dex: Dex; format: FormatRules }) {
  const [regId, setRegId] = useState(format.regulationId && champRegs.some((r) => r.id === format.regulationId) ? format.regulationId : (currentRegulation()?.id ?? champRegs[0]?.id ?? ''));
  const refreshed = useMetaStore((s) => s.refreshed);
  const status = useMetaStore((s) => s.status);
  const error = useMetaStore((s) => s.error);
  const refresh = useMetaStore((s) => s.refresh);
  const matches = useMatchStore((s) => s.matches);
  const online = useOnline();

  const published = useMemo(() => metaFor(regId, refreshed), [regId, refreshed]);
  const personal = useMemo(() => (published ? null : localMetaFromMatches(Object.values(matches), regId)), [published, matches, regId]);
  const snapshot = published ?? personal ?? undefined;
  const reg = champRegs.find((r) => r.id === regId);

  return (
    <div className="space-y-3">
      <Panel bodyClassName="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <Select aria-label="Regulation" className="w-full sm:w-auto" value={regId} onChange={(e) => setRegId(e.target.value)}>
          {champRegs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        {snapshot && <SourceLine snapshot={snapshot} />}
        {CAN_REFRESH && (
          <Button size="sm" className="ml-auto" onClick={refresh} disabled={status === 'loading' || !online} title="Fetch the newest data published with the app">
            <RefreshCw size={14} className={cn(status === 'loading' && 'animate-spin motion-reduce:animate-none')} aria-hidden />
            {status === 'loading' ? 'Checking…' : 'Check for newer data'}
          </Button>
        )}
      </Panel>

      {!online && (
        <Notice icon={CloudOff} tone="accent">
          You’re offline. Showing the data built into the app{refreshed ? ' and the last refresh' : ''}.
        </Notice>
      )}
      {status === 'error' && online && (
        <Notice icon={AlertTriangle} title="Couldn’t check for newer data">
          {error} The data below is unchanged.
        </Notice>
      )}
      {status === 'ok' && <p role="status" className="text-sm text-good">Up to date with the published data.</p>}
      {published && metaAgeDays(published) > META_STALE_DAYS && (
        <Notice icon={AlertTriangle} title={`These numbers are ${metaAgeDays(published)} days old`}>
          They describe play up to {fmtDate(metaDataDate(published))}. Newer usage statistics haven’t been published or built into the app yet.
        </Notice>
      )}
      {!published && personal && (
        <Notice icon={BarChart3} tone="accent" title={`No published usage data for ${reg?.shortName ?? 'this regulation'} yet`}>
          Showing what you’ve faced in your own {personal.source.battles} logged matches instead.
        </Notice>
      )}

      {!snapshot ? (
        <EmptyState icon={BarChart3} title={`No usage data for ${reg?.shortName ?? 'this regulation'} yet`}>
          Smogon publishes each month’s usage statistics after the month ends; the app picks them up with its next update. Meanwhile, log matches on
          the Match log to see what you face most.
        </EmptyState>
      ) : (
        <ol className="grid gap-3 lg:grid-cols-2" aria-label={`Most used Pokémon in ${reg?.shortName ?? regId}`}>
          {snapshot.entries.map((e, i) => (
            <MetaCard key={e.speciesId} rank={i + 1} entry={e} dex={dex} format={format} />
          ))}
        </ol>
      )}
    </div>
  );
}

function SourceLine({ snapshot }: { snapshot: MetaSnapshot }) {
  const s = snapshot.source;
  const facts = [
    s.month && fmtMonth(s.month),
    s.cutoff !== undefined && s.cutoff > 0 && `rating ${s.cutoff}+`,
    s.battles !== undefined && `${s.battles.toLocaleString()} battles`,
    `updated ${fmtDate(snapshot.updatedAt)}`,
  ].filter(Boolean);
  return (
    <p className="min-w-0 text-sm text-muted">
      {s.url ? (
        <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-fg underline-offset-2 hover:underline">
          {s.name}
          <ExternalLink size={13} aria-hidden />
        </a>
      ) : (
        <b className="text-fg">{s.name}</b>
      )}{' '}
      · {facts.join(' · ')}
    </p>
  );
}

function MetaCard({ rank, entry: e, dex, format }: { rank: number; entry: MetaEntry; dex: Dex; format: FormatRules }) {
  const sp = dex.species(e.speciesId);
  const name = (id: string, kind: 'item' | 'move' | 'ability' | 'species') =>
    (kind === 'item' ? dex.item(id) : kind === 'move' ? dex.move(id) : kind === 'ability' ? dex.ability(id) : dex.species(id))?.name ?? id;
  return (
    <li className="min-w-0">
      <Panel
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="w-6 text-right font-mono text-xs text-muted" aria-label={`Rank ${rank}`}>
              {rank}
            </span>
            <Sprite speciesId={e.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={36} />
            <span className="truncate">{sp?.name ?? e.speciesId}</span>
          </span>
        }
        actions={<Chip tone="accent">{e.usagePct.toFixed(1)}%</Chip>}
      >
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <ShareList label="Items" rows={e.items.slice(0, 4)} render={(id) => <><ItemSprite itemId={id} name={name(id, 'item')} size={18} />{name(id, 'item')}</>} />
          <ShareList label="Moves" rows={e.moves.slice(0, 4)} render={(id) => name(id, 'move')} />
          {e.abilities.length > 0 && <ShareList label="Abilities" rows={e.abilities.slice(0, 2)} render={(id) => name(id, 'ability')} />}
          {e.teammates.length > 0 && (
            <ShareList
              label="Teammates"
              rows={e.teammates.slice(0, 4)}
              render={(id) => {
                const t = dex.species(id);
                return (
                  <>
                    <Sprite speciesId={id} name={t?.name} types={t?.types} set={format.spriteSet} size={22} />
                    {t?.name ?? id}
                  </>
                );
              }}
            />
          )}
          {e.spreads[0] && (
            <div className="sm:col-span-2">
              <Label>Most common spread</Label>
              <p className="mt-1 font-mono text-xs">
                {e.spreads[0].nature} ·{' '}
                {STAT_IDS.map((k, i) => (e.spreads[0].values[i] ? `${e.spreads[0].values[i]} ${STAT_LABELS[k]}` : null))
                  .filter(Boolean)
                  .join(' / ') || 'no investment'}{' '}
                <span className="text-muted">({e.spreads[0].pct.toFixed(0)}%)</span>
              </p>
            </div>
          )}
        </div>
      </Panel>
    </li>
  );
}

function ShareList({ label, rows, render }: { label: string; rows: { id: string; pct: number }[]; render: (id: string) => ReactNode }) {
  if (!rows.length) return null;
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <ul className="mt-1 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{render(r.id)}</span>
            <span className="w-10 shrink-0 text-right font-mono text-xs text-muted">{r.pct.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
