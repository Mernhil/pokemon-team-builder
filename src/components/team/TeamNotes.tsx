import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { MAX_MATCHUP_NOTES, MAX_MATCHUP_TEXT, MAX_MATCHUP_TITLE } from '@/domain/sanitize';
import { uid } from '@/domain/team';
import type { MatchupNote, Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { Button, Checkbox, Input, Panel, TextArea } from '../ui/primitives';

const MAX_TEAM_NOTES = 5000;

/**
 * A team's free-form notes and its plans against kinds of opponents ("vs Rain: lead Incineroar +
 * Garchomp"). Saved as you type; the notes travel with the team (share codes, backups, sync).
 */
export function TeamNotes({ team, dex }: { team: Team; dex: Dex }) {
  const updateTeam = useTeamStore((s) => s.updateTeam);
  const notesId = useId();
  const plans = team.matchupNotes ?? [];
  const setPlans = (next: MatchupNote[]) => updateTeam(team.id, { matchupNotes: next.length ? next : undefined });
  const patch = (id: string, p: Partial<MatchupNote>) => setPlans(plans.map((n) => (n.id === id ? { ...n, ...p } : n)));
  const members = team.slots.flatMap((s) => (s ? [{ uid: s.uid, name: s.nickname || dex.species(s.speciesId)?.name || s.speciesId }] : []));

  return (
    <div className="space-y-3">
      <Panel title="Team notes">
        <label htmlFor={notesId} className="sr-only">Team notes</label>
        <TextArea
          id={notesId}
          rows={4}
          maxLength={MAX_TEAM_NOTES}
          value={team.notes ?? ''}
          onChange={(e) => updateTeam(team.id, { notes: e.target.value || undefined })}
          placeholder="What this team is for, how it plays, what to remember…"
        />
      </Panel>
      <Panel
        title="Matchup notes"
        actions={
          <Button size="sm" disabled={plans.length >= MAX_MATCHUP_NOTES} onClick={() => setPlans([...plans, { id: uid(), title: '', text: '' }])}>
            <Plus size={14} aria-hidden /> Add a plan
          </Button>
        }
      >
        {plans.length === 0 ? (
          <p className="text-sm text-muted">Plans against kinds of opponents: “vs Rain: lead Incineroar + Garchomp, keep Kingambit in the back”.</p>
        ) : (
          <ul className="space-y-3">
            {plans.map((n, i) => (
              <li key={n.id} className="space-y-1.5 rounded-lg border border-border p-2">
                <div className="flex items-center gap-2">
                  <Input aria-label={`Plan ${i + 1} title`} maxLength={MAX_MATCHUP_TITLE} value={n.title} onChange={(e) => patch(n.id, { title: e.target.value })} placeholder="vs Rain, vs Trick Room…" />
                  <Button size="icon-sm" variant="ghost" aria-label={`Delete plan: ${n.title || i + 1}`} onClick={() => setPlans(plans.filter((x) => x.id !== n.id))}>
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </div>
                <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <legend className="sr-only">Lead (up to two)</legend>
                  <span className="text-muted">Lead</span>
                  {members.map((m) => {
                    const on = n.leads?.includes(m.uid) ?? false;
                    return (
                      <label key={m.uid} className="flex items-center gap-1 pointer-coarse:min-h-11">
                        <Checkbox checked={on}
 disabled={!on && (n.leads?.length ?? 0) >= 2}
 onChange={(e) => {
 const leads = e.target.checked ? [...(n.leads ?? []), m.uid] : (n.leads ?? []).filter((u) => u !== m.uid);
 patch(n.id, { leads: leads.length ? leads : undefined });
 }} />
                        {m.name}
                      </label>
                    );
                  })}
                </fieldset>
                <TextArea aria-label={`Plan ${i + 1} text`} rows={2} maxLength={MAX_MATCHUP_TEXT} value={n.text} onChange={(e) => patch(n.id, { text: e.target.value })} placeholder="What to do, what to watch for…" />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
