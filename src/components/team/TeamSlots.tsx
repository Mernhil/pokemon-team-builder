import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, AlertTriangle, GripVertical, Plus, Sparkles } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { sumStats } from '@/domain/stats';
import type { FormatRules, PokemonSet, Team } from '@/domain/types';
import type { Issue } from '@/domain/validation';
import { useTeamStore } from '@/store/teamStore';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { MonAvatar, TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';

interface Props {
  team: Team;
  dex: Dex;
  format: FormatRules;
  issues: Issue[];
  activeSlot: number;
  onSelect?: () => void;
  /**
   * Which slot editing should focus, when this isn't the Builder tab's one global "active slot"
   * (e.g. the Matches tab's two side-by-side builders, each with its own local selection).
   * Defaults to the global store's `setActiveSlot`.
   */
  onActiveSlot?: (i: number) => void;
}

/**
 * Drag sensors shared by the team list and the phone strip: a mouse drag starts after 6px, a touch
 * drag after a 250ms press (so a swipe still scrolls the page), and the keyboard can reorder too
 * (Space to lift, arrows to move, Space to drop).
 */
function useSlotSorting(team: Team, activeSlot: number, onActiveSlot?: (i: number) => void) {
  const moveSlot = useTeamStore((s) => s.moveSlot);
  const globalSetActiveSlot = useTeamStore((s) => s.setActiveSlot);
  const setActiveSlot = onActiveSlot ?? globalSetActiveSlot;
  const ids = team.slots.map((s, i) => s?.uid ?? `empty-${i}`);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    const activeUid = ids[activeSlot];
    moveSlot(team.id, from, to);
    // Keep the editor on the same Pokémon after reorder.
    const next = [...ids];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setActiveSlot(next.indexOf(activeUid));
  };
  return { ids, sensors, onDragEnd, setActiveSlot };
}

/** Sortable 6-slot roster. Empty slots use a stable synthetic id so they can be reordered too. */
export function TeamSlots({ team, dex, format, issues, activeSlot, onSelect, onActiveSlot }: Props) {
  const { ids, sensors, onDragEnd, setActiveSlot } = useSlotSorting(team, activeSlot, onActiveSlot);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="flex flex-col gap-1.5">
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

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex items-stretch rounded-xl transition-shadow',
        active ? 'bg-surface-2 ring-2 ring-accent' : 'hover:bg-surface-2',
        isDragging && 'z-10 bg-surface shadow-2xl',
      )}
    >
      <button
        type="button"
        aria-label={`Reorder slot ${index + 1}${sp ? ` (${sp.name})` : ''}: drag, or press Space then arrow keys`}
        className="flex w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-l-xl text-muted hover:text-fg active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={15} aria-hidden />
      </button>
      <button type="button" onClick={onClick} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-r-xl py-1.5 pr-3 text-left" aria-current={active}>
        <SlotSummary index={index} set={set} dex={dex} format={format} errors={errors} />
      </button>
    </li>
  );
}

/** A roster slot's content (sprite, name, item · ability, types, stat budget): the Builder's slot card, reused wherever a team is shown read-only. */
export function SlotSummary({ index, set, dex, format, errors = 0, hideBudget }: { index: number; set: PokemonSet | null; dex: Dex; format: FormatRules; errors?: number; hideBudget?: boolean }) {
  const sp = set ? dex.species(set.speciesId) : undefined;
  const mega = set && format.capabilities.mega ? dex.megaFor(set.speciesId, set.itemId) : undefined;
  const sys = format.statSystem;
  const cap = !hideBudget && (sys.kind === 'champions-sp' || sys.kind === 'modern-ev') ? sys.totalCap : 0;
  const used = set ? sumStats(sys.kind === 'champions-sp' ? set.sp : set.evs) : 0;
  return (
    <>
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
            <span className="ml-auto flex shrink-0 items-center gap-0.5 text-xs font-semibold text-bad" aria-label={`${errors} errors`}>
              <AlertCircle size={13} aria-hidden /> {errors}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 truncate text-xs text-muted">
          <ItemSprite itemId={set.itemId} name={dex.item(set.itemId)?.name} size={14} />
          <span className="truncate">
            {format.generation >= 3 || format.statSystem.kind === 'champions-sp'
              ? `${dex.item(set.itemId)?.name ?? 'No item'} · ${dex.ability(set.abilityId)?.name ?? '—'}`
              : format.generation === 2
                ? `${dex.item(set.itemId)?.name ?? 'No item'} · Lv ${set.level}`
                : `Lv ${set.level} · ${set.moves.filter(Boolean).length}/4 moves`}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1">
          {sp.types.map((t) => (
            <TypeBadge key={t} type={t} size="xs" />
          ))}
          {cap > 0 && (
            <span
              className={cn('ml-auto shrink-0 font-mono text-2xs tabular-nums', used === cap ? 'text-good' : used > cap ? 'text-bad' : 'text-muted')}
              title={`${used} of ${cap} ${sys.kind === 'champions-sp' ? 'Stat Points' : 'EVs'} used`}
            >
              {used}/{cap}
            </span>
          )}
        </div>
      </div>
    ) : (
      <div className="flex-1 text-sm text-muted">
        <span className="font-mono text-xs">{index + 1}.</span> Empty slot
      </div>
    )}
    </>
  );
}

/**
 * Phones and tablets: the team as a row of sprite tiles above the editor. Tap to edit a slot;
 * press and hold (or Space + arrows) to reorder. Warnings show as a corner icon with a label.
 */
export function TeamStrip({ team, dex, format, issues, activeSlot, onActiveSlot }: Omit<Props, 'onSelect'>) {
  const { ids, sensors, onDragEnd, setActiveSlot } = useSlotSorting(team, activeSlot, onActiveSlot);
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
        <ol className="grid grid-cols-6 gap-1.5" aria-label={`Team, ${team.slots.filter(Boolean).length} of ${format.teamSize}`}>
          {team.slots.map((s, i) => (
            <StripTile
              key={ids[i]}
              id={ids[i]}
              index={i}
              set={s}
              dex={dex}
              format={format}
              active={i === activeSlot}
              flagged={issues.some((x) => x.slot === i && x.severity !== 'info')}
              onClick={() => setActiveSlot(i)}
            />
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function StripTile({ id, index, set, dex, format, active, flagged, onClick }: { id: string; index: number; set: PokemonSet | null; dex: Dex; format: FormatRules; active: boolean; flagged: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const sp = set ? dex.species(set.speciesId) : undefined;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && 'z-10')}>
      <button
        type="button"
        onClick={onClick}
        aria-current={active}
        aria-label={sp ? `Slot ${index + 1}: ${set?.nickname || sp.name}${flagged ? ', needs attention' : ''}` : `Slot ${index + 1}: empty, add a Pokémon`}
        className={cn(
          'relative flex aspect-square w-full touch-manipulation items-center justify-center rounded-xl bg-surface select-none',
          active ? 'ring-2 ring-accent' : 'border border-border',
          isDragging && 'shadow-2xl',
        )}
        {...attributes}
        {...listeners}
      >
        {sp ? <Sprite speciesId={sp.id} name={sp.name} types={sp.types} set={format.spriteSet} size={44} /> : <Plus size={18} className="text-muted" aria-hidden />}
        {flagged && <AlertTriangle size={13} className="absolute top-1 right-1 text-warn" aria-hidden />}
      </button>
    </li>
  );
}
