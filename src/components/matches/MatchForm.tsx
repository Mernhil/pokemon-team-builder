import { useMemo, useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { REGULATION_MANIFEST } from '@/domain/formats';
import { ARCHETYPE_PRESETS, CATEGORY_PRESETS, bringLimits, cloneOpponentTeam, matchCapabilities, normalizeBring, suggestRegulationForDate, type BringSelection, type LoggedMon, type Match, type MatchResult } from '@/domain/matches';
import { coreOverlapScore } from '@/domain/meta';
import type { FormatRules } from '@/domain/types';
import { useMatchStore } from '@/store/matchStore';
import { useMetaFor } from '@/data/useMeta';
import { useTeamStore } from '@/store/teamStore';
import { BringPicker, type RosterMon } from './BringPicker';
import { sourcesFromLog } from '@/domain/bringPlanner';
import { BringPlanner } from './BringPlanner';
import { LoggedMonEditor } from './LoggedMonEditor';
import { Button, Field, Input, Panel, Select, TextArea } from '../ui/primitives';
import { cn } from '../ui/styles';

const champRegs = REGULATION_MANIFEST.regulations.filter((r) => r.game === 'champions').sort((a, b) => b.start.localeCompare(a.start));

/** Add/edit form for one logged match. Every field beyond date + result is optional. */
export function MatchForm({ dex, format, match, onDone }: { dex: Dex; format: FormatRules; match: Match; onDone?: () => void }) {
  const { updateMatch, deleteMatch, duplicateAsTemplate } = useMatchStore.getState();
  const matchesById = useMatchStore((s) => s.matches);
  const order = useMatchStore((s) => s.order);
  const allMatches = useMemo(() => order.map((id) => matchesById[id]).filter(Boolean), [order, matchesById]);
  const teams = useTeamStore((s) => s.teams);
  const teamOrder = useTeamStore((s) => s.order);
  const [myMode, setMyMode] = useState<'saved' | 'freeform'>(match.myTeamId ? 'saved' : 'freeform');
  const [planning, setPlanning] = useState(false);

  const set = (patch: Partial<Match>) => updateMatch(match.id, patch);
  const tera = matchCapabilities(match.regulationId).tera;

  const setDate = (date: string) => set({ date, regulationId: match.regulationId ?? suggestRegulationForDate(date) });

  const addOpponentMon = () => {
    if (match.opponentTeam.length >= 6) return;
    set({ opponentTeam: [...match.opponentTeam, { speciesId: '' }] });
  };
  /** The opponent's brought/led, kept in step with who is on their team. */
  const oppBring = (team: LoggedMon[]) => {
    const roster = team.map((x) => x.speciesId).filter(Boolean);
    return normalizeBring({ brought: match.oppBrought ?? [], leads: match.oppLeads ?? [] }, roster, limits);
  };
  const withOppBring = (team: LoggedMon[]): Partial<Match> => {
    const b = oppBring(team);
    return { opponentTeam: team, oppBrought: b.brought.length ? b.brought : undefined, oppLeads: b.leads.length ? b.leads : undefined };
  };
  const updateOpponentMon = (i: number, m: LoggedMon) => {
    const next = [...match.opponentTeam];
    next[i] = m;
    set(withOppBring(next));
  };
  const removeOpponentMon = (i: number) => set(withOppBring(match.opponentTeam.filter((_, idx) => idx !== i)));

  const limits = bringLimits(match.regulationId);
  const myTeam = match.myTeam ?? [];
  const savedTeam = match.myTeamId ? teams[match.myTeamId] : undefined;
  // What I can bring: a saved team's Pokémon (by uid) or the run-and-gun list (by species).
  const myRoster: RosterMon[] =
    myMode === 'saved'
      ? (savedTeam?.slots.flatMap((s) => (s ? [{ id: s.uid, speciesId: s.speciesId }] : [])) ?? [])
      : [...new Map(myTeam.filter((x) => x.speciesId).map((x) => [x.speciesId, { id: x.speciesId, speciesId: x.speciesId }])).values()];
  const mySel = normalizeBring({ brought: match.myBrought ?? [], leads: match.myLeads ?? [] }, myRoster.map((r) => r.id), limits);
  const oppRoster: RosterMon[] = [...new Set(match.opponentTeam.map((x) => x.speciesId).filter(Boolean))].map((id) => ({ id, speciesId: id }));
  const oppSel = oppBring(match.opponentTeam);
  const setMyBring = (b: BringSelection) => set({ myBrought: b.brought.length ? b.brought : undefined, myLeads: b.leads.length ? b.leads : undefined });
  const setOppBring = (b: BringSelection) => set({ oppBrought: b.brought.length ? b.brought : undefined, oppLeads: b.leads.length ? b.leads : undefined });
  const addMyMon = () => {
    if (myTeam.length >= 6) return;
    set({ myTeam: [...myTeam, { speciesId: '' }] });
  };
  const withMyTeam = (team: LoggedMon[]): Partial<Match> => {
    const b = normalizeBring({ brought: match.myBrought ?? [], leads: match.myLeads ?? [] }, team.map((x) => x.speciesId), limits);
    return { myTeam: team, myBrought: b.brought.length ? b.brought : undefined, myLeads: b.leads.length ? b.leads : undefined };
  };
  const updateMyMon = (i: number, m: LoggedMon) => {
    const next = [...myTeam];
    next[i] = m;
    set(withMyTeam(next));
  };
  const removeMyMon = (i: number) => set(withMyTeam(myTeam.filter((_, idx) => idx !== i)));

  const priorOpponents = allMatches.filter((m) => m.id !== match.id && m.opponentTeam.length > 0);

  // Optional cross-reference: flag when this opponent's Team Preview overlaps a popular core from
  // the Meta tab's usage data for that regulation (when there is any).
  const metaFor = useMetaFor();
  const metaSnapshot = useMemo(() => (match.regulationId ? metaFor?.(match.regulationId) : undefined), [match.regulationId, metaFor]);
  const knownCore = useMemo(() => {
    if (!metaSnapshot || match.opponentTeam.length < 2) return null;
    const species = match.opponentTeam.map((m) => m.speciesId).filter(Boolean);
    let best: { speciesId: string; score: number } | null = null;
    for (const e of metaSnapshot.entries) {
      const score = coreOverlapScore(species, e);
      if (score >= 0.5 && (!best || score > best.score)) best = { speciesId: e.speciesId, score };
    }
    return best;
  }, [metaSnapshot, match.opponentTeam]);

  return (
    <Panel
      title={`${match.date} · ${match.result === 'win' ? 'Win' : 'Loss'}`}
      actions={
        <Button size="sm" variant="danger" onClick={() => deleteMatch(match.id)}>
          <Trash2 size={13} /> Delete
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Field label="Date">
            <Input type="date" value={match.date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Result">
            <Select value={match.result} onChange={(e) => set({ result: e.target.value as MatchResult })}>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
            </Select>
          </Field>
          <Field label="Regulation" hint="auto-suggested, editable">
            <Select value={match.regulationId ?? ''} onChange={(e) => set({ regulationId: e.target.value || undefined })}>
              <option value="">—</option>
              {champRegs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.shortName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" hint="optional">
            <Input list="match-categories" value={match.category ?? ''} onChange={(e) => set({ category: e.target.value || undefined })} placeholder="Ranked, tournament…" />
            <datalist id="match-categories">
              {CATEGORY_PRESETS.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
        </div>

        <Field label="Event / opponent" hint="optional">
          <Input value={match.eventName ?? ''} onChange={(e) => set({ eventName: e.target.value || undefined })} placeholder="Locals R3, an opponent's handle…" />
        </Field>

        {priorOpponents.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">Clone opponent from:</span>
            {priorOpponents.slice(0, 5).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => set({ opponentTeam: cloneOpponentTeam(m.opponentTeam), opponentArchetype: m.opponentArchetype })}
                className="flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 hover:border-accent"
              >
                <Copy size={10} /> {m.date}
                {m.eventName ? ` · ${m.eventName}` : ''}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">My team</span>
              <div className="flex rounded-md bg-surface-2 p-0.5 text-xs">
                <button type="button" onClick={() => { setMyMode('saved'); set({ myTeam: undefined, myBrought: undefined, myLeads: undefined }); }} className={cn('rounded px-2 py-0.5', myMode === 'saved' ? 'bg-surface shadow-sm' : 'text-muted')}>
                  Saved team
                </button>
                <button type="button" onClick={() => { setMyMode('freeform'); set({ myTeamId: undefined, myBrought: undefined, myLeads: undefined }); }} className={cn('rounded px-2 py-0.5', myMode === 'freeform' ? 'bg-surface shadow-sm' : 'text-muted')}>
                  Run and gun
                </button>
              </div>
            </div>
            {myMode === 'saved' ? (
              <Select aria-label="My saved team" value={match.myTeamId ?? ''} onChange={(e) => set({ myTeamId: e.target.value || undefined, myBrought: undefined, myLeads: undefined })}>
                <option value="">— pick a saved team —</option>
                {teamOrder.map((id) => (
                  <option key={id} value={id}>
                    {teams[id]?.name}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="space-y-1.5">
                {myTeam.map((m, i) => (
                  <LoggedMonEditor key={i} dex={dex} format={format} tera={tera} mon={m} onChange={(next) => updateMyMon(i, next)} onRemove={() => removeMyMon(i)} />
                ))}
                {myTeam.length < 6 && (
                  <Button size="sm" onClick={addMyMon}>
                    <Plus size={13} /> Add Pokémon
                  </Button>
                )}
              </div>
            )}
            <BringPicker dex={dex} format={format} label="I brought" roster={myRoster} value={mySel} limits={limits} onChange={setMyBring} />
            <Field label="My archetype" hint="optional · freeform">
              <Input list="archetype-presets" value={match.myArchetype ?? ''} onChange={(e) => set({ myArchetype: e.target.value || undefined })} placeholder="Trick Room, Rain…" />
            </Field>
          </div>

          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Opponent (Team Preview)</span>
            {knownCore && (
              <p className="rounded-md bg-accent/10 px-2 py-1 text-xs text-accent">
                Overlaps a known popular core built around {dex.species(knownCore.speciesId)?.name ?? knownCore.speciesId} (see the Meta tab).
              </p>
            )}
            <div className="space-y-1.5">
              {match.opponentTeam.map((m, i) => (
                <LoggedMonEditor key={i} dex={dex} format={format} tera={tera} mon={m} onChange={(next) => updateOpponentMon(i, next)} onRemove={() => removeOpponentMon(i)} />
              ))}
              {match.opponentTeam.length < 6 && (
                <Button size="sm" onClick={addOpponentMon}>
                  <Plus size={13} /> Add Pokémon
                </Button>
              )}
            </div>
            <BringPicker dex={dex} format={format} label="They brought" roster={oppRoster} value={oppSel} limits={limits} onChange={setOppBring} />
            <Field label="Opponent archetype" hint="optional · freeform">
              <Input list="archetype-presets" value={match.opponentArchetype ?? ''} onChange={(e) => set({ opponentArchetype: e.target.value || undefined })} placeholder="Trick Room, Rain…" />
            </Field>
          </div>
        </div>
        <datalist id="archetype-presets">
          {ARCHETYPE_PRESETS.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>

        <Field label="Notes" hint="optional">
          <TextArea rows={2} value={match.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} placeholder="Anything worth remembering about this game…" />
        </Field>

        {planning && savedTeam && <BringPlanner dex={dex} format={format} team={savedTeam} matchId={match.id} initialOpponent={sourcesFromLog(match.opponentTeam)} />}

        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" onClick={() => setPlanning((p) => !p)} disabled={!savedTeam} title={!savedTeam ? 'Pick one of your saved teams first' : undefined}>
            {planning ? 'Hide the plan' : 'Plan vs this team'}
          </Button>
          <Button size="sm" onClick={() => duplicateAsTemplate(match.id)}>
            <Copy size={13} /> Log another match against this same opponent
          </Button>
          {onDone && (
            <Button size="sm" variant="primary" onClick={onDone}>
              Done
            </Button>
          )}
        </div>
      </div>
    </Panel>
  );
}
