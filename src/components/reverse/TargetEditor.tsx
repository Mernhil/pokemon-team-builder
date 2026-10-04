import type { Dex } from '@/data/dex';
import { formatMechanics } from '@/domain/games';
import { investRange, spreadKey } from '@/domain/stats';
import { STAT_IDS, STAT_LABELS, type FormatRules, type PokemonSet, type StatId } from '@/domain/types';
import { comboProps, useItemPicker, useMovePicker } from '../editor/options';
import { Combobox } from '../ui/Combobox';
import { ItemSprite } from '../ui/ItemSprite';
import { Field, Input, Select } from '../ui/primitives';

/** A compact set editor for the opponent in a condition: item, ability, nature, spread and moves. */
export function TargetEditor({ dex, format, set, onChange }: { dex: Dex; format: FormatRules; set: PokemonSet; onChange: (patch: Partial<PokemonSet>) => void }) {
  const itemPicker = useItemPicker(dex, format, set.speciesId);
  const movePicker = useMovePicker(dex, format, set);
  const mech = formatMechanics(format);
  const key = spreadKey(format.statSystem);
  const { max } = investRange(format.statSystem);
  const spread = set[key];
  const name = dex.species(set.speciesId)?.name ?? set.speciesId;

  return (
    <div className="space-y-3 pt-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {(mech.heldItems || mech.megaStoneOnly) && (
          <Field label="Item">
            <Combobox
              aria-label={`${name} item`}
              {...comboProps(itemPicker)}
              value={set.itemId}
              allowClear
              placeholder="None"
              icon={<ItemSprite itemId={set.itemId} name={dex.item(set.itemId)?.name} size={18} />}
              onChange={(id) => {
                itemPicker.remember(id);
                onChange({ itemId: id || undefined });
              }}
            />
          </Field>
        )}
        {mech.abilities && (
          <Field label="Ability">
            <Select aria-label={`${name} ability`} value={set.abilityId ?? ''} onChange={(e) => onChange({ abilityId: e.target.value })}>
              {dex.abilitiesOf(set.speciesId).map(({ slot, ability }) => (
                <option key={slot} value={ability.id}>
                  {ability.name}
                  {slot === 'H' ? ' (Hidden)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {mech.natures && (
          <Field label={format.statSystem.kind === 'champions-sp' ? 'Stat alignment' : 'Nature'}>
            <Select aria-label={`${name} nature`} value={set.nature} onChange={(e) => onChange({ nature: e.target.value })}>
              {dex.natures.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                  {n.plus && n.plus !== n.minus ? ` (+${STAT_LABELS[n.plus]} −${STAT_LABELS[n.minus!]})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{format.statSystem.kind === 'champions-sp' ? 'Stat Points' : 'Investment'}</div>
        <div className="grid grid-cols-6 gap-1.5">
          {STAT_IDS.map((s: StatId) => (
            <label key={s} className="flex flex-col items-center gap-0.5 text-[11px] text-muted">
              {STAT_LABELS[s]}
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={max}
                aria-label={`${name} ${STAT_LABELS[s]}`}
                value={spread[s]}
                onFocus={(e) => e.target.select()}
                onChange={(e) => onChange({ [key]: { ...spread, [s]: Math.max(0, Math.min(max, Math.round(Number(e.target.value)) || 0)) } })}
                className="no-spin h-8 px-1 text-center font-mono text-sm tabular-nums"
              />
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {set.moves.map((m, i) => (
          <Combobox
            key={i}
            aria-label={`${name} move ${i + 1}`}
            {...comboProps(movePicker)}
            value={m}
            allowClear
            placeholder="Search moves…"
            onChange={(id) => {
              movePicker.remember(id);
              const moves = [...set.moves] as PokemonSet['moves'];
              moves[i] = id;
              onChange({ moves });
            }}
          />
        ))}
      </div>
    </div>
  );
}
