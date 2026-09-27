import { useState } from 'react';
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
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(currentName);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (o) setName(currentName);
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
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
