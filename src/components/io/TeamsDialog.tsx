import { useState } from 'react';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { teamVariations } from '@/domain/team';
import type { SpriteSetId, Team } from '@/domain/types';
import { useTeamStore } from '@/store/teamStore';
import { Modal } from '../ui/Modal';
import { Sprite } from '../ui/Sprite';
import { Button, MonAvatar, cn } from '../ui/primitives';

/** Click (or the pencil icon) to edit; commits on blur/Enter, discards on Escape. */
function InlineEditable({
  value,
  placeholder,
  ariaLabel,
  onCommit,
  className,
  textClassName,
}: {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  onCommit: (v: string) => void;
  className?: string;
  textClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const v = draft.trim();
          if (v && v !== value) onCommit(v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cn('h-6 min-w-0 rounded border border-accent bg-surface px-1 text-sm font-semibold outline-none', className)}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={`Rename ${value || placeholder}`}
      className={cn('group/name flex min-w-0 items-center gap-1 text-left', className)}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
    >
      <span className={cn('truncate', textClassName)}>{value || placeholder}</span>
      <Pencil size={11} className="shrink-0 text-muted opacity-0 group-hover/name:opacity-70" />
    </button>
  );
}

function SpriteRow({ team, dex, spriteSet, size = 32 }: { team: Team; dex?: Dex; spriteSet: SpriteSetId; size?: number }) {
  return (
    <span className="flex gap-1">
      {team.slots.map((s, i) => {
        const sp = s && dex?.species(s.speciesId);
        return sp ? (
          <Sprite key={i} speciesId={sp.id} name={sp.name} types={sp.types} set={spriteSet} size={size} />
        ) : (
          <MonAvatar key={i} size={size * 0.75} />
        );
      })}
    </span>
  );
}

function DeleteButton({
  id,
  label,
  confirmId,
  setConfirmId,
  onDelete,
}: {
  id: string;
  label: string;
  confirmId: string | null;
  setConfirmId: (id: string | null) => void;
  onDelete: (id: string) => void;
}) {
  if (confirmId === id) {
    return (
      <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            onDelete(id);
            setConfirmId(null);
          }}
        >
          Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
          Keep
        </Button>
      </span>
    );
  }
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={`Delete ${label}`}
      className="shrink-0 hover:text-bad"
      onClick={(e) => {
        e.stopPropagation();
        setConfirmId(id);
      }}
    >
      <Trash2 size={14} />
    </Button>
  );
}

export function TeamsDialog({ open, onOpenChange, dex }: { open: boolean; onOpenChange: (o: boolean) => void; dex?: Dex }) {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const { selectTeam, duplicateTeam, deleteTeam, updateTeam, addVariation } = useTeamStore.getState();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const select = (id: string) => {
    selectTeam(id);
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Saved teams" description="Stored in this browser. Use JSON backup to move them between devices." wide>
      <ul className="space-y-2">
        {order.map((id) => {
          const t = teams[id];
          if (!t) return null;
          const f = getFormat(t.formatId);
          const variations = teamVariations(teams, id);
          const groupIsActive = id === activeTeamId;
          // "Add variation" duplicates whichever member of this group is currently selected.
          const currentInGroup = groupIsActive || teams[activeTeamId]?.groupId === id ? activeTeamId : id;

          return (
            <li
              key={id}
              className={cn('rounded-xl border p-3', groupIsActive ? 'border-accent bg-accent/5' : 'border-border')}
            >
              <div className="flex cursor-pointer items-center gap-3" onClick={() => select(id)}>
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
                  <span className="flex w-full items-center gap-2">
                    <InlineEditable
                      value={t.name}
                      ariaLabel="Saved team name"
                      textClassName="font-semibold"
                      onCommit={(name) => updateTeam(id, { name })}
                    />
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">{t.category || f.shortName}</span>
                    {variations.length > 0 && (
                      <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                        {variations.length + 1} variations
                      </span>
                    )}
                  </span>
                  <SpriteRow team={t} dex={dex} spriteSet={f.spriteSet} />
                  <span className="text-[11px] text-muted">Edited {new Date(t.updatedAt).toLocaleString()}</span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Duplicate ${t.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateTeam(id);
                  }}
                >
                  <Copy size={14} />
                </Button>
                <DeleteButton id={id} label={t.name} confirmId={confirmId} setConfirmId={setConfirmId} onDelete={deleteTeam} />
              </div>

              {variations.length > 0 && (
                <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
                  {variations.map((v) => (
                    <li
                      key={v.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border p-2',
                        v.id === activeTeamId ? 'border-accent bg-accent/5' : 'border-transparent bg-surface-2/60',
                      )}
                      onClick={() => select(v.id)}
                    >
                      <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                        <InlineEditable
                          value={v.variationLabel ?? 'Variation'}
                          ariaLabel="Variation label"
                          textClassName="text-xs font-semibold"
                          onCommit={(variationLabel) => updateTeam(v.id, { variationLabel })}
                        />
                        <SpriteRow team={v} dex={dex} spriteSet={f.spriteSet} size={22} />
                        <span className="text-[10px] text-muted">Edited {new Date(v.updatedAt).toLocaleString()}</span>
                      </div>
                      <DeleteButton id={v.id} label={v.variationLabel ?? 'variation'} confirmId={confirmId} setConfirmId={setConfirmId} onDelete={deleteTeam} />
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    addVariation(currentInGroup);
                  }}
                >
                  <Plus size={13} /> Add variation
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
