import type { ComponentProps } from 'react';
import { Sparkles, Trash2 } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { formatMechanics } from '@/domain/games';
import { spreadKey } from '@/domain/stats';
import { createSet } from '@/domain/team';
import { STAT_LABELS, type FormatRules, type PokemonSet, type TeraType } from '@/domain/types';
import type { Issue } from '@/domain/validation';
import { useSlotBattle, useTeamStore } from '@/store/teamStore';
import { Combobox } from '../ui/Combobox';
import { GenBadge } from '../ui/GenBadge';
import { ItemSprite } from '../ui/ItemSprite';
import { MoveTooltip } from '../ui/MoveTooltip';
import { Sprite } from '../ui/Sprite';
import { Button, Field, Input, Panel, Select, TypeBadge } from '../ui/primitives';
import { AdvancedDetails } from './AdvancedDetails';
import { useItemOptions, useMoveOptions } from './options';
import { SpeciesPicker } from './SpeciesPicker';
import { SpriteHistory } from './SpriteHistory';
import { StatDistributor } from './StatDistributor';

interface Props {
  slot: number;
  set: PokemonSet | null;
  dex: Dex;
  format: FormatRules;
  issues: Issue[];
}

export function SetEditor({ slot, set, dex, format, issues }: Props) {
  const { setSlot, updateSet, setMove, setSpread } = useTeamStore.getState();
  const mech = formatMechanics(format);
  const champions = format.statSystem.kind === 'champions-sp';

  const itemOptions = useItemOptions(dex, format, set?.speciesId);
  const moveOptions = useMoveOptions(dex, format, set);

  if (!set) {
    return (
      <Panel title={`Slot ${slot + 1}`}>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted">Empty slot. Pick a Pokémon {champions ? 'legal in' : 'from'} {format.shortName}, or filter by generation.</p>
          <SpeciesPicker
            className="w-full max-w-md text-left"
            dex={dex}
            format={format}
            onChange={(id) => id && setSlot(slot, createSet(dex, id, format))}
          />
        </div>
      </Panel>
    );
  }

  const species = dex.species(set.speciesId);
  if (!species) return <Panel title="Unknown species">{set.speciesId}</Panel>;
  const mega = format.gimmicks.mega ? dex.megaFor(species.id, set.itemId) : undefined;
  const ability = dex.ability(set.abilityId);
  const item = dex.item(set.itemId);
  const slotIssues = issues.filter((i) => i.slot === slot && i.severity !== 'info');
  const badMove = (id: string) => !dex.canLearn(species.id, id) || (!!format.regulationId && !dex.move(id)?.legalIn.includes(format.regulationId));

  return (
    <div className="space-y-4">
      <Panel
        title={
          <span className="flex items-center gap-2">
            Slot {slot + 1}
            {mega && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                <Sparkles size={11} /> Mega-ready
              </span>
            )}
          </span>
        }
        actions={
          <Button size="sm" variant="ghost" onClick={() => setSlot(slot, null)} aria-label="Remove Pokémon">
            <Trash2 size={13} /> Remove
          </Button>
        }
      >
        {/* Identity */}
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="flex items-start gap-3 sm:w-72 sm:shrink-0">
            <div className="flex flex-col items-center gap-1">
              <Sprite speciesId={species.id} name={species.name} types={species.types} set={format.spriteSet} size={88} backdrop />
              {mega && (
                <div className="flex items-center gap-0.5 text-[10px] font-semibold text-accent" title={mega.name}>
                  <Sparkles size={10} />
                  <Sprite speciesId={mega.id} name={mega.name} types={mega.types} set={format.spriteSet} size={36} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <SpeciesPicker
                showGenFilter={false}
                dex={dex}
                format={format}
                value={species.id}
                onChange={(id) => {
                  if (!id || id === species.id) return;
                  const next = createSet(dex, id, format);
                  // Keep what transfers: item, nature, SP spread, nickname.
                  setSlot(slot, { ...next, uid: set.uid, itemId: set.itemId, nature: set.nature, sp: set.sp, evs: set.evs, ivs: set.ivs, nickname: set.nickname });
                }}
              />
              <div className="flex flex-wrap items-center gap-1">
                {species.types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
                <GenBadge gen={species.gen} label className="ml-1" />
              </div>
              <div className="font-mono text-[10px] text-muted">National Dex #{species.num}</div>
              {mega && (
                <div className="text-[11px] text-muted">
                  → <b className="text-fg">{mega.name}</b> · {mega.types.join('/')} · {Object.values(mega.abilities)[0]}
                </div>
              )}
            </div>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nickname">
              <Input value={set.nickname ?? ''} placeholder={species.name} maxLength={12} onChange={(e) => updateSet(slot, { nickname: e.target.value || undefined })} />
            </Field>
            {(mech.heldItems || mech.megaStoneOnly) && (
            <Field label={mech.megaStoneOnly ? 'Mega Stone (in the Bag)' : 'Held item'}>
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
            <Field label="Ability" hint={ability?.shortDesc && <span className="truncate" title={ability.shortDesc}>ⓘ</span>}>
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
        </div>
        {ability && <p className="mt-3 text-xs text-muted"><b className="text-fg">{ability.name}:</b> {ability.shortDesc}</p>}
        {item && <p className="mt-1 text-xs text-muted"><b className="text-fg">{item.name}:</b> {item.shortDesc}</p>}
        <SpriteHistory species={species} />

        {/* Moves */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Moves</span>
            <span className="text-[11px] text-muted">
              {moveOptions.length} legal in {format.shortName}
              {species.provisionalLearnset && <span className="text-warn"> · learnset provisional (Scarlet/Violet data)</span>}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {set.moves.map((m, mi) => {
              const mv = dex.move(m);
              return (
                <div key={mi} className="flex items-center gap-2">
                  <span className="w-3 text-xs text-muted">{mi + 1}</span>
                  <Combobox
                    className="flex-1"
                    aria-label={`Move ${mi + 1}`}
                    options={moveOptions}
                    value={m}
                    allowClear
                    placeholder="Search moves…"
                    invalid={!!m && badMove(m)}
                    onChange={(id) => setMove(slot, mi, id)}
                  />
                  {mv && (
                    <MoveTooltip move={mv}>
                      <TypeBadge type={mv.type} size="xs" />
                    </MoveTooltip>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Panel>

      <Panel
        title={{ 'champions-sp': 'Stat Point Calculator', 'modern-ev': 'EVs & IVs', 'gb-statexp': 'Stat Exp & DVs', 'lgpe-av': 'AVs, IVs & Friendship', 'pla-effort': 'Effort Levels' }[format.statSystem.kind]}
        actions={
          <span className="text-[11px] text-muted">
            {champions ? 'Lv 50 · 31 IVs · 1 SP = +1 stat' : `Lv ${set.level} · ${format.game ? format.shortName : `Gen ${format.generation}`} stat formula`}
          </span>
        }
      >
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
      </Panel>

      <AdvancedDetails set={set} species={species} dex={dex} format={format} />
    </div>
  );
}

/** Stat distributor whose Base/Mega switch drives the same Mega toggle as Advanced details. */
function SlotStatDistributor(props: Omit<ComponentProps<typeof StatDistributor>, 'megaActive' | 'onMegaActive'>) {
  const [battle, updateBattle] = useSlotBattle(props.set.uid, !!props.mega);
  return (
    <StatDistributor
      {...props}
      megaActive={battle.side.mega}
      onMegaActive={(mega) => updateBattle({ side: { ...battle.side, mega } })}
    />
  );
}
