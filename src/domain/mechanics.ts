/**
 * Field-effect glossary for weather and terrain, plus a curated set of ability/item "interactions"
 * (how a specific ability or item bends the weather/terrain/field rules above). Written to stay
 * consistent with what the damage calculator itself implements (src/domain/battle/effective.ts) —
 * base effects are well-known, static game mechanics rather than anything fetched or generated.
 *
 * Only "grounded" Pokémon are affected by terrain: Flying-types, Levitate holders and Air Balloon
 * holders are ungrounded (exempt) unless Gravity, Ingrain, Smack Down, Iron Ball or a Roost-less
 * Mega/Terastallization into a grounded type overrides that — noted once here rather than repeated
 * per terrain.
 */

import type { Terrain, Weather } from './battle/conditions';

export interface FieldEffectInfo {
  /** Human label, gen-aware for Snow/Hail. */
  name: string;
  /** One-line summary shown as the tooltip title/subtitle. */
  summary: string;
  /** Full bullet list of what it actually does. */
  effects: string[];
  /** Cross-mechanic notes: what counters it, what it blocks, what it combos with. */
  interactions: string[];
}

export function weatherInfo(id: Weather, snowName: 'Hail' | 'Snow' = 'Snow'): FieldEffectInfo | null {
  switch (id) {
    case 'Sun':
      return {
        name: 'Sun',
        summary: 'Fire moves stronger, Water moves weaker.',
        effects: [
          'Fire-type move damage ×1.5; Water-type move damage ×0.5.',
          'Solar Beam / Solar Blade skip their charge turn; Weather Ball becomes Fire-type at 2× power.',
          'Growth doubles its Atk/SpA boost (+2 instead of +1); Synthesis, Morning Sun and Moonlight heal 2/3 max HP instead of 1/2.',
          'Thunder and Hurricane drop to 50% accuracy (rain does the opposite — see Rain).',
        ],
        interactions: [
          'Chlorophyll doubles Speed; Solar Power boosts Sp. Atk ×1.5 but costs 1/8 max HP each turn; Flower Gift boosts Atk/Sp. Def of the user\'s side; Leaf Guard blocks status conditions; Harvest recovers a used berry roughly every other turn.',
          'Dry Skin and Solar Power holders take extra chip damage from being in Sun the same way they do from other harsh conditions being active.',
          'Overridden if Rain, Sand or Snow is set afterwards (weathers don\'t stack — whichever was set most recently is active); a Utility Umbrella holder ignores Sun\'s damage boosts entirely.',
          'Primal Groudon\'s Desolate Land variant can\'t be turned off by Rain/Sand/Snow, only by another Primal weather.',
        ],
      };
    case 'Rain':
      return {
        name: 'Rain',
        summary: 'Water moves stronger, Fire moves weaker.',
        effects: [
          'Water-type move damage ×1.5; Fire-type move damage ×0.5.',
          'Thunder and Hurricane never miss (ignoring accuracy checks); Solar Beam / Solar Blade drop to half power without a charge-turn skip.',
          'Weather Ball becomes Water-type at 2× power; Moonlight/Morning Sun/Synthesis only heal 1/4 max HP.',
        ],
        interactions: [
          'Swift Swim doubles Speed; Rain Dish heals 1/16 max HP each turn; Dry Skin heals 1/8 max HP each turn (but still takes Sun damage if it switches into Sun); Hydration cures status at end of turn; Forecast turns Castform Water-type.',
          'Overridden by a later Sun/Sand/Snow; a Utility Umbrella holder ignores Rain\'s damage boosts and accuracy changes for Thunder/Hurricane entirely.',
          'Primal Kyogre\'s Primordial Sea variant can\'t be turned off by Sun/Sand/Snow, only by another Primal weather.',
        ],
      };
    case 'Sand':
      return {
        name: 'Sandstorm',
        summary: 'Chip damage each turn; boosts Rock-type Sp. Def.',
        effects: [
          'Every non-immune Pokémon takes 1/16 max HP damage at the end of each turn.',
          'Rock-types gain a ×1.5 Special Defense boost while Sand is up (Gen 4+).',
          'Weather Ball becomes Rock-type at 2× power; Shore Up heals 2/3 max HP instead of 1/2 while Sand is active.',
        ],
        interactions: [
          'Immune to the chip damage: Rock, Ground and Steel types, plus Overcoat, Magic Guard and Sand Force/Sand Rush/Sand Veil holders.',
          'Sand Rush doubles Speed; Sand Force boosts Rock/Ground/Steel move power ×1.3 (but the holder still takes chip damage unless also immune by typing); Sand Veil raises evasion (older gens only — removed from competitive relevance by accuracy formula changes in modern gens, still technically active).',
          'Overridden by a later Sun/Rain/Snow; a Utility Umbrella holder still takes Sand\'s chip damage (Umbrella only blocks Sun/Rain-specific effects), Safety Goggles and Overcoat block it outright.',
        ],
      };
    case 'Snow':
      return {
        name: snowName,
        summary: snowName === 'Snow' ? 'Chip damage each turn; boosts Ice-type Defense.' : 'Chip damage each turn; no defensive boost.',
        effects: [
          'Every non-immune Pokémon takes 1/16 max HP damage at the end of each turn.',
          snowName === 'Snow'
            ? 'Ice-types gain a ×1.5 Defense boost while Snow is up (Gen 9+; Sand grants the equivalent to Rock-types).'
            : 'No defensive boost in this generation — that was introduced as Snow in Gen 9 (equivalent to what Sand does for Rock).',
          'Blizzard never misses while this is active; Aurora Veil can only be set up while it is; Weather Ball becomes Ice-type at 2× power.',
        ],
        interactions: [
          'Immune to the chip damage: Ice-types, plus Overcoat, Magic Guard, Ice Body and Snow Cloak holders.',
          'Ice Body heals 1/16 max HP each turn instead of taking damage; Slush Rush doubles Speed; Snow Cloak raises evasion (same caveat as Sand Veil).',
          'Overridden by a later Sun/Rain/Sand; a Utility Umbrella holder still takes the chip damage, Safety Goggles and Overcoat block it outright.',
        ],
      };
    default:
      return null;
  }
}

export function terrainInfo(id: Terrain): FieldEffectInfo | null {
  switch (id) {
    case 'Electric':
      return {
        name: 'Electric Terrain',
        summary: 'Boosts grounded Electric moves; blocks falling asleep.',
        effects: [
          'Electric-type move damage ×1.3 for grounded attackers.',
          'Grounded Pokémon cannot fall asleep, be put to sleep (Spore, Yawn, etc.) or use Rest — Yawn still fails to apply the drowsy counter to a grounded target.',
          'Rising Voltage doubles its power against a grounded target; Terrain Pulse becomes Electric-type here.',
          'Lasts 5 turns (8 with Terrain Extender); overwrites any other active terrain the instant it\'s set.',
        ],
        interactions: [
          'Surge Surfer doubles Speed while this is up; Quark Drive activates its stat boost (whichever stat is highest, Speed if tied) for grounded holders without needing a Booster Energy.',
          'Only affects grounded Pokémon — Flying-types, Levitate and Air Balloon holders get no boost and can still be put to sleep normally.',
        ],
      };
    case 'Grassy':
      return {
        name: 'Grassy Terrain',
        summary: 'Boosts grounded Grass moves, heals grounded Pokémon, weakens Earthquake.',
        effects: [
          'Grass-type move damage ×1.3 for grounded attackers.',
          'Grounded Pokémon recover 1/16 max HP at the end of each turn.',
          'Earthquake, Bulldoze and Steamroller deal half damage to grounded targets.',
          'Terrain Pulse becomes Grass-type here; lasts 5 turns (8 with Terrain Extender); overwrites any other active terrain.',
        ],
        interactions: [
          'Grass Pelt raises Defense ×1.5 while this is up; Grassy Seed grants a free +1 Defense the turn it activates.',
          'The Earthquake/Bulldoze/Steamroller reduction and the end-of-turn heal both only apply to grounded Pokémon; a Flying-type or Levitate holder takes full Earthquake damage but also gets no terrain healing.',
          'Blocks nothing from other terrains — it\'s independent of Misty\'s status immunity or Electric\'s sleep immunity; setting Grassy over another terrain simply replaces it.',
        ],
      };
    case 'Psychic':
      return {
        name: 'Psychic Terrain',
        summary: 'Boosts grounded Psychic moves; blocks priority against grounded targets.',
        effects: [
          'Psychic-type move damage ×1.3 for grounded attackers.',
          'Priority moves (Fake Out, Extreme Speed, Sucker Punch, Quick Attack, etc.) fail against a grounded target — the target\'s side is protected regardless of who set the terrain.',
          'Terrain Pulse becomes Psychic-type here; lasts 5 turns (8 with Terrain Extender); overwrites any other active terrain.',
          'Introduced in Gen 7 — not usable in earlier-gen formats.',
        ],
        interactions: [
          'Psychic Seed grants a free +1 Sp. Def the turn it activates.',
          'The priority block only protects grounded targets, and only from moves, not from priority-granting abilities that redirect rather than strike (e.g. it does not stop Follow Me/Rage Powder from being used, only attacks landing on a grounded target).',
        ],
      };
    case 'Misty':
      return {
        name: 'Misty Terrain',
        summary: 'Halves grounded Dragon damage; blocks status on grounded Pokémon.',
        effects: [
          'Dragon-type move damage ×0.5 against grounded targets.',
          'Grounded Pokémon can\'t be given a major status condition (burn, paralysis, poison, sleep, freeze) or be confused; existing conditions aren\'t cured.',
          'Yawn still lands but its drowsy counter fails to put a grounded target to sleep; Terrain Pulse becomes Fairy-type here.',
          'Lasts 5 turns (8 with Terrain Extender); overwrites any other active terrain.',
        ],
        interactions: [
          'Misty Seed grants a free +1 Sp. Def the turn it activates.',
          'Stacks with, but is independent of, status-immunity abilities (Immunity, Limber, Insomnia, etc.) — either alone is enough to block the relevant status.',
          'Only protects grounded Pokémon; a Flying-type ally on the same side can still be burned, paralyzed, etc. while Misty Terrain is up.',
        ],
      };
    default:
      return null;
  }
}

/**
 * Bounded, hand-curated set of ability interaction notes — abilities whose effect is defined
 * relative to weather, terrain or "grounded" status, matching what battle/effective.ts models plus
 * the handful of others players actually ask about in that context.
 */
export const ABILITY_INTERACTIONS: Record<string, string[]> = {
  chlorophyll: ['Doubles Speed while Sun is active (including Primal/Desolate Land sun).'],
  swiftswim: ['Doubles Speed while Rain is active (including Primal/Primordial Sea rain).'],
  sandrush: ['Doubles Speed while Sand is active; also grants immunity to Sand chip damage.'],
  slushrush: ['Doubles Speed while Snow/Hail is active; also grants immunity to its chip damage.'],
  surgesurfer: ['Doubles Speed while Electric Terrain is active (grounded or not — this one ignores the grounded requirement).'],
  solarpower: ['Boosts Sp. Atk ×1.5 in Sun, but costs 1/8 max HP at the end of each turn Sun is up.'],
  sandforce: ['Boosts Rock/Ground/Steel move power ×1.3 in Sand; the holder still needs Rock/Ground/Steel typing or Overcoat/Sand immunity to avoid Sand\'s own chip damage.'],
  sandveil: ['Raises evasion while Sand is active (accuracy-check era mechanic; still technically live).'],
  snowcloak: ['Raises evasion while Snow/Hail is active (same caveat as Sand Veil).'],
  icebody: ['Heals 1/16 max HP at the end of each turn Snow/Hail is active instead of taking chip damage.'],
  raindish: ['Heals 1/16 max HP at the end of each turn Rain is active.'],
  dryskin: ['Heals 1/8 max HP each turn in Rain but takes extra Fire damage and loses 1/8 max HP each turn in Sun.'],
  flowergift: ['Boosts the user\'s and allies\' Atk (and, for the user, Sp. Def) while Sun is active — a field-wide buff, not just personal.'],
  leafguard: ['Blocks major status conditions and Yawn while Sun is active (also blocks Rest from working, since Rest needs to inflict Sleep on the user).'],
  harvest: ['Roughly doubles the odds of recycling a consumed Berry each turn while Sun is active (always some chance otherwise).'],
  forecast: ['Changes Castform\'s type to match the active weather: Fire in Sun, Water in Rain, Ice in Snow/Hail, Normal otherwise.'],
  protosynthesis: ['Boosts the highest stat (Speed on a tie) while Sun is active, or once from a Booster Energy even without Sun; the boost stays until the Pokémon switches out.'],
  quarkdrive: ['Boosts the highest stat (Speed on a tie) while Electric Terrain is active, or once from a Booster Energy even without the terrain; the boost stays until the Pokémon switches out.'],
  grasspelt: ['Boosts Defense ×1.5 while Grassy Terrain is active.'],
  transistor: ['Boosts Electric-type move power ×1.3 — independent of terrain, listed here because it\'s commonly confused with Surge Surfer/Quark Drive.'],
  levitate: ['Grounds nothing — makes the holder immune to Ground-type moves and, because it\'s ungrounded, exempt from every terrain\'s effects (boosts, healing, status immunity and Earthquake reduction alike) unless Gravity or a grounding effect is active.'],
  overcoat: ['Grants full immunity to Sand and Snow/Hail chip damage (and to powder moves, unrelated to weather).'],
  magicguard: ['Blocks all indirect damage, including Sand/Snow/Hail chip damage — but does not grant the stat boosts those weathers give Rock/Ice types.'],
  hydration: ['Cures the holder\'s status condition at the end of each turn Rain is active.'],
  flashfire: ['Not weather-related itself, but combines with Sun\'s Fire boost multiplicatively if the holder has already absorbed a Fire move this switch-in.'],
  airlock: ['Suppresses all weather-based effects on the field for as long as it\'s active (including opposing weather-setting abilities and moves).'],
  cloudnine: ['Identical to Air Lock: suppresses all weather-based effects while active.'],
};

/** Bounded set of item interaction notes for weather/terrain/field mechanics. */
export const ITEM_INTERACTIONS: Record<string, string[]> = {
  utilityumbrella: [
    'The holder is treated as if no Sun or Rain were active for damage/accuracy purposes (so no Fire/Water boost or Thunder/Hurricane accuracy change) and Powder-style Sun healing bonuses (Growth, Synthesis, Solar Beam) don\'t apply to it either — but it does NOT block Sand/Snow chip damage or terrain effects.',
  ],
  ironball: ['Grounds the holder (removes Flying-type\'s and Levitate\'s immunity to Ground moves and terrain effects) and halves Speed.'],
  airballoon: ['Makes the holder ungrounded — immune to Ground moves and exempt from every terrain\'s effects — until it\'s hit by an attack, which pops the balloon.'],
  heatrock: ['Extends Sun from 5 to 8 turns when set by a move (Drought/Desolate Land ignore this and are permanent until overwritten).'],
  damprock: ['Extends Rain from 5 to 8 turns when set by a move.'],
  smoothrock: ['Extends Sand from 5 to 8 turns when set by a move.'],
  icyrock: ['Extends Snow/Hail from 5 to 8 turns when set by a move.'],
  terrainextender: ['Extends the active terrain from 5 to 8 turns when set by a move.'],
  safetygoggles: ['Grants immunity to Sand and Snow/Hail chip damage (and to powder moves and Sandstorm/Hail-adjacent secondary effects, unrelated to weather itself).'],
  boosterenergy: ['One-time use: activates Protosynthesis/Quark Drive\'s stat boost immediately even without Sun or Electric Terrain present.'],
};
