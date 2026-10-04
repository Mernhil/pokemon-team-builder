import { Crosshair, Sparkles, Info } from 'lucide-react';
import type { Dex } from '@/data/dex';
import { defaultSide } from '@/domain/battle/conditions';
import { statFormOptions } from '@/domain/battle/statForm';
import { stripUnsupported } from '@/domain/capabilities';
import { ABILITY_INTERACTIONS, ITEM_INTERACTIONS } from '@/domain/mechanics';
import { createSet } from '@/domain/team';
import { STAT_LABELS, type FormatRules, type Team, type TeraType } from '@/domain/types';
import { useCalcStore, type SideKey } from '@/store/calcStore';
import { SideControls } from '../battle/Controls';
import { SpeciesPicker } from '../editor/SpeciesPicker';
import { StatDistributor } from '../editor/StatDistributor';
import { comboProps, useItemPicker, useMovePicker } from '../editor/options';
import { Combobox } from '../ui/Combobox';
import { GenBadge } from '../ui/GenBadge';
import { InfoTooltip } from '../ui/InfoTooltip';
import { ItemSprite } from '../ui/ItemSprite';
import { MoveTooltip } from '../ui/MoveTooltip';
import { Sprite } from '../ui/Sprite';
import { Field, Input, Panel, Select, TypeBadge } from '../ui/primitives';
import { cn } from '../ui/styles';
import { formatMechanics } from '@/domain/games';
import { spreadKey, sumStats, withSpreadValue } from '@/domain/stats';

interface Props {
  role: SideKey;
  dex: Dex;
  format: FormatRules;
  team: Team;
}

/** One side of the damage calculator — same building blocks as the team editor. */
export function CalcSideEditor({ role, dex, format, team }: Props) {
  const side = useCalcStore((s) => s[role]);
  const { setSide, patchSet, patchCond, patchSide } = useCalcStore.getState();
  const set = side.set;
  const itemPicker = useItemPicker(dex, format, set?.speciesId);
  const movePicker = useMovePicker(dex, format, set);
  const species = set ? dex.species(set.speciesId) : undefined;
  const mega = set && format.capabilities.mega ? dex.megaFor(set.speciesId, set.itemId) : undefined;
  const forme = side.cond.megaMode !== 'base' && mega ? mega : species;

  const loadFromTeam = (i: number) => {
    const s = team.slots[i];
    if (!s) return;
    const hasMega = format.capabilities.mega && !!dex.megaFor(s.speciesId, s.itemId);
    setSide(role, {
      set: stripUnsupported(structuredClone(s), format.capabilities),
      cond: defaultSide(hasMega),
      crits: [false, false, false, false],
      origin: { teamName: team.name, slot: i },
    });
  };

  const title = role === 'attacker' ? 'Attacker' : 'Defender';
  const sys = format.statSystem;
  const mech = formatMechanics(format);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full', role === 'attacker' ? 'bg-bad' : 'bg-accent')} />
          {title}
          {side.origin && (
            <span className="text-xs font-normal text-muted">
              from {side.origin.teamName} · slot {side.origin.slot + 1}
            </span>
          )}
        </span>
      }
    >
      <div className="space-y-4">
        {/* Quick load from the active team */}
        <div>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Load from {team.name}</div>
          <div className="flex flex-wrap gap-1">
            {team.slots.map((s, i) => {
              const sp = s && dex.species(s.speciesId);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!sp}
                  onClick={() => loadFromTeam(i)}
                  title={sp ? `Load ${sp.name}` : 'Empty slot'}
                  className={cn(
                    'rounded-lg border p-0.5 transition-colors disabled:opacity-30',
                    s && set && s.uid === set.uid ? 'border-accent bg-accent/10' : 'border-border hover:border-muted/60',
                  )}
                >
                  {sp ? <Sprite speciesId={sp.id} name={sp.name} types={sp.types} set={format.spriteSet} size={36} /> : <div className="h-9 w-9" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Identity */}
        <div className="flex items-start gap-3">
          {forme ? (
            <Sprite speciesId={forme.id} name={forme.name} types={forme.types} set={format.spriteSet} size={72} backdrop />
          ) : (
            <div className="h-[72px] w-[72px] rounded-xl bg-surface-2" />
          )}
          <div className="min-w-0 flex-1 space-y-1.5">
            <SpeciesPicker
              anyRegulation
              showGenFilter={!set}
              dex={dex}
              format={format}
              value={set?.speciesId}
              onChange={(id) => {
                if (!id) return;
                const next = createSet(dex, id, format);
                setSide(role, { set: next, cond: defaultSide(false), crits: [false, false, false, false] });
              }}
            />
            {forme && (
              <div className="flex flex-wrap items-center gap-1">
                {forme.types.map((t) => (
                  <TypeBadge key={t} type={t} />
                ))}
                <GenBadge gen={forme.gen} size="xs" className="ml-1" />
                {forme !== species && (
                  <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-accent">
                    <Sparkles size={11} /> {forme.name}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {set && species && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(mech.heldItems || mech.megaStoneOnly) && (
              <Field
                label={mech.megaStoneOnly ? 'Mega Stone' : 'Held item'}
                hint={
                  dex.item(set.itemId)?.shortDesc && (
                    <InfoTooltip title={dex.item(set.itemId)!.name} summary={dex.item(set.itemId)!.shortDesc} interactions={ITEM_INTERACTIONS[set.itemId!]} label={`About ${dex.item(set.itemId)!.name}`}>
                      <span className="inline-flex size-6 items-center justify-center"><Info size={14} aria-hidden /></span>
                    </InfoTooltip>
                  )
                }
              >
                <Combobox
                  aria-label={`${title} item`}
                  {...comboProps(itemPicker)}
                  value={set.itemId}
                  allowClear
                  placeholder="None"
                  icon={<ItemSprite itemId={set.itemId} name={dex.item(set.itemId)?.name} size={18} />}
                  onChange={(id) => {
                    itemPicker.remember(id);
                    const hadMega = !!mega;
                    const willMega = format.capabilities.mega && !!dex.megaFor(set.speciesId, id);
                    patchSet(role, { itemId: id || undefined });
                    if (willMega !== hadMega) patchCond(role, { megaMode: willMega ? 'both' : 'base' });
                  }}
                />
              </Field>
              )}
              {mech.abilities && (
              <Field
                label="Ability"
                hint={
                  dex.ability(set.abilityId)?.shortDesc && (
                    <InfoTooltip title={dex.ability(set.abilityId)!.name} summary={dex.ability(set.abilityId)!.shortDesc} interactions={ABILITY_INTERACTIONS[set.abilityId!]} label={`About ${dex.ability(set.abilityId)!.name}`}>
                      <span className="inline-flex size-6 items-center justify-center"><Info size={14} aria-hidden /></span>
                    </InfoTooltip>
                  )
                }
              >
                <Select value={set.abilityId ?? ''} onChange={(e) => patchSet(role, { abilityId: e.target.value })} disabled={forme !== species} title={forme !== species ? 'Mega Evolution sets the ability' : undefined}>
                  {forme !== species ? (
                    <option>{Object.values(forme!.abilities)[0]}</option>
                  ) : (
                    dex.abilitiesOf(species.id).map(({ slot, ability }) => (
                      <option key={slot} value={ability.id}>
                        {ability.name}
                        {slot === 'H' ? ' (Hidden)' : ''}
                      </option>
                    ))
                  )}
                </Select>
              </Field>
              )}
              {!format.level.fixed && (
                <Field label="Level">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={format.level.min}
                    max={format.level.max}
                    value={set.level}
                    onChange={(e) => patchSet(role, { level: Math.max(format.level.min, Math.min(format.level.max, Math.round(Number(e.target.value)) || format.level.min)) })}
                  />
                </Field>
              )}
              {mech.natures && (
              <Field label={sys.kind === 'champions-sp' ? 'Stat Alignment' : 'Nature'}>
                <Select value={set.nature} onChange={(e) => patchSet(role, { nature: e.target.value })}>
                  {dex.natures.map((n) => (
                    <option key={n.name} value={n.name}>
                      {n.name}
                      {n.plus && n.plus !== n.minus ? ` (+${STAT_LABELS[n.plus]} −${STAT_LABELS[n.minus!]})` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              )}
              {format.capabilities.tera && (
                <Field label="Tera Type">
                  <Select value={set.teraType ?? ''} onChange={(e) => patchSet(role, { teraType: (e.target.value || undefined) as TeraType | undefined })}>
                    <option value="">—</option>
                    {[...dex.types, 'Stellar'].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            {/* Moves + crit toggles */}
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Moves</div>
              <div className="grid grid-cols-1 gap-2">
                {set.moves.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Combobox
                      className="flex-1"
                      aria-label={`${title} move ${i + 1}`}
                      {...comboProps(movePicker)}
                      value={m}
                      allowClear
                      placeholder="Search moves…"
                      onChange={(id) => {
                        movePicker.remember(id);
                        const moves = [...set.moves] as typeof set.moves;
                        moves[i] = id;
                        patchSet(role, { moves });
                      }}
                    />
                    {m && dex.move(m) && (
                      <MoveTooltip move={dex.move(m)}>
                        <TypeBadge type={dex.move(m)!.type} size="xs" />
                      </MoveTooltip>
                    )}
                    <button
                      type="button"
                      aria-pressed={side.crits[i]}
                      title="Critical hit"
                      onClick={() => {
                        const crits = [...side.crits] as typeof side.crits;
                        crits[i] = !crits[i];
                        patchSide(role, { crits });
                      }}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-md border',
                        side.crits[i] ? 'border-warn bg-warn/15 text-warn' : 'border-border text-muted hover:text-fg',
                      )}
                    >
                      <Crosshair size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <SideControls
              cond={side.cond}
              onChange={(p) => patchCond(role, p)}
              ability={forme !== species ? Object.values(forme!.abilities)[0] : dex.ability(set.abilityId)?.name}
              canMega={!!mega && format.capabilities.mega}
              statForm={statFormOptions(dex, set)}
              canTera={format.capabilities.tera && !!set.teraType}
              teraType={set.teraType}
              gen={dex.generation}
              game={format.game}
            />

            {(
              <details className="group rounded-lg border border-border">
                <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-muted group-open:border-b group-open:border-border">
                  {sys.kind === 'champions-sp'
                    ? `Stat Points · ${sumStats(set.sp)}/${sys.totalCap}`
                    : sys.kind === 'modern-ev'
                      ? `EVs · ${sumStats(set.evs)}/${sys.totalCap} · Lv ${set.level}`
                      : sys.kind === 'lgpe-av'
                        ? `AVs & IVs · Lv ${set.level}`
                        : sys.kind === 'pla-effort'
                          ? `Effort Levels · Lv ${set.level}`
                          : `Stat Exp & DVs · Lv ${set.level}`}
                </summary>
                <div className="p-3">
                  <StatDistributor
                    set={set}
                    species={species}
                    mega={mega}
                    format={format}
                    dex={dex}
                    onSpread={(stat, v) => patchSet(role, withSpreadValue(set, sys, spreadKey(sys), stat, v))}
                    onReplaceSpread={(spread) => patchSet(role, { [spreadKey(sys)]: spread })}
                    onIV={format.fixedIVs ? undefined : (stat, v) => patchSet(role, withSpreadValue(set, sys, 'ivs', stat, v))}
                    onFriendship={sys.kind === 'lgpe-av' ? (friendship) => patchSet(role, { friendship }) : undefined}
                    onNature={(nature) => patchSet(role, { nature })}
                    megaActive={side.cond.megaMode !== 'base'}
                    onMegaActive={(on) => patchCond(role, { megaMode: on ? 'mega' : 'base' })}
                  />
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
