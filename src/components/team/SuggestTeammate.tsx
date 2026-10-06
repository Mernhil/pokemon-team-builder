import { useState } from 'react';
import { Calculator, Plus, Search, Sparkles } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { defaultSide } from '@/domain/battle/conditions';
import { reasonChips, type Suggestion } from '@/domain/teamSuggest';
import type { FormatRules, Team } from '@/domain/types';
import { useCalcStore } from '@/store/calcStore';
import { useReverseSeed } from '@/store/reverseSeedStore';
import { useTeamStore } from '@/store/teamStore';
import { toast } from '@/store/toastStore';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, EmptyState, LoadingState, Notice } from '../ui/primitives';
import { useTeamSuggestions } from './useTeamSuggestions';

/**
 * "Suggest a teammate": the ten best Pokémon to fill the team's empty slots, each with up to three
 * reasons (what it covers that your team can't, how often it's paired with your members, which
 * threat it answers) and three actions. Opens on request: the damage checks only run once asked for.
 */
export function SuggestTeammate({ team, dex, format }: { team: Team; dex: Dex; format: FormatRules }) {
  const [open, setOpen] = useState(false);
  const members = team.slots.filter(Boolean).length;
  if (format.datasetId !== 'champions' || members === 0 || members >= 6) return null;
  return (
    <div className="space-y-2">
      <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Sparkles size={14} aria-hidden /> {open ? 'Hide teammate suggestions' : 'Suggest a teammate'}
      </Button>
      {open && <Panel team={team} dex={dex} format={format} />}
    </div>
  );
}

function Panel({ team, dex, format }: { team: Team; dex: Dex; format: FormatRules }) {
  const [includeAll, setIncludeAll] = useState(false);
  const { loading, suggestions, problems, done } = useTeamSuggestions({ dex, format, team, includeAll });
  const setView = useTeamStore((s) => s.setView);

  const add = (s: Suggestion) => {
    const slot = team.slots.findIndex((x) => x === null);
    if (slot < 0) return toast(`${team.name} is full.`);
    const set = { ...structuredClone(s.set), uid: crypto.randomUUID() };
    useTeamStore.getState().setSlot(team.id, slot, set);
    toast(`Added ${dex.species(s.speciesId)?.name ?? s.speciesId} to ${team.name}.`, { label: 'Undo', run: () => useTeamStore.getState().setSlot(team.id, slot, null) });
  };
  const openCalc = (s: Suggestion) => {
    const calc = useCalcStore.getState();
    calc.setSide('attacker', { set: s.set, cond: defaultSide(!!dex.megaFor(s.speciesId, s.set.itemId)), crits: [false, false, false, false] });
    setView('calc');
  };
  const reverse = (s: Suggestion) => {
    // Opens Reverse search asking for what this Pokémon is good at: one-shotting the threats that beat your team.
    useReverseSeed.getState().set({ kind: 'ohko', speciesIds: problems.map((p) => p.speciesId) });
    toast(`Reverse search opened: Pokémon that one-shot the threats that beat your team, like ${dex.species(s.speciesId)?.name ?? s.speciesId}.`);
    setView('reverse');
  };

  return (
    <section aria-label="Teammate suggestions" className="space-y-2 rounded-lg border border-border p-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
        Include every legal Pokémon <span className="text-xs text-muted">(not only those with usage data; generic build)</span>
      </label>
      {loading ? (
        <LoadingState label="Loading usage data…" />
      ) : suggestions.length === 0 ? (
        <EmptyState title="No suggestions">Nothing fits: there’s no usage data for this regulation, or every candidate is already on your team.</EmptyState>
      ) : (
        <>
          <p role="status" className="text-xs text-muted">
            {done ? `Top ${suggestions.length}${problems.length ? `, checked against ${problems.length} ${problems.length === 1 ? 'threat' : 'threats'} that beat your team` : ''}.` : 'Checking them against the threats that beat your team…'}
          </p>
          <ol className="space-y-2">
            {suggestions.map((s) => {
              const sp = dex.species(s.speciesId);
              return (
                <li key={s.speciesId} className="space-y-1.5 rounded-lg border border-border bg-surface p-2">
                  <div className="flex items-center gap-2">
                    <Sprite speciesId={s.speciesId} name={sp?.name} types={sp?.types} set={format.spriteSet} size={40} />
                    <b className="min-w-0 flex-1 truncate text-sm">{sp?.name ?? s.speciesId}</b>
                    {s.build === 'default' && <Chip>generic build</Chip>}
                  </div>
                  <ul className="flex flex-wrap gap-1.5" aria-label="Why">
                    {reasonChips(s).map((r) => (
                      <li key={r}>
                        <Chip tone="accent">{r}</Chip>
                      </li>
                    ))}
                    {reasonChips(s).length === 0 && <li className="text-xs text-muted">No standout reason: a safe, popular pick.</li>}
                  </ul>
                  {s.notes.map((n) => (
                    <p key={n} className="text-xs text-warn">{n}</p>
                  ))}
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" onClick={() => add(s)} aria-label={`Add ${sp?.name ?? s.speciesId} to the team`}>
                      <Plus size={13} aria-hidden /> Add to team
                    </Button>
                    <Button size="sm" onClick={() => openCalc(s)} aria-label={`Open ${sp?.name ?? s.speciesId} in Calc`}>
                      <Calculator size={13} aria-hidden /> Open in Calc
                    </Button>
                    <Button size="sm" onClick={() => reverse(s)} aria-label={`Find more like ${sp?.name ?? s.speciesId} in Reverse search`}>
                      <Search size={13} aria-hidden /> Find in Reverse search
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          {team.slots.some((x) => x === null) ? null : <Notice tone="accent">The team is full.</Notice>}
        </>
      )}
    </section>
  );
}
