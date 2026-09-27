import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, GripVertical, Sparkles } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { sumStats } from '@/domain/stats';
import type { FormatRules, PokemonSet, Team } from '@/domain/types';
import type { Issue } from '@/domain/validation';
import { useTeamStore } from '@/store/teamStore';
import { GenBadge } from '../ui/GenBadge';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { MonAvatar, TypeBadge, cn } from '../ui/primitives';

interface Props {
  team: Team;
  dex: Dex;
  format: FormatRules;
  issues: Issue[];
  activeSlot: number;
  onSelect?: () => void;
}

/** Sortable 6-slot roster. Empty slots use a stable synthetic id so they can be reordered too. */
export function TeamSlots({ team, dex, format, issues, activeSlot, onSelect }: Props) {
  const moveSlot = useTeamStore((s) => s.moveSlot);
  const setActiveSlot = useTeamStore((s) => s.setActiveSlot);
  const ids = team.slots.map((s, i) => s?.uid ?? `empty-${i}`);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    const activeUid = ids[activeSlot];
    moveSlot(from, to);
    // Keep the editor on the same Pokémon after reorder.
    const next = [...ids];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setActiveSlot(next.indexOf(activeUid));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-2">
          {team.slots.map((s, i) => (
            <SlotCard
              key={ids[i]}
              id={ids[i]}
              index={i}
              set={s}
              dex={dex}
              format={format}
              active={i === activeSlot}
              errors={issues.filter((x) => x.slot === i && x.severity === 'error').length}
              onClick={() => {
                setActiveSlot(i);
                onSelect?.();
              }}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SlotCard({
  id,
  index,
  set,
  dex,
  format,
  active,
  errors,
  onClick,
}: {
  id: string;
  index: number;
  set: PokemonSet | null;
  dex: Dex;
  format: FormatRules;
  active: boolean;
  errors: number;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const sp = set ? dex.species(set.speciesId) : undefined;
  const mega = set && format.gimmicks.mega ? dex.megaFor(set.speciesId, set.itemId) : undefined;
  const cap = format.statSystem.kind === 'champions-sp' ? format.statSystem.totalCap : 0;
  const used = set ? sumStats(set.sp) : 0;
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex items-stretch rounded-xl border bg-surface transition-shadow',
        active ? 'border-accent ring-2 ring-accent/30' : 'border-border hover:border-muted/50',
        isDragging && 'z-10 shadow-2xl',
      )}
    >
      <button
        type="button"
        aria-label={`Drag to reorder slot ${index + 1}`}
        className="flex w-6 shrink-0 cursor-grab items-center justify-center rounded-l-xl text-muted/60 hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 py-1.5 pr-3 text-left" aria-current={active}>
        {sp ? (
          <Sprite speciesId={sp.id} name={sp.name} types={sp.types} set={format.spriteSet} size={52} backdrop />
        ) : (
          <MonAvatar size={42} />
        )}
        {sp && set ? (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-semibold">{set.nickname || sp.name}</span>
              {mega && <Sparkles size={12} className="shrink-0 text-accent" aria-label="Mega Evolution ready" />}
              {errors > 0 && (
                <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-bad">
                  <AlertCircle size={12} /> {errors}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 truncate text-[11px] text-muted">
              <ItemSprite itemId={set.itemId} name={dex.item(set.itemId)?.name} size={14} />
              <span className="truncate">
                {dex.item(set.itemId)?.name ?? 'No item'} · {dex.ability(set.abilityId)?.name ?? '—'}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              {sp.types.map((t) => (
                <TypeBadge key={t} type={t} size="xs" />
              ))}
              <GenBadge gen={sp.gen} size="xs" />
              {cap > 0 && (
                <span className="ml-auto flex items-center gap-1.5" title={`${used}/${cap} SP`}>
                  <span className="h-1 w-12 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className={cn('block h-full', used === cap ? 'bg-good' : used > cap ? 'bg-bad' : 'bg-accent')}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className={cn('font-mono text-[10px] tabular-nums', used === cap ? 'text-good' : used > cap ? 'text-bad' : 'text-muted')}>
                    {used}/{cap}
                  </span>
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 text-sm text-muted">
            <span className="font-mono text-xs">{index + 1}.</span> Empty slot
          </div>
        )}
      </button>
    </li>
  );
}
