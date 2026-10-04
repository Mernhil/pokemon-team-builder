/**
 * Abilities that change how type matchups play out, applied on top of the type chart: immunities
 * (Levitate, Flash Fire…), resisting abilities (Thick Fat…), weaknesses (Fluffy, Dry Skin), and on the
 * attacking side the "-ate" abilities (Pixilate…), Scrappy and Tinted Lens. Pure and React-free.
 * Used by the type matrices, the Team check, the Matchup builder and the bring planner; the Damage
 * Calc and the Threat report get the same from @smogon/calc.
 */
import type { Dex } from '@/data/dex';
import { toID } from '@/data/dex';
import type { MoveType, PokemonSet, TypeName } from './types';

/** Multiplier an ability puts on damage of a type, on top of the type chart (0 = immune). */
const DEFENSIVE: Record<string, Partial<Record<TypeName, number>>> = {
  levitate: { Ground: 0 },
  eartheater: { Ground: 0 },
  flashfire: { Fire: 0 },
  wellbakedbody: { Fire: 0 },
  waterabsorb: { Water: 0 },
  stormdrain: { Water: 0 },
  dryskin: { Water: 0, Fire: 1.25 },
  voltabsorb: { Electric: 0 },
  lightningrod: { Electric: 0 },
  motordrive: { Electric: 0 },
  sapsipper: { Grass: 0 },
  thickfat: { Fire: 0.5, Ice: 0.5 },
  heatproof: { Fire: 0.5 },
  waterbubble: { Fire: 0.5 },
  fluffy: { Fire: 2 },
  purifyingsalt: { Ghost: 0.5 },
};

/** Abilities that turn Normal-type moves into another type (and Normalize turns every move Normal). */
const CHANGES_NORMAL: Record<string, TypeName> = { pixilate: 'Fairy', aerilate: 'Flying', refrigerate: 'Ice', galvanize: 'Electric' };

/** Attacker abilities that ignore the target's ability. */
const BREAKS_ABILITIES = new Set(['moldbreaker', 'teravolt', 'turboblaze']);

/** The ability a set really has in battle: its Mega's when it holds the stone and `mega` is on. */
export function activeAbility(dex: Dex, set: Pick<PokemonSet, 'speciesId' | 'itemId' | 'abilityId'>, mega: boolean): string | undefined {
  const form = mega ? dex.megaFor(set.speciesId, set.itemId) : undefined;
  const id = form ? Object.values(form.abilities)[0] : set.abilityId;
  return id ? toID(id) : undefined;
}

/**
 * The damage multiplier of one attacking type against a defender: the type chart, then the
 * defender's ability (skipped when the attacker breaks it), then the attacker's own ability
 * (Scrappy / Mind's Eye into Ghost, Tinted Lens on resisted hits).
 */
export function typeMultiplier(
  dex: Dex,
  attack: MoveType,
  defenderTypes: TypeName[],
  abilities: { defender?: string; attacker?: string } = {},
): number {
  const att = abilities.attacker ? toID(abilities.attacker) : undefined;
  let mult = dex.effectiveness(attack, defenderTypes);
  if (mult === 0 && (att === 'scrappy' || att === 'mindseye') && (attack === 'Normal' || attack === 'Fighting') && defenderTypes.includes('Ghost')) {
    mult = dex.effectiveness(attack, defenderTypes.filter((t) => t !== 'Ghost'));
  }
  const def = abilities.defender ? toID(abilities.defender) : undefined;
  if (def && !(att && BREAKS_ABILITIES.has(att))) {
    if (def === 'wonderguard') mult = mult > 1 ? mult : 0;
    else mult *= DEFENSIVE[def]?.[attack as TypeName] ?? 1;
  }
  if (att === 'tintedlens' && mult > 0 && mult < 1) mult *= 2;
  return mult;
}

/** The type a move really has for an attacker with this ability. */
export function moveTypeFor(moveType: MoveType, attackerAbility?: string): MoveType {
  const att = attackerAbility ? toID(attackerAbility) : undefined;
  if (!att) return moveType;
  if (att === 'normalize') return 'Normal';
  return moveType === 'Normal' && CHANGES_NORMAL[att] ? CHANGES_NORMAL[att] : moveType;
}

/** What an ability does to incoming damage of each type, for display ("Levitate: immune to Ground"). */
export function abilityTypeEffects(abilityId: string): { type: TypeName; mult: number }[] {
  return Object.entries(DEFENSIVE[toID(abilityId)] ?? {}).map(([type, mult]) => ({ type: type as TypeName, mult: mult as number }));
}
