import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AlertTriangle, BarChart3, CloudOff, ExternalLink, RefreshCw } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { useMetaHistory } from '@/data/useMetaHistory';
import { TREND_PERIODS, type HistoryEntry, type TrendPeriod } from '@/domain/metaHistory';
import { REGULATION_MANIFEST, currentRegulation } from '@/domain/formats';
import { META_STALE_DAYS, isProvisional, localMetaFromMatches, metaAgeDays, metaDataDate, metaSourceKind, usageLabel, type MetaEntry, type MetaSnapshot } from '@/domain/meta';
import { STAT_IDS, STAT_LABELS, type FormatRules } from '@/domain/types';
import { MATCH_SOURCE_LABEL, matchesForSource, nameOf, type MatchSource } from '@/domain/sharing';
import { useMatchStore } from '@/store/matchStore';
import { useShareStore } from '@/sync/shareStore';
import { useMetaStore } from '@/store/metaStore';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, Label, LoadingState, Notice, Panel, Select, Tabs } from '../ui/primitives';
import { TrendLine } from './TrendLine';
import { TeamsSection } from './TeamsSection';
import { TrendsSection } from './TrendsSection';
import { cn } from '../ui/styles';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions').sort((a, b) => b.start.localeCompare(a.start));

/** Refresh only makes sense where a newer deploy can exist: the hosted web app (not the desktop app). */
const CAN_REFRESH = typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window) && /^https?:$/.test(location.protocol);

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
 * abilities, spreads and teammates. Always shows something: usage data built into the app (Smogon's
 * monthly stats or the hand-maintained file; before Smogon has a month of a regulation, early
 * estimates from tournament team lists, Showdown replays or the previous regulation, labelled as
 * such), your own logged matches, or a clear "no data yet".
 */
export function MetaView({ dex, format }: { dex: Dex; format: FormatRules }) {
  const [regId, setRegId] = useState(format.regulationId && champRegs.some((r) => r.id === format.regulationId) ? format.regulationId : (currentRegulation()?.id ?? champRegs[0]?.id ?? ''));
  const refreshed = useMetaStore((s) => s.refreshed);
  const status = useMetaStore((s) => s.status);
  const error = useMetaStore((s) => s.error);
  const refresh = useMetaStore((s) => s.refresh);
  const matches = useMatchStore((s) => s.matches);
  const online = useOnline();
  const [tab, setTab] = useState<'usage' | 'trends' | 'teams'>('usage');
  const [period, setPeriod] = useState<TrendPeriod>(7);
  const history = useMetaHistory(regId);

  const metaFor = useMetaFor();
  const built = useMemo(() => metaFor?.(regId), [regId, metaFor]);
  // The previous regulation's numbers are only a stand-in: your own matches of this one beat them,
  // unless you ask for the carry-over.
  const [preferCarryOver, setPreferCarryOver] = useState(false);
  const carryOver = built && metaSourceKind(built) === 'carryover' ? built : undefined;
  // The player's own log, or (when a friend shares theirs) theirs or both of ours.
  const theirs = useShareStore((s) => s.matches);
  const names = useShareStore((s) => s.names);
  const [source, setSource] = useState<MatchSource>('mine');
  const effectiveSource = theirs.length ? source : 'mine';
  const personal = useMemo(
    () => (!metaFor || (built && !carryOver) ? null : localMetaFromMatches(
            matchesForSource(Object.values(matches), theirs, effectiveSource),
            regId,
            undefined,
            effectiveSource === 'mine' ? undefined : effectiveSource === 'both' ? 'Both our logged matches' : `${nameOf(theirs[0].owner, names)}'s logged matches`,
          )),
    [metaFor, built, carryOver, matches, theirs, effectiveSource, regId, names],
  );
  const published = carryOver && personal && !preferCarryOver ? undefined : built;
  const snapshot = published ?? personal ?? undefined;
  const basedOn = champRegs.find((r) => r.id === carryOver?.source.basedOn);
  const reg = champRegs.find((r) => r.id === regId);
  // Newest other regulation that has published numbers, offered when this one has none.
  const withData = useMemo(() => (published ? undefined : champRegs.find((r) => r.id !== regId && metaFor?.(r.id))), [published, regId, metaFor]);

  return (
    <div className="space-y-3">
      <Panel bodyClassName="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
        <Select aria-label="Regulation" className="w-full sm:w-auto" value={regId} onChange={(e) => { setRegId(e.target.value); setPreferCarryOver(false); }}>
          {champRegs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
        {!published && personal && theirs.length > 0 && (
          <Select aria-label="Whose matches the numbers come from" className="w-full sm:w-auto" value={effectiveSource} onChange={(e) => setSource(e.target.value as MatchSource)}>
            {(Object.keys(MATCH_SOURCE_LABEL) as MatchSource[]).map((k) => (
              <option key={k} value={k}>
                {k === 'theirs' ? `${nameOf(theirs[0].owner, names)}'s matches` : k === 'mine' ? 'My matches' : 'Both of us'}
              </option>
            ))}
          </Select>
        )}
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
      {published && !isProvisional(published) && metaAgeDays(published) > META_STALE_DAYS && (
        <Notice icon={AlertTriangle} title={`These numbers are ${metaAgeDays(published)} days old`}>
          They describe play up to {fmtDate(metaDataDate(published))}. Newer usage statistics haven’t been published or built into the app yet.
        </Notice>
      )}
      {published && isProvisional(published) && <ProvisionalNotice snapshot={published} regName={reg?.shortName} basedOnName={basedOn?.shortName} />}
      {!published && personal && (
        <Notice icon={BarChart3} tone="accent" title={`No published usage data for ${reg?.shortName ?? 'this regulation'} yet`}>
          Showing what you’ve faced in your own {personal.source.battles} logged matches instead.
          {carryOver && (
            <>
              {' '}
              <button type="button" className="font-semibold underline underline-offset-2" onClick={() => setPreferCarryOver(true)}>
                Show {basedOn?.shortName ?? 'the previous regulation'}’s usage instead
              </button>
            </>
          )}
        </Notice>
      )}

      {(published || reg) && (
        <Tabs<'usage' | 'trends' | 'teams'>
          label="Meta view"
          size="sm"
          className="w-fit"
          tabs={[{ id: 'usage', label: 'Usage' }, ...(published && (metaSourceKind(published) === 'ingame' || metaSourceKind(published) === 'smogon') ? [{ id: 'trends' as const, label: 'Trends' }] : []), { id: 'teams', label: 'Teams' }]}
          value={tab === 'trends' && !(published && (metaSourceKind(published) === 'ingame' || metaSourceKind(published) === 'smogon')) ? 'usage' : tab}
          onChange={setTab}
        />
      )}

      {tab === 'teams' ? (
        <TeamsSection regulationId={regId} snapshot={published} />
      ) : tab === 'trends' && published && (metaSourceKind(published) === 'ingame' || metaSourceKind(published) === 'smogon') ? (
        <TrendsSection regulationId={regId} dex={dex} format={format} sourceName={published.source.name} />
      ) : !metaFor ? (
        <LoadingState label="Loading usage data…" />
      ) : !snapshot ? (
        <EmptyState
          icon={BarChart3}
          title={`No usage data for ${reg?.shortName ?? 'this regulation'} yet`}
          action={withData && <Button onClick={() => setRegId(withData.id)}>See {withData.shortName}</Button>}
        >
          Early numbers from tournaments and Showdown replays appear within days of a regulation starting, and Smogon’s usage statistics after
          its first month; the app picks them up with its next update. Meanwhile, log matches on the Match log to see what you face most.
        </EmptyState>
      ) : (
        <>
        {history && history.length > 1 && (
          <div className="flex items-center gap-2 text-sm text-muted">
            Trend line period
            <Tabs<string> label="Trend line period" size="sm" tabs={TREND_PERIODS.map((p) => ({ id: String(p), label: p === 'season' ? 'Season' : `${p} d` }))} value={String(period)} onChange={(id) => setPeriod(id === 'season' ? 'season' : (Number(id) as TrendPeriod))} />
          </div>
        )}
        <ol className="grid gap-3 lg:grid-cols-2" aria-label={`Most used Pokémon in ${reg?.shortName ?? regId}`}>
          {snapshot.entries.map((e, i) => (
            <MetaCard key={e.speciesId} rank={e.usageRank ?? i + 1} entry={e} dex={dex} format={format} revealedOnly={metaSourceKind(snapshot) === 'replays'} history={published ? history : undefined} period={period} />
          ))}
        </ol>
        </>
      )}
    </div>
  );
}

function SourceLine({ snapshot }: { snapshot: MetaSnapshot }) {
  const s = snapshot.source;
  const kind = metaSourceKind(snapshot);
  const facts = [
    kind === 'carryover' && s.basedOn && `carried over from ${champRegs.find((r) => r.id === s.basedOn)?.shortName ?? s.basedOn}`,
    s.season && `ranked season ${s.season}`,
    s.month && fmtMonth(s.month),
    s.cutoff !== undefined && s.cutoff > 0 && `rating ${s.cutoff}+`,
    s.battles !== undefined && `${s.battles.toLocaleString()} ${kind === 'replays' ? 'games' : 'battles'}`,
    s.teams !== undefined && `${s.teams.toLocaleString()} teams${s.events ? ` from ${s.events.toLocaleString()} ${s.events === 1 ? 'event' : 'events'}` : ''}`,
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
      {isProvisional(snapshot) && kind !== 'matches' && <Chip>Provisional</Chip>} · {facts.join(' · ')}
    </p>
  );
}

/** What an early estimate is, and what it isn't, until Smogon publishes the regulation's first month. */
function ProvisionalNotice({ snapshot, regName = 'this regulation', basedOnName = 'the previous regulation' }: { snapshot: MetaSnapshot; regName?: string; basedOnName?: string }) {
  const kind = metaSourceKind(snapshot);
  const spreads = snapshot.entries.some((e) => e.spreadFrom) && ' Spreads aren’t part of this data: each one comes from an earlier regulation’s usage statistics, or is an estimate from base stats.';
  const until = ' It’s replaced by Smogon’s usage statistics once the first month of the regulation is published.';
  const body =
    kind === 'carryover'
      ? `No numbers for ${regName} yet, so these are ${basedOnName}’s, for the Pokémon, items and moves ${regName} still allows. Pokémon new to ${regName} aren’t in them.`
      : kind === 'replays'
        ? `Early numbers from ${snapshot.source.battles?.toLocaleString() ?? 'a sample of'} public Pokémon Showdown replays. Usage and teammates come from Team Preview; items, moves and abilities only count when the battle revealed them, so they read low.${spreads || ''}`
        : kind === 'tournaments'
          ? `Early numbers from ${snapshot.source.teams?.toLocaleString() ?? 'the'} open team lists of online tournaments.${spreads || ''}`
          : '';
  return (
    <Notice icon={BarChart3} tone="accent" title={`Provisional numbers for ${regName}`}>
      {body}
      {until}
    </Notice>
  );
}

function MetaCard({ rank, entry: e, dex, format, revealedOnly, history, period }: { rank: number; entry: MetaEntry; dex: Dex; format: FormatRules; revealedOnly?: boolean; history?: HistoryEntry[]; period: TrendPeriod }) {
  const seen = revealedOnly ? ' seen' : '';
  const spreadFrom = e.spreadFrom === 'estimate' ? 'estimate' : e.spreadFrom && (champRegs.find((r) => r.id === e.spreadFrom)?.shortName ?? e.spreadFrom);
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
        // Rank-only (in-game) data: the rank on the left is the whole story.
        actions={e.usagePct !== undefined ? <Chip tone="accent">{usageLabel(e)}</Chip> : undefined}
      >
        {history && history.length > 1 && <div className="mb-2"><TrendLine history={history} speciesId={e.speciesId} period={period} /></div>}
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <ShareList label={`Items${seen}`} rows={e.items.slice(0, 4)} render={(id) => <><ItemSprite itemId={id} name={name(id, 'item')} size={18} />{name(id, 'item')}</>} />
          <ShareList label={`Moves${seen}`} rows={e.moves.slice(0, 4)} render={(id) => name(id, 'move')} />
          {e.abilities.length > 0 && <ShareList label={`Abilities${seen}`} rows={e.abilities.slice(0, 2)} render={(id) => name(id, 'ability')} />}
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
              <Label>{e.spreadFrom === 'estimate' ? 'Spread (estimate from base stats)' : spreadFrom ? `Spread (${spreadFrom} usage statistics)` : 'Most common spread'}</Label>
              <p className="mt-1 font-mono text-xs">
                {e.spreads[0].nature} ·{' '}
                {STAT_IDS.map((k, i) => (e.spreads[0].values[i] ? `${e.spreads[0].values[i]} ${STAT_LABELS[k]}` : null))
                  .filter(Boolean)
                  .join(' / ') || 'no investment'}{' '}
                {e.spreadFrom !== 'estimate' && <span className="text-muted">({e.spreads[0].pct.toFixed(0)}%)</span>}
              </p>
            </div>
          )}
        </div>
      </Panel>
    </li>
  );
}

function ShareList({ label, rows, render }: { label: string; rows: { id: string; pct?: number; rank?: number }[]; render: (id: string) => ReactNode }) {
  if (!rows.length) return null;
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      <ul className="mt-1 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate">{render(r.id)}</span>
            <span className="w-10 shrink-0 text-right font-mono text-xs text-muted">{r.pct !== undefined ? `${r.pct.toFixed(0)}%` : r.rank !== undefined ? `#${r.rank}` : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
