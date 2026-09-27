import { useState } from 'react';
import { Copy, Plus, Trash2 } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { FORMATS, getFormat } from '@/domain/formats';
import { useTeamStore } from '@/store/teamStore';
import { Modal } from '../ui/Modal';
import { Sprite } from '../ui/Sprite';
import { Button, MonAvatar, cn } from '../ui/primitives';

export function TeamsDialog({ open, onOpenChange, dex }: { open: boolean; onOpenChange: (o: boolean) => void; dex?: Dex }) {
  const teams = useTeamStore((s) => s.teams);
  const order = useTeamStore((s) => s.order);
  const activeTeamId = useTeamStore((s) => s.activeTeamId);
  const { selectTeam, duplicateTeam, deleteTeam, newTeam } = useTeamStore.getState();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Saved teams" description="Stored in this browser. Use JSON backup to move them between devices." wide>
      <div className="mb-4 flex flex-wrap gap-2">
        {FORMATS.filter((f) => f.available).map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant="primary"
            onClick={() => {
              newTeam(f.id);
              onOpenChange(false);
            }}
          >
            <Plus size={13} /> New {f.shortName} team
          </Button>
        ))}
      </div>
      <ul className="space-y-2">
        {order.map((id) => {
          const t = teams[id];
          if (!t) return null;
          const f = getFormat(t.formatId);
          return (
            <li
              key={id}
              className={cn('flex items-center gap-3 rounded-xl border p-3', id === activeTeamId ? 'border-accent bg-accent/5' : 'border-border')}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left"
                onClick={() => {
                  selectTeam(id);
                  onOpenChange(false);
                }}
              >
                <span className="flex w-full items-center gap-2">
                  <span className="truncate font-semibold">{t.name}</span>
                  <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">{t.category || f.shortName}</span>
                </span>
                <span className="flex gap-1">
                  {t.slots.map((s, i) => {
                    const sp = s && dex?.species(s.speciesId);
                    return sp ? (
                      <Sprite key={i} speciesId={sp.id} name={sp.name} types={sp.types} set={f.spriteSet} size={32} />
                    ) : (
                      <MonAvatar key={i} size={24} />
                    );
                  })}
                </span>
                <span className="text-[11px] text-muted">Edited {new Date(t.updatedAt).toLocaleString()}</span>
              </button>
              <Button size="icon" variant="ghost" aria-label={`Duplicate ${t.name}`} onClick={() => duplicateTeam(id)}>
                <Copy size={14} />
              </Button>
              {confirmId === id ? (
                <span className="flex items-center gap-1">
                  <Button size="sm" variant="danger" onClick={() => { deleteTeam(id); setConfirmId(null); }}>
                    Delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                    Keep
                  </Button>
                </span>
              ) : (
                <Button size="icon" variant="ghost" aria-label={`Delete ${t.name}`} className="hover:text-bad" onClick={() => setConfirmId(id)}>
                  <Trash2 size={14} />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
