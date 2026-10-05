import { useMemo, useState } from 'react';
import { Tags } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { useMetaFor } from '@/data/useMeta';
import { suggestionPatch, untaggedMatches } from '@/domain/archetypeInputs';
import type { Match } from '@/domain/matches';
import type { FormatRules } from '@/domain/types';
import { useMatchStore } from '@/store/matchStore';
import { toast } from '@/store/toastStore';
import { useTeamStore } from '@/store/teamStore';
import { Modal } from '../ui/Modal';
import { Button, Chip } from '../ui/primitives';

/**
 * "Tag N untagged matches": the archetypes the app would give the matches that have an empty archetype
 * field, as a preview you can untick, applied in one go with an Undo. A tag you set yourself is never
 * touched; nothing is written until you press Apply.
 */
export function TagUntagged({ dex, format, matches }: { dex: Dex; format: FormatRules; matches: Match[] }) {
  const teams = useTeamStore((s) => s.teams);
  const metaFor = useMetaFor();
  const [open, setOpen] = useState(false);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const list = useMemo(() => untaggedMatches(matches, teams, dex, format, (reg) => (reg ? metaFor?.(reg) : undefined)), [matches, teams, dex, format, metaFor]);
  if (!list.length) return null;
  const chosen = list.filter((x) => !skipped.has(x.match.id));

  const apply = () => {
    const { updateMatch } = useMatchStore.getState();
    const done: { id: string; patch: ReturnType<typeof suggestionPatch> }[] = [];
    for (const { match, suggestion } of chosen) {
      // The latest copy, in case the match changed while the preview was open.
      const current = useMatchStore.getState().matches[match.id];
      if (!current) continue;
      const patch = suggestionPatch(current, suggestion);
      if (Object.keys(patch).length) {
        updateMatch(match.id, patch);
        done.push({ id: match.id, patch });
      }
    }
    setOpen(false);
    toast(`Tagged ${done.length} ${done.length === 1 ? 'match' : 'matches'}.`, {
      label: 'Undo',
      run: () => {
        // Take back only what is still what was written; a tag you changed since stays.
        for (const { id, patch } of done) {
          const current = useMatchStore.getState().matches[id];
          if (!current) continue;
          const undo: Partial<Pick<Match, 'myArchetype' | 'opponentArchetype'>> = {};
          if (patch.myArchetype !== undefined && current.myArchetype === patch.myArchetype) undo.myArchetype = undefined;
          if (patch.opponentArchetype !== undefined && current.opponentArchetype === patch.opponentArchetype) undo.opponentArchetype = undefined;
          if (Object.keys(undo).length) updateMatch(id, undo);
        }
      },
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
        <Button onClick={() => { setSkipped(new Set()); setOpen(true); }}>
          <Tags size={15} aria-hidden />
          Tag {list.length} untagged {list.length === 1 ? 'match' : 'matches'}
        </Button>
        <span className="text-xs text-muted">Archetypes worked out from the teams. You see them first; nothing changes until you apply.</span>
      </div>
      <Modal open={open} onOpenChange={setOpen} wide title={`Tag ${list.length} untagged ${list.length === 1 ? 'match' : 'matches'}`} description="Untick a match to leave it as it is. Tags you set yourself are never replaced.">
        <ul className="space-y-1.5" aria-label="Suggested tags">
          {list.map(({ match, suggestion }) => {
            const opp = match.opponentTeam.map((m) => dex.species(m.speciesId)?.name ?? m.speciesId).filter(Boolean);
            const label = `${match.date}${opp.length ? ` vs ${opp.slice(0, 3).join(', ')}${opp.length > 3 ? '…' : ''}` : ''}`;
            return (
              <li key={match.id} className="rounded-lg border border-border p-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 pointer-coarse:size-5"
                    checked={!skipped.has(match.id)}
                    onChange={(e) => setSkipped((s) => { const n = new Set(s); if (e.target.checked) n.delete(match.id); else n.add(match.id); return n; })}
                    aria-label={`Tag the match on ${label}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{label}</span>
                    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      {suggestion.myArchetype && (
                        <span>
                          Mine: <Chip tone="accent">{suggestion.myArchetype.tag}</Chip> {suggestion.myArchetype.reasons.join('; ')}
                        </span>
                      )}
                      {suggestion.opponentArchetype && (
                        <span>
                          Theirs: <Chip tone="accent">{suggestion.opponentArchetype.tag}</Chip> {suggestion.opponentArchetype.reasons.join('; ')}
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={!chosen.length} onClick={apply}>
            Apply to {chosen.length}
          </Button>
        </div>
      </Modal>
    </>
  );
}
