import type { Dex } from '@/data/dex';
import { withSpreadValue, spreadKey } from '@/domain/stats';
import type { FormatRules, PokemonSet } from '@/domain/types';
import { StatDistributor } from './StatDistributor';

/**
 * The builder's stat sliders (with the nature buttons and presets) for a Pokémon that isn't on my
 * team: the opponent in a goal or a search. `onChange` gets only the fields that changed.
 */
export function OpponentStats({ dex, format, set, onChange }: { dex: Dex; format: FormatRules; set: PokemonSet; onChange: (patch: Partial<PokemonSet>) => void }) {
  const species = dex.species(set.speciesId);
  if (!species) return null;
  const key = spreadKey(format.statSystem);
  return (
    <StatDistributor
      set={set}
      species={species}
      mega={dex.megaFor(set.speciesId, set.itemId)}
      format={format}
      dex={dex}
      noOptimise
      onSpread={(stat, value) => onChange({ [key]: withSpreadValue(set, format.statSystem, key, stat, value)[key] })}
      onReplaceSpread={(spread) => onChange({ [key]: spread })}
      onNature={(nature) => onChange({ nature })}
    />
  );
}
