import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { formatMechanics } from '@/domain/games';
import { ABILITY_INTERACTIONS, ITEM_INTERACTIONS } from '@/domain/mechanics';
import { spreadKey } from '@/domain/stats';
import { createSet } from '@/domain/team';
import { STAT_LABELS, type FormatRules, type PokemonSet, type TeraType } from '@/domain/types';
import type { Issue } from '@/domain/validation';
import { useSlotBattle, useTeamStore } from '@/store/teamStore';
import { AdvancedDetails } from '../editor/AdvancedDetails';
import { useItemOptions, useMoveOptions } from '../editor/options';
import { SpeciesPicker } from '../editor/SpeciesPicker';
import { SpriteHistory } from '../editor/SpriteHistory';
import { StatDistributor } from '../editor/StatDistributor';
import { Combobox } from '../ui/Combobox';
import { GenBadge } from '../ui/GenBadge';
import { InfoTooltip } from '../ui/InfoTooltip';
import { ItemSprite } from '../ui/ItemSprite';
import { Sprite } from '../ui/Sprite';
import { Button, Field, Input, Select, TypeBadge, cn } from '../ui/primitives';

type Tab = 'moves' | 'stats' | 'item';
const TABS: { id: Tab; label: string }[] = [
  { id: 'moves', label: 'Moves' },
  { id: 'stats', label: 'Stats' },
  { id: 'item', label: 'Item' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: number;
  set: PokemonSet | null;
  dex: Dex;
  format: FormatRules;
  issues: Issue[];
}

/**
 * Mobile-only slot detail: a bottom sheet (drag handle, swipe-down/tap-outside to close) with a
 * Moves / Stats / Item segmented control, so only one section shows at a time instead of the full
 * desktop panel stack. Only rendered under the `lg:hidden` mobile layout in App.tsx's Builder.
 */
export function MobileSlotSheet({ open, onOpenChange, slot, set, dex, format, issues }: Props) {
  const { setSlot, updateSet, setMove, setSpread } = useTeamStore.getState();
  const [tab, setTab] = useState<Tab>('moves');
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const mech = formatMechanics(format);
  const champions = format.statSystem.kind === 'champions-sp';

  const itemOptions = useItemOptions(dex, format, set?.speciesId);
  const moveOptions = useMoveOptions(dex, format, set);

  useEffect(() => {
    if (open) setTab('moves');
  }, [open, slot]);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const onTouchStart = (e: TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (dragStartY.current === null) return;
    setDragY(Math.max(0, e.touches[0].clientY - dragStartY.current));
  };
  const onTouchEnd = () => {
    if (dragY > 80) onOpenChange(false);
    setDragY(0);
    dragStartY.current = null;
  };

  const species = set ? dex.species(set.speciesId) : undefined;
  const mega = set && species && format.gimmicks.mega ? dex.megaFor(species.id, set.itemId) : undefined;
  const ability = set ? dex.ability(set.abilityId) : undefined;
  const item = set ? dex.item(set.itemId) : undefined;
  const slotIssues = issues.filter((i) => i.slot === slot && i.severity !== 'info');
  const badMove = (id: string) => !!species && (!dex.canLearn(species.id, id) || (!!format.regulationId && !dex.move(id)?.legalIn.includes(format.regulationId)));

  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={`Slot ${slot + 1} details`}>
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange(false)} />
      <div
        className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl border-t border-border bg-surface shadow-2xl"
        style={{ transform: `translateY(${dragY}px)`, transition: dragY ? 'none' : 'transform 150ms ease-out' }}
      >
        <div
          className="flex shrink-0 touch-none flex-col items-center gap-1 pt-2.5 pb-1"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <span className="h-1.5 w-10 rounded-full bg-border" aria-hidden />
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {!set || !species ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <div className="flex w-full items-center justify-between">
                <span className="text-sm font-semibold">Slot {slot + 1} · Empty</span>
                <Button size="icon" variant="ghost" aria-label="Close" onClick={() => onOpenChange(false)}>
                  <X size={16} />
                </Button>
              </div>
              <p className="text-sm text-muted">Pick a Pokémon {champions ? 'legal in' : 'from'} {format.shortName}.</p>
              <SpeciesPicker className="w-full text-left" dex={dex} format={format} onChange={(id) => id && setSlot(slot, createSet(dex, id, format))} />
            </div>
          ) : (
            <>
              <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
                <Sprite speciesId={species.id} name={species.name} types={species.types} set={format.spriteSet} size={48} backdrop />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{set.nickname || species.name}</span>
                    {mega && <Sparkles size={12} className="shrink-0 text-accent" aria-label="Mega Evolution ready" />}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {species.types.map((t) => (
                      <TypeBadge key={t} type={t} size="xs" />
                    ))}
                    <GenBadge gen={species.gen} size="xs" />
                  </div>
                </div>
                <Button size="icon" variant="ghost" aria-label="Remove Pokémon" onClick={() => { setSlot(slot, null); onOpenChange(false); }}>
                  <Trash2 size={16} />
                </Button>
                <Button size="icon" variant="ghost" aria-label="Close" onClick={() => onOpenChange(false)}>
                  <X size={16} />
                </Button>
              </div>

              <div className="space-y-3 py-3">
                <SpeciesPicker
                  showGenFilter={false}
                  dex={dex}
                  format={format}
                  value={species.id}
                  onChange={(id) => {
                    if (!id || id === species.id) return;
                    const next = createSet(dex, id, format);
                    setSlot(slot, { ...next, uid: set.uid, itemId: set.itemId, nature: set.nature, sp: set.sp, evs: set.evs, ivs: set.ivs, nickname: set.nickname });
                  }}
                />

                <div role="tablist" aria-label="Slot details" className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                      className={cn(
                        'h-11 rounded-md text-sm font-semibold transition-colors',
                        tab === t.id ? 'bg-surface text-fg shadow-sm' : 'text-muted',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {tab === 'moves' && (
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Moves</span>
                      <span className="text-[11px] text-muted">{moveOptions.length} legal in {format.shortName}</span>
                    </div>
                    <MoveChips set={set} dex={dex} moveOptions={moveOptions} badMove={badMove} onSetMove={(mi, id) => setMove(slot, mi, id)} />
                  </div>
                )}

                {tab === 'stats' && (
                  <div className="space-y-3">
                    {mech.natures && (
                      <Field label={champions ? 'Stat Alignment (Nature)' : 'Nature'}>
                        <Select value={set.nature} onChange={(e) => updateSet(slot, { nature: e.target.value })}>
                          {dex.natures.map((n) => (
                            <option key={n.name} value={n.name}>
                              {n.name}
                              {n.plus && n.plus !== n.minus ? ` (+${STAT_LABELS[n.plus]} −${STAT_LABELS[n.minus!]})` : ' (neutral)'}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                    <SlotStatDistributor
                      set={set}
                      species={species}
                      mega={mega}
                      format={format}
                      dex={dex}
                      onSpread={(stat, v) => setSpread(slot, spreadKey(format.statSystem), stat, v)}
                      onReplaceSpread={(spread) => updateSet(slot, { [spreadKey(format.statSystem)]: spread })}
                      onIV={format.fixedIVs ? undefined : (stat, v) => setSpread(slot, 'ivs', stat, v)}
                      onNature={(nature) => updateSet(slot, { nature })}
                      onFriendship={format.statSystem.kind === 'lgpe-av' ? (friendship) => updateSet(slot, { friendship }) : undefined}
                    />
                  </div>
                )}

                {tab === 'item' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3">
                      <Field label="Nickname">
                        <Input value={set.nickname ?? ''} placeholder={species.name} maxLength={12} onChange={(e) => updateSet(slot, { nickname: e.target.value || undefined })} />
                      </Field>
                      {(mech.heldItems || mech.megaStoneOnly) && (
                        <Field
                          label={mech.megaStoneOnly ? 'Mega Stone (in the Bag)' : 'Held item'}
                          hint={item?.shortDesc && <InfoTooltip title={item.name} summary={item.shortDesc} interactions={ITEM_INTERACTIONS[item.id]}><span>ⓘ</span></InfoTooltip>}
                        >
                          <Combobox
                            aria-label="Held item"
                            options={itemOptions}
                            value={set.itemId}
                            allowClear
                            placeholder="None"
                            icon={<ItemSprite itemId={set.itemId} name={item?.name} size={18} />}
                            invalid={slotIssues.some((i) => i.code.startsWith('item'))}
                            onChange={(id) => updateSet(slot, { itemId: id || undefined })}
                          />
                        </Field>
                      )}
                      {mech.abilities && (
                        <Field
                          label="Ability"
                          hint={ability?.shortDesc && <InfoTooltip title={ability.name} summary={ability.shortDesc} interactions={ABILITY_INTERACTIONS[ability.id]}><span>ⓘ</span></InfoTooltip>}
                        >
                          <Select value={set.abilityId ?? ''} onChange={(e) => updateSet(slot, { abilityId: e.target.value })}>
                            {dex.abilitiesOf(species.id).map(({ slot: s, ability: a }) => (
                              <option key={s} value={a.id}>
                                {a.name}
                                {s === 'H' ? ' (Hidden)' : ''}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                      {format.gimmicks.tera && (
                        <Field label="Tera Type">
                          <Select value={set.teraType ?? ''} onChange={(e) => updateSet(slot, { teraType: (e.target.value || undefined) as TeraType | undefined })}>
                            <option value="">—</option>
                            {[...dex.types, 'Stellar'].map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                      <Field label="Level">
                        {format.level.fixed ? (
                          <Input value={format.level.fixed} disabled readOnly title="Champions: fixed Lv 50, 31 IVs" />
                        ) : (
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={format.level.min}
                            max={format.level.max}
                            value={set.level}
                            onChange={(e) => updateSet(slot, { level: Math.max(format.level.min, Math.min(format.level.max, Math.round(Number(e.target.value)) || format.level.min)) })}
                          />
                        )}
                      </Field>
                    </div>
                    {ability && (
                      <p className="text-xs text-muted">
                        <b className="text-fg">{ability.name}</b>: {ability.shortDesc}
                      </p>
                    )}
                    {item && (
                      <p className="text-xs text-muted">
                        <b className="text-fg">{item.name}</b>: {item.shortDesc}
                      </p>
                    )}
                    <SpriteHistory species={species} />
                  </div>
                )}

                <AdvancedDetails set={set} species={species} dex={dex} format={format} defaultOpen={false} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Compact 2-column move chips; tapping a chip (or an empty "+ Add move" chip) opens an inline search. */
function MoveChips({
  set,
  dex,
  moveOptions,
  badMove,
  onSetMove,
}: {
  set: PokemonSet;
  dex: Dex;
  moveOptions: ReturnType<typeof useMoveOptions>;
  badMove: (id: string) => boolean;
  onSetMove: (index: number, id: string) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editing !== null) wrapRef.current?.querySelector('input')?.focus();
  }, [editing]);

  return (
    <div className="grid grid-cols-2 gap-2">
      {set.moves.map((m, mi) => {
        if (editing === mi) {
          return (
            <div key={mi} ref={wrapRef} className="col-span-2 flex items-center gap-2">
              <Combobox
                className="flex-1"
                aria-label={`Move ${mi + 1}`}
                options={moveOptions}
                value={m}
                allowClear
                placeholder="Search moves…"
                invalid={!!m && badMove(m)}
                onChange={(id) => {
                  onSetMove(mi, id);
                  setEditing(null);
                }}
              />
              <Button size="icon" variant="ghost" aria-label="Done" onClick={() => setEditing(null)}>
                <X size={14} />
              </Button>
            </div>
          );
        }
        const mv = dex.move(m);
        return (
          <button
            key={mi}
            type="button"
            onClick={() => setEditing(mi)}
            className={cn(
              'flex h-11 items-center gap-1.5 rounded-lg border px-2.5 text-left text-sm',
              m ? 'border-border bg-surface-2' : 'border-dashed border-border/70 text-muted',
              m && badMove(m) && 'border-bad',
            )}
          >
            {mv ? <TypeBadge type={mv.type} size="xs" /> : <Plus size={14} className="shrink-0" />}
            <span className="truncate">{mv?.name ?? 'Add move'}</span>
          </button>
        );
      })}
    </div>
  );
}

function SlotStatDistributor(props: Omit<Parameters<typeof StatDistributor>[0], 'megaActive' | 'onMegaActive'>) {
  const [battle, updateBattle] = useSlotBattle(props.set.uid, !!props.mega);
  return <StatDistributor {...props} megaActive={battle.side.mega} onMegaActive={(mega) => updateBattle({ side: { ...battle.side, mega } })} />;
}
