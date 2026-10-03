import { useMemo, useState } from 'react';
import { Check, ClipboardPaste, Plus, Swords, X } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { metaFor } from '@/data/meta';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { importShowdown } from '@/domain/codecs';
import { bringLimits } from '@/domain/matches';
import { planBring, planToMatchPatch, resolveOpponent, sourcesFromLog, sourcesFromTeam, type OppSource, type Plan } from '@/domain/bringPlanner';
import { pickSpeedSnapshot } from '@/domain/speedTiers';
import type { FormatRules, Team } from '@/domain/types';
import { useMatchStore } from '@/store/matchStore';
import { useMetaStore } from '@/store/metaStore';
import { toast } from '@/store/toastStore';
import { SpeciesPicker } from '../editor/SpeciesPicker';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, Label, Panel, Select, TextArea } from '../ui/primitives';
import { cn } from '../ui/styles';

const champRegIds = REGULATION_MANIFEST.regulations
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => r.id);

/**
 * "Plan vs this team": which four to bring and which two to lead, from my saved team against the
 * opponent's six. A suggestion, not a prediction. The opponent can be typed in as species, pasted
 * as a Showdown team, taken from a logged match or an enemy team; their sets come from the most-used
 * sets unless more is known. "Use this plan" saves what I bring and lead onto a match.
 */
export function BringPlanner({
  dex,
  format,
  team,
  matchId,
  initialOpponent = [],
}: {
  dex: Dex;
  format: FormatRules;
  /** My saved team (its Pokémon uids are what the match log stores). */
  team: Team;
  /** A match being logged: "Use this plan" saves onto it. Without one, a new match is created. */
  matchId?: string;
  initialOpponent?: OppSource[];
}) {
  const refreshed = useMetaStore((s) => s.refreshed);
  const matchesById = useMatchStore((s) => s.matches);
  const order = useMatchStore((s) => s.order);
  const [opps, setOpps] = useState<OppSource[]>(initialOpponent.slice(0, 6));
  const [pasted, setPasted] = useState('');
  const [pasteMsg, setPasteMsg] = useState('');
  const [adding, setAdding] = useState<string | undefined>();
  const [saved, setSaved] = useState<number | null>(null);

  const limits = bringLimits(format.regulationId);
  const picked = useMemo(
    () => (format.datasetId === 'champions' ? pickSpeedSnapshot(format.regulationId, champRegIds, (id) => metaFor(id, refreshed)) : undefined),
    [format.datasetId, format.regulationId, refreshed],
  );
  const mine = useMemo(() => team.slots.flatMap((s) => (s ? [{ uid: s.uid, set: s }] : [])), [team.slots]);
  const resolved = useMemo(
    () => opps.flatMap((o) => resolveOpponent(dex, format, o.speciesId, { known: o.known, full: o.full, snapshot: picked?.snapshot }) ?? []),
    [opps, dex, format, picked],
  );
  const result = useMemo(
    () => (mine.length && resolved.length ? planBring({ dex, format, mine, opponents: resolved, limits }) : null),
    [dex, format, mine, resolved, limits],
  );
  const logs = useMemo(() => order.map((id) => matchesById[id]).filter((m) => m && m.opponentTeam.length > 0 && m.id !== matchId), [order, matchesById, matchId]);

  if (format.datasetId !== 'champions') {
    return (
      <EmptyState icon={Swords} title="The bring planner needs meta usage data, which only exists for Champions">
        Switch the team’s format to a Champions regulation to plan which Pokémon to bring.
      </EmptyState>
    );
  }

  const add = (id: string) => {
    if (opps.length >= 6 || opps.some((o) => o.speciesId === id)) return;
    setOpps([...opps, { speciesId: id }]);
    setAdding(undefined);
  };
  const loadPasted = () => {
    try {
      const { team: t, warnings } = importShowdown(pasted, dex, format);
      const sources = sourcesFromTeam(t);
      if (!sources.length) throw new Error(warnings[0] ?? 'No Pokémon found in the pasted text.');
      setOpps(sources.slice(0, 6));
      setPasteMsg(warnings.length ? `Loaded ${sources.length} Pokémon. ${warnings[0]}` : `Loaded ${sources.length} Pokémon.`);
    } catch (e) {
      setPasteMsg((e as Error).message);
    }
  };

  const applyPlan = (plan: Plan, i: number) => {
    const { addMatch, updateMatch } = useMatchStore.getState();
    const patch = planToMatchPatch(plan, team.id);
    if (matchId) updateMatch(matchId, patch);
    else {
      const id = addMatch();
      updateMatch(id, {
        ...patch,
        regulationId: format.regulationId,
        opponentTeam: opps.map((o) => ({ speciesId: o.speciesId, ...(o.known ?? {}), ...(o.full ? { itemId: o.full.itemId, abilityId: o.full.abilityId, moves: o.full.moves.filter(Boolean) } : {}) })),
      });
    }
    setSaved(i);
    toast(matchId ? 'Saved what you bring and lead onto this match.' : 'Saved a new match with this plan to your match log.');
  };

  const nameOf = (id: string) => dex.species(id)?.name ?? id;
  const byUid = new Map(mine.map((m) => [m.uid, m.set]));

  return (
    <Panel title="Plan vs this team" actions={<Chip>A suggestion, not a prediction</Chip>}>
      <div className="space-y-4">
        <section aria-label="Their team" className="space-y-2">
          <Label>Their six ({resolved.length}/6)</Label>
          <ul className="flex flex-wrap gap-1.5">
            {resolved.map((o) => (
              <li key={o.speciesId} className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 py-0.5 pr-1 pl-1">
                <Sprite speciesId={o.speciesId} name={nameOf(o.speciesId)} types={dex.species(o.speciesId)?.types} set={format.spriteSet} size={26} />
                <span className="text-xs font-semibold">{nameOf(o.speciesId)}</span>
                <span className="text-[11px] text-muted">{o.known === 'full' ? 'full set' : o.known === 'partial' ? 'some known' : 'meta set'}</span>
                <button type="button" aria-label={`Remove ${nameOf(o.speciesId)}`} onClick={() => setOpps(opps.filter((x) => x.speciesId !== o.speciesId))} className="rounded-full p-1 text-muted hover:text-bad pointer-coarse:p-2.5">
                  <X size={13} aria-hidden />
                </button>
              </li>
            ))}
            {resolved.length === 0 && <li className="text-sm text-muted">Add their Pokémon below, paste their team, or load a logged match.</li>}
          </ul>
          {opps.length < 6 && (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SpeciesPicker dex={dex} format={format} value={adding} onChange={(id) => add(id)} showGenFilter={false} placeholder="Add one of their Pokémon…" />
              </div>
              <Plus size={14} className="shrink-0 text-muted" aria-hidden />
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <TextArea aria-label="Their team as Showdown text" rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste their team (Showdown text)…" className="font-mono text-xs" />
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={loadPasted} disabled={!pasted.trim()}>
                  <ClipboardPaste size={13} aria-hidden /> Load pasted team
                </Button>
                {pasteMsg && (
                  <span role="status" className="text-xs text-muted">
                    {pasteMsg}
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Select
                aria-label="Load a logged match's opponent"
                value=""
                onChange={(e) => {
                  const m = matchesById[e.target.value];
                  if (m) setOpps(sourcesFromLog(m.opponentTeam).slice(0, 6));
                }}
              >
                <option value="">From a logged match…</option>
                {logs.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.date} · {m.opponentTeam.map((x) => nameOf(x.speciesId)).join(', ')}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </section>

        {mine.length === 0 && <p className="text-sm text-muted">Your team has no Pokémon yet.</p>}
        {picked?.fellBackFrom && (
          <p className="text-xs text-muted">
            No usage data for the live regulation yet: unknown sets use the newest published one ({champRegIds.includes(picked.regulationId) ? REGULATION_MANIFEST.regulations.find((r) => r.id === picked.regulationId)?.shortName : picked.regulationId}).
          </p>
        )}

        {result && result.plans.length > 0 && (
          <section aria-label="Suggested plans" className="space-y-3">
            <p className="text-xs text-muted">
              Bring {limits.bring}, lead {limits.lead}. They would probably bring: <b className="text-fg">{result.likelyBring.map(nameOf).join(', ')}</b> (the {result.likelyBring.length} most dangerous to your team).
            </p>
            <ol className="space-y-3">
              {result.plans.map((plan, i) => (
                <li key={plan.brought.join()} className="rounded-xl border border-border bg-surface-2 p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Plan {i + 1}</h3>
                    <Button variant="primary" size="sm" onClick={() => applyPlan(plan, i)} aria-label={`Use plan ${i + 1}`}>
                      {saved === i ? <Check size={14} aria-hidden /> : null} {saved === i ? 'Saved' : 'Use this plan'}
                    </Button>
                  </div>
                  <ul aria-label={`Plan ${i + 1} Pokémon`} className="mb-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                    {[...plan.brought, ...plan.back].map((uid) => {
                      const set = byUid.get(uid)!;
                      const sp = dex.species(set.speciesId);
                      const lead = plan.leads.includes(uid);
                      const back = plan.back.includes(uid);
                      return (
                        <li key={uid} className={cn('flex flex-col items-center gap-0.5 rounded-lg border p-1.5 text-center', lead ? 'border-accent bg-accent/15' : back ? 'border-dashed border-border' : 'border-border-strong bg-surface')}>
                          <Sprite speciesId={set.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={34} />
                          <span className="w-full truncate text-xs font-semibold">{sp?.name}</span>
                          <span className="text-[11px] font-semibold text-fg">{lead ? '★ Lead' : back ? 'Back' : 'Brought'}{plan.mega === uid ? ' · Mega' : ''}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm">
                    {plan.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-sm">
                    <b>Main risk:</b> <span className="text-muted">{plan.risk}</span>
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </Panel>
  );
}
