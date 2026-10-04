/**
 * Stat-changing battle formes (Aegislash Shield/Blade, Palafin Zero/Hero). Kept free of the calculator
 * so the builder can use it without loading @smogon/calc.
 */
import type { Dex } from '@/data/dex';
import type { PokemonSet } from '../types';
import type { SideConditions } from './conditions';

/** Which side of the exchange a Pokémon is on: decides Aegislash's forme. 'neutral' (speed, stat readouts) never swaps. */
export type CalcRole = 'attacker' | 'defender' | 'neutral';

/**
 * The stat-changing battle forme (Aegislash-Blade, Palafin-Hero) a side fights as, if not its base:
 * the player's pick, else Blade when a Stance Change user attacks.
 */
export function statFormeFor(dex: Dex, set: PokemonSet, cond: Pick<SideConditions, 'statForm'>, role: CalcRole) {
  const alt = dex.statForm(set.speciesId);
  if (!alt) return undefined;
  const choice = cond.statForm ?? 'auto';
  if (choice === 'alt') return alt;
  if (choice === 'base') return undefined;
  return role === 'attacker' && dex.ability(set.abilityId)?.id === 'stancechange' ? alt : undefined;
}

/** Labels for the Form selector of a Pokémon with a stat-changing forme, or undefined when it has none. */
export function statFormOptions(dex: Dex, set: PokemonSet): { alt: string; auto: string } | undefined {
  const alt = dex.statForm(set.speciesId);
  if (!alt) return undefined;
  const label = alt.forme || alt.name;
  return dex.ability(set.abilityId)?.id === 'stancechange'
    ? { alt: label, auto: `Auto: ${label} Forme when it attacks, base when it is hit.` }
    : { alt: label, auto: `Auto: base forme. Pick ${label} for after it has changed.` };
}
