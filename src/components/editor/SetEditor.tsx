import { lazy, Suspense, type ComponentProps } from 'react';
import { Info, Sparkles, Trash2 } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { formatMechanics } from '@/domain/games';
import { ABILITY_INTERACTIONS, ITEM_INTERACTIONS } from '@/domain/mechanics';
import { spreadKey, sumStats } from '@/domain/stats';
import { createSet } from '@/domain/team';
import type { FormatRules, PokemonSet, TeraType } from '@/domain/types';
import type { Issue } from '@/domain/validation';
import { useSlotBattle, useTeamStore } from '@/store/teamStore';
import { Combobox } from '../ui/Combobox';
import { GenBadge } from '../ui/GenBadge';
import { InfoTooltip } from '../ui/InfoTooltip';
import { ItemSprite } from '../ui/ItemSprite';
import { MoveTooltip } from '../ui/MoveTooltip';
import { Sprite } from '../ui/Sprite';
import { Button, Chip, Disclosure, Field, Input, Panel, Select, TypeBadge } from '../ui/primitives';
import { useIsPhone } from '../ui/useMedia';
import { typeGradient } from '../ui/styles';
import { AdvancedDetails } from './AdvancedDetails';
import { NaturePicker } from './NaturePicker';
import { comboProps, optionCount, useItemPicker, useMovePicker } from './options';
import { SpeciesPicker } from './SpeciesPicker';
import { SpriteHistory } from './SpriteHistory';
import { StatDistributor } from './StatDistributor';
import { BenchmarkList } from './BenchmarkList';
import { SetNotes } from './SetNotes';
import { mergeBenchmarks } from '@/domain/benchmarks';

// The meta data behind the recommendations loads on first use, outside the first-load bundle.
const RecommendedPanel = lazy(() => import('./RecommendedPanel').then((m) => ({ default: m.RecommendedPanel })));
const RecommendedItemsInfo = lazy(() => import('./RecommendedPanel').then((m) => ({ default: m.RecommendedItemsInfo })));

interface Props {
  teamId: string;
  slot: number;
  set: PokemonSet | null;
  dex: Dex;
  format: FormatRules;
  issues: Issue[];
}

export function SetEditor({ teamId, slot, set, dex, format, issues }: Props) {
  const { setSlot: setSlotRaw, updateSet: updateSetRaw, setMove: setMoveRaw, setSpread: setSpreadRaw } = useTeamStore.getState();
  const setSlot = (i: number, p: PokemonSet | null) => setSlotRaw(teamId, i, p);
  const updateSet = (i: number, patch: Partial<PokemonSet>) => updateSetRaw(teamId, i, patch);
  const setMove = (i: number, mi: number, moveId: string) => setMoveRaw(teamId, i, mi, moveId);
  const setSpread = (i: number, kind: 'sp' | 'evs' | 'ivs', stat: Parameters<typeof setSpreadRaw>[3], value: number) => setSpreadRaw(teamId, i, kind, stat, value);
  const mech = formatMechanics(format);
  const champions = format.statSystem.kind === 'champions-sp';

  const isPhone = useIsPhone();
  const itemPicker = useItemPicker(dex, format, set?.speciesId);
  const movePicker = useMovePicker(dex, format, set);

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
  if (!species) {
    return (
      <Panel
        title="Unknown species"
        actions={
          <Button size="sm" variant="ghost" onClick={() => setSlot(slot, null)} aria-label="Remove Pokémon">
            <Trash2 size={13} /> Remove
          </Button>
        }
      >
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted">
            &ldquo;{set.speciesId}&rdquo; isn&apos;t in {format.shortName}&apos;s Pokédex — it may belong to a different format or regulation. Remove it, or pick a
            replacement {champions ? 'legal in' : 'from'} {format.shortName}.
          </p>
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
  const mega = format.capabilities.mega ? dex.megaFor(species.id, set.itemId) : undefined;
  // Aegislash-Blade, Palafin-Hero…: another set of base stats the same Pokémon fights with.
  const statForm = dex.statForm(species.id);
  const ability = dex.ability(set.abilityId);
  const item = dex.item(set.itemId);
  const slotIssues = issues.filter((i) => i.slot === slot && i.severity !== 'info');
  const badMove = (id: string) => !dex.canLearn(species.id, id) || (!!format.regulationId && !dex.move(id)?.legalIn.includes(format.regulationId));

  return (
    <div className="space-y-4">
      {/* Identity: who this is and how it's set up. */}
      <Panel
        title={<span className="sr-only">Slot {slot + 1}: {set.nickname || species.name}</span>}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setSlot(slot, null)}>
            <Trash2 size={14} aria-hidden /> Remove
          </Button>
        }
        bodyClassName="pt-0"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <div className="relative flex size-24 sm:size-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl" style={{ background: typeGradient(species.types) }}>
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/25" aria-hidden />
              <Sprite speciesId={species.id} name={species.name} types={species.types} set={format.spriteSet} size={96} className="drop-shadow-[0_3px_4px_rgb(0_0_0/0.45)]" />
              {mega && (
                <span className="absolute right-1 bottom-1 rounded-lg bg-black/35 p-0.5" title={mega.name}>
                  <Sprite speciesId={mega.id} name={mega.name} types={mega.types} set={format.spriteSet} size={34} />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-sm">
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
              <div className="font-mono text-xs text-muted">National Dex #{species.num}</div>
              {mega && (
                <Chip tone="accent" icon={Sparkles} className="max-w-full">
                  <span className="truncate">
                    {mega.name} · {mega.types.join('/')} · {Object.values(mega.abilities)[0]}
                  </span>
                </Chip>
              )}
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 content-start gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {(mech.heldItems || mech.megaStoneOnly) && (
            <Field
              label={mech.megaStoneOnly ? 'Mega Stone (in the Bag)' : 'Held item'}
              hint={
                <>
                  {item?.shortDesc && (
                    <InfoTooltip title={item.name} summary={item.shortDesc} interactions={ITEM_INTERACTIONS[item.id]} label={`About ${item.name}`}>
                      <span className="inline-flex size-6 items-center justify-center"><Info size={14} aria-hidden /></span>
                    </InfoTooltip>
                  )}
                  {format.datasetId === 'champions' && (
                    <Suspense fallback={null}>
                      <RecommendedItemsInfo dex={dex} format={format} speciesId={species.id} />
                    </Suspense>
                  )}
                </>
              }
            >
              <Combobox
                aria-label="Held item"
                {...comboProps(itemPicker)}
                value={set.itemId}
                allowClear
                placeholder="None"
                icon={<ItemSprite itemId={set.itemId} name={item?.name} size={18} />}
                invalid={slotIssues.some((i) => i.code.startsWith('item'))}
                onChange={(id) => {
                  itemPicker.remember(id);
                  updateSet(slot, { itemId: id || undefined });
                }}
              />
            </Field>
            )}
            {mech.abilities && (
            <Field
              label="Ability"
              hint={
                ability?.shortDesc && (
                  <InfoTooltip title={ability.name} summary={ability.shortDesc} interactions={ABILITY_INTERACTIONS[ability.id]} label={`About ${ability.name}`}>
                    <span className="inline-flex size-6 items-center justify-center"><Info size={14} aria-hidden /></span>
                  </InfoTooltip>
                )
              }
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
            {mech.natures && (
            <Field label={champions ? 'Stat alignment (nature)' : 'Nature'}>
              <NaturePicker dex={dex} value={set.nature} onChange={(nature) => updateSet(slot, { nature })} />
            </Field>
            )}
            {format.capabilities.tera && (
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
            <Field label="Nickname">
              <Input value={set.nickname ?? ''} placeholder={species.name} maxLength={12} onChange={(e) => updateSet(slot, { nickname: e.target.value || undefined })} />
            </Field>
            {/* Champions' level is fixed at 50 (shown with the stats), so it gets no field. */}
            {!format.level.fixed && (
            <Field label="Level">
              {(
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
            )}
          </div>
        </div>
        {(ability || item) && (
          <div className="mt-4 space-y-1 text-sm text-muted">
            {ability && (
              <p>
                <InfoTooltip title={ability.name} summary={ability.shortDesc} interactions={ABILITY_INTERACTIONS[ability.id]}>
                  <b className="text-fg underline decoration-dotted underline-offset-2">{ability.name}</b>
                </InfoTooltip>
                : {ability.shortDesc}
              </p>
            )}
            {item && (
              <p>
                <InfoTooltip title={item.name} summary={item.shortDesc} interactions={ITEM_INTERACTIONS[item.id]}>
                  <b className="text-fg underline decoration-dotted underline-offset-2">{item.name}</b>
                </InfoTooltip>
                : {item.shortDesc}
              </p>
            )}
          </div>
        )}
        <SpriteHistory species={species} />
      </Panel>

      {format.datasetId === 'champions' && (
        <Suspense fallback={null}>
          <RecommendedPanel dex={dex} format={format} set={set} onApply={(patch) => updateSet(slot, patch)} />
        </Suspense>
      )}

      {/* Moves: four cards, two per row. */}
      <Panel
        title="Moves"
        actions={
          <span className="text-xs text-muted">
            {optionCount(movePicker.groups)} legal in {format.shortName}
            {species.provisionalLearnset && <span className="text-warn"> · provisional (Scarlet/Violet learnset)</span>}
          </span>
        }
      >
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {set.moves.map((m, mi) => {
            const mv = dex.move(m);
            return (
              <div key={mi} className="flex min-w-0 items-center gap-2 rounded-xl bg-surface-2 p-1.5 pl-2.5">
                <span className="w-3 text-xs font-semibold text-muted" aria-hidden>
                  {mi + 1}
                </span>
                <Combobox
                  className="min-w-0 flex-1"
                  aria-label={`Move ${mi + 1}`}
                  {...comboProps(movePicker)}
                  value={m}
                  allowClear
                  placeholder="Add a move"
                  invalid={!!m && badMove(m)}
                  onChange={(id) => {
                    movePicker.remember(id);
                    setMove(slot, mi, id);
                  }}
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
      </Panel>

      {/* Stats: open on wider screens; on phones a one-line summary that expands (progressive disclosure). */}
      {(() => {
        const title = { 'champions-sp': 'Stat Point Calculator', 'modern-ev': 'EVs & IVs', 'gb-statexp': 'Stat Exp & DVs', 'lgpe-av': 'AVs, IVs & Friendship', 'pla-effort': 'Effort Levels' }[format.statSystem.kind];
        const note = champions ? 'Lv 50 · 31 IVs · 1 SP = +1 stat' : `Lv ${set.level} · ${format.game ? format.shortName : `Gen ${format.generation}`} stat formula`;
        const sys = format.statSystem;
        const cap = sys.kind === 'champions-sp' || sys.kind === 'modern-ev' ? sys.totalCap : 0;
        const used = sumStats(sys.kind === 'champions-sp' ? set.sp : set.evs);
        const summary = [cap ? `${used}/${cap} ${champions ? 'SP' : 'EVs'}` : null, mech.natures ? set.nature : null].filter(Boolean).join(' · ');
        const body = (
          <SlotStatDistributor
            slotKey={`${teamId}:${slot}`}
            set={set}
            species={species}
            mega={mega ?? statForm}
            altLabel={mega ? undefined : statForm?.forme}
            format={format}
            dex={dex}
            onSpread={(stat, v) => setSpread(slot, spreadKey(format.statSystem), stat, v)}
            onReplaceSpread={(spread) => updateSet(slot, { [spreadKey(format.statSystem)]: spread })}
            onIV={format.fixedIVs ? undefined : (stat, v) => setSpread(slot, 'ivs', stat, v)}
            onNature={(nature) => updateSet(slot, { nature })}
            onKeepBenchmarks={(list) => updateSet(slot, { benchmarks: mergeBenchmarks(set.benchmarks, list) })}
            onFriendship={format.statSystem.kind === 'lgpe-av' ? (friendship) => updateSet(slot, { friendship }) : undefined}
          />
        );
        return isPhone ? (
          <Disclosure title={title} summary={summary}>
            <p className="mb-2 text-xs text-muted">{note}</p>
            {body}
          </Disclosure>
        ) : (
          <Panel title={title} actions={<span className="text-xs text-muted">{note}</span>}>
            {body}
          </Panel>
        );
      })()}

      {set.benchmarks?.length ? (
        <div className="rounded-xl border border-border bg-surface p-3">
          <BenchmarkList dex={dex} format={format} set={set} onChange={(benchmarks) => updateSet(slot, { benchmarks })} />
        </div>
      ) : null}

      <SetNotes set={set} onChange={(notes) => updateSet(slot, { notes })} />

      <AdvancedDetails set={set} species={species} dex={dex} format={format} />
    </div>
  );
}

/** Stat distributor whose Base/Mega switch drives the same Mega toggle as Advanced details. */
function SlotStatDistributor(props: Omit<ComponentProps<typeof StatDistributor>, 'megaActive' | 'onMegaActive'>) {
  const [battle, updateBattle] = useSlotBattle(props.set.uid, !!props.mega);
  // A battle forme (not a Mega) is only a stats comparison: the switch is local, the Mega toggle isn't involved.
  if (props.altLabel) return <StatDistributor {...props} />;
  return (
    <StatDistributor
      {...props}
      megaActive={battle.side.megaMode !== 'base'}
      onMegaActive={(on) => updateBattle({ side: { ...battle.side, megaMode: on ? 'mega' : 'base' } })}
    />
  );
}
