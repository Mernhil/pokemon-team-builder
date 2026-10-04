import type { Dex } from '@/data/dex';
import { formatMechanics } from '@/domain/games';
import type { FormatRules, PokemonSet } from '@/domain/types';
import { NaturePicker } from '../editor/NaturePicker';
import { OpponentStats } from '../editor/OpponentStats';
import { comboProps, useItemPicker, useMovePicker } from '../editor/options';
import { Combobox } from '../ui/Combobox';
import { ItemSprite } from '../ui/ItemSprite';
import { Field, Select } from '../ui/primitives';

/** A compact set editor for the opponent in a condition: item, ability, nature, spread and moves. */
export function TargetEditor({ dex, format, set, onChange }: { dex: Dex; format: FormatRules; set: PokemonSet; onChange: (patch: Partial<PokemonSet>) => void }) {
  const itemPicker = useItemPicker(dex, format, set.speciesId);
  const movePicker = useMovePicker(dex, format, set);
  const mech = formatMechanics(format);
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
            <NaturePicker dex={dex} value={set.nature} onChange={(nature) => onChange({ nature })} />
          </Field>
        )}
      </div>
      <OpponentStats dex={dex} format={format} set={set} onChange={onChange} />
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
