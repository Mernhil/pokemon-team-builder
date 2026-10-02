import type { StatId } from '../types';

export type BoostStat = Exclude<StatId, 'hp'>;
export type Boosts = Record<BoostStat, number>;

export type Weather = '' | 'Sun' | 'Rain' | 'Sand' | 'Snow';
export type Terrain = '' | 'Electric' | 'Grassy' | 'Psychic' | 'Misty';
export type Status = '' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
export type GameType = 'Doubles' | 'Singles';
/** Which forme(s) to use in battle when a Mega Stone is held. */
export type MegaMode = 'base' | 'mega' | 'both';

export const WEATHERS: { id: Weather; label: string }[] = [
  { id: '', label: 'None' },
  { id: 'Sun', label: 'Sun' },
  { id: 'Rain', label: 'Rain' },
  { id: 'Sand', label: 'Sand' },
  { id: 'Snow', label: 'Snow' },
];
export const TERRAINS: { id: Terrain; label: string }[] = [
  { id: '', label: 'None' },
  { id: 'Electric', label: 'Electric' },
  { id: 'Grassy', label: 'Grassy' },
  { id: 'Psychic', label: 'Psychic' },
  { id: 'Misty', label: 'Misty' },
];
export const STATUSES: { id: Status; label: string }[] = [
  { id: '', label: 'Healthy' },
  { id: 'brn', label: 'Burned' },
  { id: 'par', label: 'Paralyzed' },
  { id: 'psn', label: 'Poisoned' },
  { id: 'tox', label: 'Badly poisoned' },
  { id: 'slp', label: 'Asleep' },
  { id: 'frz', label: 'Frozen' },
];

/** Conditions that belong to one Pokémon and its side of the field. */
export interface SideConditions {
  boosts: Boosts;
  status: Status;
  /** Current HP as % of max (1–100). */
  hpPercent: number;
  /** Which forme(s) to use (when holding a Mega Stone); ignored otherwise. */
  megaMode: MegaMode;
  /** Terastallized (uses set.teraType). */
  tera: boolean;
  /** Ability condition is met: Unburden (item used), Protosynthesis/Quark Drive (booster), Flash Fire, Slow Start… */
  abilityOn: boolean;
  tailwind: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  helpingHand: boolean;
  friendGuard: boolean;
}

/** Conditions shared by both sides. */
export interface FieldConditions {
  gameType: GameType;
  weather: Weather;
  terrain: Terrain;
  trickRoom: boolean;
  gravity: boolean;
}

export const emptyBoosts = (): Boosts => ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

export const defaultSide = (hasMega = false): SideConditions => ({
  boosts: emptyBoosts(),
  status: '',
  hpPercent: 100,
  megaMode: hasMega ? 'both' : 'base',
  tera: false,
  abilityOn: false,
  tailwind: false,
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
  friendGuard: false,
});

export const defaultField = (): FieldConditions => ({
  gameType: 'Doubles',
  weather: '',
  terrain: '',
  trickRoom: false,
  gravity: false,
});

/** Quick presets for the common "what if" questions. */
export const BOOST_PRESETS: { label: string; boosts: Partial<Boosts> }[] = [
  { label: 'Intimidated (−1 Atk)', boosts: { atk: -1 } },
  { label: '−2 Atk', boosts: { atk: -2 } },
  { label: '+2 Def (Iron Defense)', boosts: { def: 2 } },
  { label: '+1 Atk / +1 Spe (Dragon Dance)', boosts: { atk: 1, spe: 1 } },
  { label: '+2 Atk (Swords Dance)', boosts: { atk: 2 } },
  { label: '+2 SpA (Nasty Plot)', boosts: { spa: 2 } },
  { label: '+1 Def / +1 SpD (Cosmic Power)', boosts: { def: 1, spd: 1 } },
  { label: '−1 Spe (Icy Wind)', boosts: { spe: -1 } },
];
