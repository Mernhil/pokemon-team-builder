import { useState } from 'react';
import { editingTeam, findTeamByName, isLocked, useTeamStore, type SaveMode } from '@/store/teamStore';
import { Modal } from '../ui/Modal';
import { Button, Field, Input } from '../ui/primitives';

/**
 * The deliberate "this build is done, keep it" moment. A build loaded from (or last saved into) a
 * saved team offers to update that team; anything else is committed as a new, distinctly-named
 * entry. The build itself stays open, and saved teams never change any other way.
 */
export function SaveTeamDialog({
  open,
  onOpenChange,
  currentName,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** What to suggest as the name when saving something new. */
  currentName: string;
  onSave: (name: string, mode: SaveMode, targetId?: string) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Save team"
      description="Saved teams only change when you save over them. The build stays open here so you can keep trying things."
    >
      {open && <Body currentName={currentName} onSave={onSave} onClose={() => onOpenChange(false)} />}
    </Modal>
  );
}

function Body({ currentName, onSave, onClose }: { currentName: string; onSave: (name: string, mode: SaveMode, targetId?: string) => void; onClose: () => void }) {
  // The saved team this build was loaded from (Edit team) or last saved into: Save updates it by default.
  const editing = useTeamStore(editingTeam);
  const canUpdate = !!editing && !isLocked(editing);
  const [name, setName] = useState(editing && !editing.groupId ? editing.name : currentName);
  const [choice, setChoice] = useState<'variation' | 'overwrite'>('variation');
  const [mode, setMode] = useState<'update' | 'save'>(canUpdate ? 'update' : 'save');
  const editingLabel = editing ? `${editing.name}${editing.variationLabel ? ` · ${editing.variationLabel}` : ''}` : '';
  // Another saved team with this name: ask what to do instead of piling up same-named copies.
  const clash = useTeamStore((s) => findTeamByName(s, name));
  const variations = useTeamStore((s) => (clash ? Object.values(s.teams).filter((t) => t.groupId === clash.id).length : 0));

  const submit = () => {
    const trimmed = name.trim();
    if (canUpdate && mode === 'update') {
      onSave(editing!.groupId ? editing!.name : trimmed || editing!.name, 'overwrite', editing!.id);
      onClose();
      return;
    }
    if (!trimmed) return;
    if (clash) onSave(trimmed, choice, clash.id);
    else onSave(trimmed, 'new');
    onClose();
  };

  return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {canUpdate && (
          <fieldset className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <legend className="px-1 text-xs font-semibold text-muted">This build came from a saved team</legend>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="save-target" className="mt-1" checked={mode === 'update'} onChange={() => setMode('update')} />
              <span>
                <span className="font-medium">Update “{editingLabel}”</span>
                <span className="block text-xs text-muted">Replaces its six Pokémon with this build.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="save-target" className="mt-1" checked={mode === 'save'} onChange={() => setMode('save')} />
              <span>
                <span className="font-medium">Save as a separate team</span>
                <span className="block text-xs text-muted">“{editingLabel}” stays as it is.</span>
              </span>
            </label>
          </fieldset>
        )}
        {!(canUpdate && mode === 'update' && editing!.groupId) && (
          <Field label="Team name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} placeholder="Untitled Team" />
          </Field>
        )}
        {clash && (!canUpdate || mode === 'save') && (
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
          <Button type="button" variant="ghost" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!(canUpdate && mode === 'update') && !name.trim()}>
            {canUpdate && mode === 'update' ? 'Update' : clash ? (choice === 'overwrite' ? 'Overwrite' : 'Add variation') : 'Save'}
          </Button>
        </div>
      </form>
  );
}
