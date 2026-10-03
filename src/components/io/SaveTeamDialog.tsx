import { useState } from 'react';
import { findTeamByName, useTeamStore, type SaveMode } from '@/store/teamStore';
import { Modal } from '../ui/Modal';
import { Button, Field, Input } from '../ui/primitives';

/**
 * The deliberate "this build is done, keep it" moment: prompts for a name and commits the
 * current in-progress build as a new, distinctly-named entry in the saved-teams list — unlike
 * the passive auto-persist that just keeps overwriting the active team in place.
 */
export function SaveTeamDialog({
  open,
  onOpenChange,
  currentName,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  currentName: string;
  onSave: (name: string, mode: SaveMode, targetId?: string) => void;
}) {
  const [name, setName] = useState(currentName);
  const [choice, setChoice] = useState<'variation' | 'overwrite'>('variation');
  // Another saved team with this name: ask what to do instead of piling up same-named copies.
  const clash = useTeamStore((s) => findTeamByName(s, name));
  const variations = useTeamStore((s) => (clash ? Object.values(s.teams).filter((t) => t.groupId === clash.id).length : 0));

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (clash) onSave(trimmed, choice, clash.id);
    else onSave(trimmed, 'new');
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setName(currentName);
          setChoice('variation');
        }
        onOpenChange(o);
      }}
      title="Save team"
      description="Commits the current build as a new entry in your saved teams — the original is left untouched."
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Team name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Untitled Team" />
        </Field>
        {clash && (
          <fieldset className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <legend className="px-1 text-xs font-semibold text-muted">“{clash.name}” already exists. What should Save do?</legend>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="save-mode" className="mt-1" checked={choice === 'variation'} onChange={() => setChoice('variation')} />
              <span>
                <span className="font-medium">Add as a variation of “{clash.name}”</span>
                <span className="block text-xs text-muted">Keeps the original{variations ? ` and its ${variations} variation${variations === 1 ? '' : 's'}` : ''}; this build is added to its folder.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="save-mode" className="mt-1" checked={choice === 'overwrite'} onChange={() => setChoice('overwrite')} />
              <span>
                <span className="font-medium">Overwrite “{clash.name}”</span>
                <span className="block text-xs text-muted">Replaces its six Pokémon with this build. The old roster is not kept.</span>
              </span>
            </label>
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            {clash ? (choice === 'overwrite' ? 'Overwrite' : 'Add variation') : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
