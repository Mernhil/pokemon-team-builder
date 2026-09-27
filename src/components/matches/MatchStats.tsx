import { useMemo } from 'react';
import type { Dex } from '@/data/dex';
import { regulationInfo } from '@/domain/formats';
import {
  lossesOnly,
  opponentCoreFrequency,
  opponentSpeciesFrequency,
  overallWinRate,
  winRateByArchetype,
  winRateByRegulation,
  winRateByTeam,
  type Match,
  type WinRate,
} from '@/domain/matches';
import { useTeamStore } from '@/store/teamStore';
import { Panel, cn } from '../ui/primitives';

const pct = (r: WinRate) => `${Math.round(r.rate * 100)}%`;

function WinRateRow({ label, r }: { label: string; r: WinRate }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 shrink-0 truncate">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className={cn('h-full', r.rate >= 0.5 ? 'bg-good' : 'bg-bad')} style={{ width: `${r.rate * 100}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right font-mono text-muted">
        {r.wins}-{r.losses} · {pct(r)}
      </span>
    </div>
  );
}

/** Win rate, personal-meta frequency, and loss review — the report views over the logged matches. */
export function MatchStats({ dex, matches }: { dex: Dex; matches: Match[] }) {
  const teams = useTeamStore((s) => s.teams);
  const overall = useMemo(() => overallWinRate(matches), [matches]);
  const byReg = useMemo(() => winRateByRegulation(matches), [matches]);
  const byTeam = useMemo(() => winRateByTeam(matches), [matches]);
  const byArch = useMemo(() => winRateByArchetype(matches), [matches]);
  const speciesFreq = useMemo(() => [...opponentSpeciesFrequency(matches).entries()].sort((a, b) => b[1] - a[1]).slice(0, 15), [matches]);
  const coreFreq = useMemo(() => [...opponentCoreFrequency(matches).entries()].sort((a, b) => b[1] - a[1]).slice(0, 10), [matches]);
  const losses = useMemo(() => lossesOnly(matches), [matches]);

  if (!matches.length) return <Panel title="Report">Log a match to see win rate and opponent frequency reports here.</Panel>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title={`Overall: ${overall.wins}-${overall.losses} (${pct(overall)})`}>
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">By regulation</p>
            <div className="space-y-1">
              {[...byReg.entries()].map(([id, r]) => (
                <WinRateRow key={id} label={id === '—' ? 'No regulation' : (regulationInfo(id)?.shortName ?? id)} r={r} />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">By saved team</p>
            <div className="space-y-1">
              {[...byTeam.entries()].map(([id, r]) => (
                <WinRateRow key={id} label={teams[id]?.name ?? 'Deleted team'} r={r} />
              ))}
              {byTeam.size === 0 && <p className="text-xs text-muted">No matches tied to a saved team yet.</p>}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">By my archetype</p>
            <div className="space-y-1">
              {[...byArch.entries()].map(([a, r]) => (
                <WinRateRow key={a} label={a} r={r} />
              ))}
              {byArch.size === 0 && <p className="text-xs text-muted">No archetype tags yet.</p>}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Personal meta snapshot">
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Most-seen opponent species</p>
            <div className="space-y-1">
              {speciesFreq.map(([id, n]) => (
                <div key={id} className="flex items-center justify-between text-xs">
                  <span>{dex.species(id)?.name ?? id}</span>
                  <span className="font-mono text-muted">×{n}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Most-seen cores (species pairs)</p>
            <div className="space-y-1">
              {coreFreq.map(([key, n]) => {
                const [a, b] = key.split('+');
                return (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span>
                      {dex.species(a)?.name ?? a} + {dex.species(b)?.name ?? b}
                    </span>
                    <span className="font-mono text-muted">×{n}</span>
                  </div>
                );
              })}
              {coreFreq.length === 0 && <p className="text-xs text-muted">Log a few more matches to surface repeat cores.</p>}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title={`Losses (${losses.length})`} className="lg:col-span-2">
        {losses.length === 0 ? (
          <p className="text-xs text-muted">No losses logged — nice.</p>
        ) : (
          <div className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto">
            {losses.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-2 py-1 text-xs">
                <span className="font-mono text-muted">{m.date}</span>
                {m.opponentArchetype && <span className="rounded-full bg-bad/15 px-1.5 py-0.5 text-bad">{m.opponentArchetype}</span>}
                <span className="min-w-0 flex-1 truncate">{m.opponentTeam.map((o) => dex.species(o.speciesId)?.name ?? o.speciesId).join(' / ') || '—'}</span>
                {m.eventName && <span className="text-muted">{m.eventName}</span>}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
