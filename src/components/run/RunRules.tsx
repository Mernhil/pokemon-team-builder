import { useState } from 'react';
import { Checkbox, Input, Panel, Select, TextArea } from '../ui/primitives';
import { type LevelCapMode, type Run, type RunRules } from '@/domain/runs';
import { useRunStore } from '@/store/runStore';

const CHECKS: { key: keyof Pick<RunRules, 'nuzlocke' | 'firstEncounter' | 'dupes' | 'shiny' | 'species'>; label: string; hint: string }[] = [
  { key: 'nuzlocke', label: 'Nuzlocke rules', hint: 'Fainted Pokémon are dead for good; the rest of the rules below apply.' },
  { key: 'firstEncounter', label: 'First encounter per area', hint: 'Only the first wild Pokémon in each area counts. Gifts and trades are separate.' },
  { key: 'dupes', label: 'Dupes clause', hint: 'If the first encounter is an evolution line you already caught, you may re-roll.' },
  { key: 'shiny', label: 'Shiny clause', hint: 'A shiny may be caught even if the area’s encounter is used.' },
  { key: 'species', label: 'Species clause', hint: 'No two Pokémon of the same evolution line in the party.' },
];

/** The run's rules, its name, and its notes. Changes apply from now on; nothing already logged is rewritten. */
export function RunRules({ run }: { run: Run }) {
  const { setRules, rename } = useRunStore.getState();
  const [name, setName] = useState(run.name);
  return (
    <div className="space-y-3">
      <Panel title="Rules" bodyClassName="space-y-2 p-3">
        {CHECKS.map((c) => (
          <label key={c.key} className="flex min-h-9 items-start gap-2 text-sm pointer-coarse:min-h-11">
            <Checkbox className="mt-0.5" checked={run.rules[c.key]} onChange={(e) => setRules(run.id, { [c.key]: e.target.checked })} />
            <span>
              <b>{c.label}</b> <span className="text-muted">{c.hint}</span>
            </span>
          </label>
        ))}
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Level caps
          <Select value={run.rules.levelCaps} onChange={(e) => setRules(run.id, { levelCaps: e.target.value as LevelCapMode })} className="max-w-xs">
            <option value="off">Off</option>
            <option value="soft">Soft: warn when a Pokémon is over the next cap</option>
            <option value="hard">Hard: over the cap means it stays in the box</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Your own rules and notes
          <TextArea rows={4} maxLength={2000} value={run.rules.notes} onChange={(e) => setRules(run.id, { notes: e.target.value })} placeholder="No items in battle, nicknames required…" />
        </label>
      </Panel>
      <Panel title="Run name" bodyClassName="p-3">
        <form
          className="flex max-w-sm gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            rename(run.id, name);
          }}
        >
          <Input aria-label="Run name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onBlur={() => rename(run.id, name)} />
        </form>
      </Panel>
    </div>
  );
}

