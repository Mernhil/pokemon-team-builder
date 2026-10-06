/**
 * Automatic archetype tags: which of the match log's archetypes (ARCHETYPE_PRESETS) a team plays, from
 * what is known about its Pokémon — a saved team's full sets, or a logged team's species with whatever
 * was seen. A Pokémon with nothing known falls back to its most-used meta set. Pure and React-free.
 *
 * It would rather say nothing than something wrong: each tag has a confidence from named signals
 * (weather setters and abusers, Trick Room and slow Pokémon, Tailwind, the speed and bulk profile) and
 * only tags at or above `ARCHETYPE_RULES.minConfidence` are returned; the rest come back as `weak`.
 * Every threshold lives in ARCHETYPE_RULES.
 */
import type { Dex } from '@/data/dex';
import { ARCHETYPE_PRESETS } from './matches';
import { controlOf, supportOf } from './roles';
import type { FormatRules } from './types';

export type ArchetypePreset = (typeof ARCHETYPE_PRESETS)[number];

/** A Pokémon as far as it is known: only the species is required. */
export interface ArchetypeMon {
  speciesId: string;
  abilityId?: string;
  itemId?: string;
  moves?: readonly string[];
  nature?: string;
}

/** The most-used set of a species, when nothing is known about the Pokémon. */
export type MetaLookup = (speciesId: string) => { abilityId?: string; itemId?: string; moves?: readonly string[]; nature?: string } | undefined;

export interface ArchetypeTag {
  tag: ArchetypePreset;
  /** 0–1. */
  confidence: number;
  /** Short, plain: "Pelipper sets rain; 2 Swift Swim users (Basculegion, Qwilfish)". */
  reasons: string[];
}

export interface Detection {
  /** At or above the minimum confidence, best first. */
  tags: ArchetypeTag[];
  /** Signals that did not add up to a tag (a weather setter with nobody to use it). */
  weak: ArchetypeTag[];
  /** Species whose set came from the meta, not from what was known. */
  fromMeta: string[];
}

/** Every threshold in one place. Speeds and bulk are base stats; bulk is HP × (Def + Sp. Def) / 2 (the Champions Pokémon's median is about 6,400). */
export const ARCHETYPE_RULES = {
  /** A tag below this is not returned (it goes to `weak`). */
  minConfidence: 0.5,
  /** At or below: a Trick Room Pokémon. */
  slowSpeed: 70,
  /** At or above: a fast Pokémon. */
  fastSpeed: 95,
  /** At or above / at or below: bulky / frail. */
  bulky: 8000,
  frail: 5500,
  /** At or above: bulky enough for Stall (Snorlax, Umbreon, Garganacl and the like). */
  wall: 9500,
  /** Moves that heal, for Stall. */
  recovery: ['recover', 'roost', 'softboiled', 'moonlight', 'morningsun', 'synthesis', 'slackoff', 'milkdrink', 'shoreup', 'wish', 'strengthsap', 'junglehealing', 'lifedew', 'healpulse', 'rest'],
  /** A Pokémon with this many damaging moves counts as an attacker. */
  attackerMoves: 3,
  /** Hyper Offense: fast Pokémon needed, attackers needed, bulky Pokémon allowed. */
  hyperOffense: { fast: 3, attackers: 4, maxBulky: 1 },
  /** Bulky Offense: bulky Pokémon needed, attackers needed, fast Pokémon allowed. */
  bulkyOffense: { bulky: 3, attackers: 4, maxFast: 2 },
  /** Stall: walls and healers needed, attackers allowed. */
  stall: { walls: 4, healers: 3, maxAttackers: 2 },
  /** Balance: Pokémon that must be known, distinct support or control roles, and a fast and a bulky Pokémon. */
  balance: { known: 4, roles: 2 },
  /** Confidence: a weather setter alone, per abuser; Trick Room setter alone, per slow Pokémon; a Tailwind setter. */
  weather: { setter: 0.4, perAbuser: 0.2 },
  trickRoom: { setter: 0.3, perSlow: 0.15 },
  tailwind: { setter: 0.55, perExtraSetter: 0.1, fastBonus: 0.1, fastNeeded: 3 },
} as const;

interface WeatherRule {
  label: string;
  setterAbilities: string[];
  setterMoves: string[];
  abuserAbilities: string[];
  abuserMoves: string[];
}
const WEATHER: Partial<Record<ArchetypePreset, WeatherRule>> = {
  Rain: { label: 'rain', setterAbilities: ['drizzle'], setterMoves: ['raindance'], abuserAbilities: ['swiftswim'], abuserMoves: [] },
  Sun: { label: 'sun', setterAbilities: ['drought'], setterMoves: ['sunnyday'], abuserAbilities: ['chlorophyll', 'solarpower', 'flowergift'], abuserMoves: ['solarbeam', 'solarblade'] },
  Sand: { label: 'sand', setterAbilities: ['sandstream'], setterMoves: ['sandstorm'], abuserAbilities: ['sandrush', 'sandforce'], abuserMoves: [] },
  'Hail/Snow': { label: 'snow', setterAbilities: ['snowwarning'], setterMoves: ['snowscape', 'chillyreception', 'hail'], abuserAbilities: ['slushrush', 'icebody'], abuserMoves: ['auroraveil', 'blizzard'] },
};

interface Resolved {
  name: string;
  abilityId?: string;
  moves: string[];
  speed: number;
  bulk: number;
  attacker: boolean;
  /** Anything beyond the species is known (ability or moves). */
  known: boolean;
}

const names = (list: string[]) => (list.length <= 3 ? list.join(', ') : `${list.slice(0, 3).join(', ')} and ${list.length - 3} more`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const round = (n: number) => Math.round(Math.min(1, n) * 100) / 100;

/** "Mega Charizard Y" for Charizard-Mega-Y. */
const megaName = (base: string, mega: string) => `Mega ${base}${/-Mega-([XYZ])$/.exec(mega)?.[1] ? ` ${/-Mega-([XYZ])$/.exec(mega)![1]}` : ''}`;

function resolve(mon: ArchetypeMon, dex: Dex, format: FormatRules, metaFor: MetaLookup | undefined, fromMeta: string[]): Resolved | undefined {
  const species = dex.species(mon.speciesId);
  if (!species) return undefined;
  let { abilityId, itemId, moves, nature } = mon;
  if (!abilityId && !moves?.length && metaFor) {
    const m = metaFor(species.id);
    if (m) {
      ({ abilityId, itemId, moves, nature } = m);
      fromMeta.push(species.id);
    }
  }
  const known = !!abilityId || !!moves?.length;
  // A Mega Stone holder is its Mega in play: its stats, and its ability replaces the Pokémon's.
  const mega = format.capabilities.mega && itemId ? dex.megaFor(species.id, itemId) : undefined;
  const form = mega ?? species;
  if (mega) abilityId = dex.ability(mega.abilities['0'])?.id ?? abilityId;
  const n = nature ? dex.nature(nature) : undefined;
  const speed = form.baseStats.spe + (n?.plus === 'spe' ? 10 : n?.minus === 'spe' ? -10 : 0);
  const list = [...(moves ?? [])].filter(Boolean);
  const damaging = list.filter((m) => dex.move(m) && dex.move(m)!.category !== 'Status').length;
  return {
    name: mega ? megaName(species.name, mega.name) : species.name,
    abilityId,
    moves: list,
    speed,
    bulk: (form.baseStats.hp * (form.baseStats.def + form.baseStats.spd)) / 2,
    attacker: damaging >= ARCHETYPE_RULES.attackerMoves,
    known,
  };
}

/**
 * The archetypes a team plays. `mons` is a saved team's Pokémon or a list of species with whatever is
 * known; `metaFor` fills in a Pokémon that is only a species (the most-used set of the regulation).
 */
export function detectArchetypes(mons: readonly ArchetypeMon[], dex: Dex, format: FormatRules, metaFor?: MetaLookup): Detection {
  const R = ARCHETYPE_RULES;
  const fromMeta: string[] = [];
  const team = mons.map((m) => resolve(m, dex, format, metaFor, fromMeta)).filter((m): m is Resolved => !!m);
  const found: ArchetypeTag[] = [];
  const add = (tag: ArchetypePreset, confidence: number, reasons: string[]) => found.push({ tag, confidence: round(confidence), reasons });
  if (team.length === 0) return { tags: [], weak: [], fromMeta };

  const fast = team.filter((m) => m.speed >= R.fastSpeed);
  const slow = team.filter((m) => m.speed <= R.slowSpeed);
  const bulky = team.filter((m) => m.bulk >= R.bulky);
  const frail = team.filter((m) => m.bulk <= R.frail);
  const attackers = team.filter((m) => m.attacker);
  const controls = team.flatMap((m) => controlOf(m).map((c) => ({ mon: m.name, kind: c })));
  const hasControl = (kind: string) => controls.filter((c) => c.kind === kind);

  // Weather: a setter, and Pokémon that use it.
  for (const [tag, w] of Object.entries(WEATHER) as [ArchetypePreset, WeatherRule][]) {
    const setters = team.filter((m) => (m.abilityId && w.setterAbilities.includes(m.abilityId)) || m.moves.some((mv) => w.setterMoves.includes(mv)));
    if (!setters.length) continue;
    const abusers = team.filter((m) => !setters.includes(m) && ((m.abilityId && w.abuserAbilities.includes(m.abilityId)) || m.moves.some((mv) => w.abuserMoves.includes(mv))));
    add(tag, R.weather.setter + R.weather.perAbuser * Math.min(abusers.length, 3), [
      `${names(setters.map((m) => m.name))} ${setters.length === 1 ? 'sets' : 'set'} ${w.label}`,
      abusers.length ? `${plural(abusers.length, `${w.label} user`)} (${names(abusers.map((m) => m.name))})` : `nothing that uses ${w.label}`,
    ]);
  }

  // Trick Room: a setter, and slow Pokémon to use it.
  const trSetters = hasControl('Trick Room');
  if (trSetters.length) {
    add('Trick Room', R.trickRoom.setter + R.trickRoom.perSlow * Math.min(slow.length, 4), [
      `${names([...new Set(trSetters.map((c) => c.mon))])} sets Trick Room`,
      slow.length ? `${plural(slow.length, 'slow Pokémon', 'slow Pokémon')} (${names(slow.map((m) => m.name))})` : 'no slow Pokémon to use it',
    ]);
  }

  // Tailwind: one setter is already the plan; more setters and a fast team add to it.
  const twSetters = [...new Set(hasControl('Tailwind').map((c) => c.mon))];
  if (twSetters.length) {
    add(
      'Tailwind',
      R.tailwind.setter + R.tailwind.perExtraSetter * Math.min(twSetters.length - 1, 2) + (fast.length >= R.tailwind.fastNeeded ? R.tailwind.fastBonus : 0),
      [`${names(twSetters)} ${twSetters.length === 1 ? 'sets' : 'set'} Tailwind`, ...(fast.length >= R.tailwind.fastNeeded ? [`${fast.length} fast Pokémon`] : [])],
    );
  }

  // The overall profile. Weather, Trick Room and Tailwind are plans of their own; these say how the rest plays.
  const slowRoom = trSetters.length > 0 && slow.length >= 2;
  const walls = team.filter((m) => m.bulk >= R.wall);
  const healers = team.filter((m) => m.moves.some((mv) => (R.recovery as readonly string[]).includes(mv)));
  const stalling = walls.length >= R.stall.walls && healers.length >= R.stall.healers && attackers.length <= R.stall.maxAttackers;
  if (stalling) {
    add('Stall', 0.7 + 0.05 * (walls.length - R.stall.walls), [`${plural(walls.length, 'very bulky Pokémon', 'very bulky Pokémon')}, ${plural(healers.length, 'healer')} (${names(healers.map((m) => m.name))})`]);
  } else if (!slowRoom && fast.length >= R.hyperOffense.fast && attackers.length >= R.hyperOffense.attackers && bulky.length <= R.hyperOffense.maxBulky) {
    add('Hyper Offense', 0.5 + 0.1 * (fast.length - R.hyperOffense.fast) + 0.05 * frail.length, [`${plural(fast.length, 'fast Pokémon', 'fast Pokémon')}, ${plural(attackers.length, 'attacker')}, ${plural(bulky.length, 'bulky Pokémon', 'bulky Pokémon')}`]);
  } else if (bulky.length >= R.bulkyOffense.bulky && attackers.length >= R.bulkyOffense.attackers && fast.length <= R.bulkyOffense.maxFast) {
    add('Bulky Offense', 0.5 + 0.1 * (bulky.length - R.bulkyOffense.bulky) + (controls.length ? 0.1 : 0), [`${plural(bulky.length, 'bulky Pokémon', 'bulky Pokémon')} and ${plural(attackers.length, 'attacker')}${controls.length ? ', with speed control' : ''}`]);
  } else {
    // Balance: a mix of roles, and only when the sets are known well enough to say so.
    const roles = new Set([...team.flatMap((m) => supportOf(m)), ...controls.map((c) => c.kind)]);
    if (team.filter((m) => m.known).length >= R.balance.known && roles.size >= R.balance.roles && fast.length >= 1 && bulky.length >= 1) {
      add('Balance', 0.55 + 0.05 * Math.min(roles.size - R.balance.roles, 3), [`${[...roles].join(', ')}; ${plural(fast.length, 'fast Pokémon', 'fast Pokémon')} and ${plural(bulky.length, 'bulky Pokémon', 'bulky Pokémon')}`]);
    }
  }

  found.sort((a, b) => b.confidence - a.confidence || ARCHETYPE_PRESETS.indexOf(a.tag) - ARCHETYPE_PRESETS.indexOf(b.tag));
  return { tags: found.filter((t) => t.confidence >= R.minConfidence), weak: found.filter((t) => t.confidence < R.minConfidence), fromMeta };
}

/** The best tag's name, or undefined: what a form would suggest. */
export const bestArchetype = (d: Detection): ArchetypePreset | undefined => d.tags[0]?.tag;
