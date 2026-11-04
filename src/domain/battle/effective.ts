/**
 * "Advanced details": in-battle stats under field conditions, stat stages, status, items and
 * abilities, plus a per-move power breakdown.
 *
 * Numbers use the games' 4096-based modifier chaining (the same arithmetic as Pokémon Showdown's
 * damage calculator), so Speed matches the calculator exactly (see tests). Every applied
 * modifier is returned with a label so the UI can explain the result.
 */
import { toID } from '@/data/dex';
import type { Move, MoveType, Pokemon, StatTable, TypeName } from '../types';
import type { BoostStat, FieldConditions, SideConditions } from './conditions';

interface Mod {
  label: string;
  /** Multiplier as a plain number (1.5, 2, 0.5 …). */
  factor: number;
}

export interface StatLine {
  raw: number;
  stage: number;
  /** After stat stages. */
  staged: number;
  /** After stages and all modifiers. */
  final: number;
  mods: Mod[];
}

interface MovePower {
  moveId: string;
  name: string;
  type: MoveType;
  category: Move['category'];
  basePower: number;
  /** Base power after ability/item/field power modifiers. */
  effectivePower: number;
  /** Overall multiplier on damage vs a neutral target, excluding the attacking stat. */
  multiplier: number;
  mods: Mod[];
  /** Attacking stat used and its effective value. */
  stat: 'atk' | 'spa';
  statValue: number;
  /** Relative power index: effective power × multiplier × stat / 100. */
  index: number;
  note?: string;
}

export interface EffectiveResult {
  hp: number;
  stats: Record<BoostStat, StatLine>;
  /** Types in battle (Tera replaces them). */
  types: TypeName[];
  ability: string;
  item: string;
  /** Damage taken multipliers from screens / Friend Guard. */
  physicalTaken: Mod[];
  specialTaken: Mod[];
  /** HP × Def (resp. SpD) ÷ damage-taken multiplier — higher is bulkier. */
  physicalBulk: number;
  specialBulk: number;
  speedNote?: string;
  moves: MovePower[];
}

// ---------------------------------------------------------------------------
// Game arithmetic (mirrors @smogon/calc mechanics/util)
// ---------------------------------------------------------------------------

const pokeRound = (n: number) => (n % 1 > 0.5 ? Math.ceil(n) : Math.floor(n));
const toMod = (f: number) => Math.round(f * 4096);

function chainMods(mods: number[], lower = 410, upper = 131072): number {
  let M = 4096;
  for (const mod of mods) if (mod !== 4096) M = (M * mod + 2048) >> 12;
  return Math.max(Math.min(M, upper), lower);
}

export function stageStat(stat: number, stage: number): number {
  if (stage > 0) return Math.floor((stat * (2 + stage)) / 2);
  if (stage < 0) return Math.floor((stat * 2) / (2 - stage));
  return stat;
}

export const stageMultiplier = (stage: number) => (stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage));

function applyMods(value: number, mods: Mod[], upper = 131072): number {
  if (!mods.length) return value;
  return Math.max(1, pokeRound((value * chainMods(mods.map((m) => toMod(m.factor)), 410, upper)) / 4096));
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const TYPE_ITEMS: Record<string, TypeName> = {
  charcoal: 'Fire', mysticwater: 'Water', miracleseed: 'Grass', magnet: 'Electric', nevermeltice: 'Ice',
  blackbelt: 'Fighting', poisonbarb: 'Poison', softsand: 'Ground', sharpbeak: 'Flying', twistedspoon: 'Psychic',
  silverpowder: 'Bug', hardstone: 'Rock', spelltag: 'Ghost', dragonfang: 'Dragon', blackglasses: 'Dark',
  metalcoat: 'Steel', fairyfeather: 'Fairy', silkscarf: 'Normal',
};
const ATE: Record<string, TypeName> = {
  aerilate: 'Flying', pixilate: 'Fairy', refrigerate: 'Ice', galvanize: 'Electric', dragonize: 'Dragon',
};
const SLOW_ITEMS = new Set(['ironball', 'machobrace', 'powerweight', 'powerbracer', 'powerbelt', 'powerlens', 'powerband', 'poweranklet']);
const WEATHER_SPEED: Record<string, string> = { chlorophyll: 'Sun', swiftswim: 'Rain', sandrush: 'Sand', slushrush: 'Snow' };

export interface EffectiveInput {
  species: Pokemon;
  /** Pre-battle stats (from calcStats) for the forme in use. */
  stats: StatTable;
  ability: string;
  item: string;
  teraType?: TypeName | 'Stellar';
  moves: Move[];
  /** Show move power as critical hits (1.5×, negative attack stages ignored). */
  crit?: boolean;
  side: SideConditions;
  field: FieldConditions;
  /** Generation whose mechanics apply (default 9). Changes paralysis, crit, Snow/Sand boosts. */
  gen?: number;
}

/** Protosynthesis / Quark Drive boost the highest non-HP stat (ties → Atk > Def > SpA > SpD > Spe). */
function qpBoostedStat(stats: StatTable, boosts: Record<BoostStat, number>): BoostStat {
  let best: BoostStat = 'atk';
  for (const s of ['def', 'spa', 'spd', 'spe'] as BoostStat[]) {
    if (stageStat(stats[s], boosts[s]) > stageStat(stats[best], boosts[best])) best = s;
  }
  return best;
}

export function effectiveStats(input: EffectiveInput): EffectiveResult {
  const { species, stats, side, field } = input;
  const gen = input.gen ?? 9;
  const ab = toID(input.ability);
  const it = toID(input.item);
  const w = field.weather;
  const statused = !!side.status;
  const types: TypeName[] =
    side.tera && input.teraType && input.teraType !== 'Stellar' ? [input.teraType] : species.types;
  const grounded = !types.includes('Flying') && ab !== 'levitate' && it !== 'airballoon';
  const qpActive =
    (ab === 'protosynthesis' && (w === 'Sun' || side.abilityOn)) ||
    (ab === 'quarkdrive' && (field.terrain === 'Electric' || side.abilityOn));
  const qpStat = qpActive ? qpBoostedStat(stats, side.boosts) : undefined;

  const line = (s: BoostStat, mods: Mod[], upper?: number): StatLine => {
    const stage = side.boosts[s];
    const staged = stageStat(stats[s], stage);
    return { raw: stats[s], stage, staged, final: applyMods(staged, mods, upper), mods };
  };

  // ---- Attack ----
  const atk: Mod[] = [];
  if (ab === 'hugepower' || ab === 'purepower') atk.push({ label: input.ability, factor: 2 });
  if (ab === 'hustle') atk.push({ label: 'Hustle', factor: 1.5 });
  if (ab === 'guts' && statused) atk.push({ label: 'Guts', factor: 1.5 });
  if (ab === 'gorillatactics') atk.push({ label: 'Gorilla Tactics', factor: 1.5 });
  if (ab === 'slowstart' && side.abilityOn) atk.push({ label: 'Slow Start', factor: 0.5 });
  if (ab === 'defeatist' && side.hpPercent <= 50) atk.push({ label: 'Defeatist', factor: 0.5 });
  if (it === 'choiceband') atk.push({ label: 'Choice Band', factor: 1.5 });
  if (qpStat === 'atk') atk.push({ label: input.ability, factor: 1.3 });

  // ---- Defense ----
  const def: Mod[] = [];
  if (ab === 'furcoat') def.push({ label: 'Fur Coat', factor: 2 });
  if (ab === 'marvelscale' && statused) def.push({ label: 'Marvel Scale', factor: 1.5 });
  if (ab === 'grasspelt' && field.terrain === 'Grassy') def.push({ label: 'Grass Pelt', factor: 1.5 });
  if (it === 'eviolite') def.push({ label: 'Eviolite', factor: 1.5 });
  if (w === 'Snow' && gen >= 9 && types.includes('Ice')) def.push({ label: 'Snow (Ice type)', factor: 1.5 });
  if (qpStat === 'def') def.push({ label: input.ability, factor: 1.3 });

  // ---- Sp. Atk ----
  const spa: Mod[] = [];
  if (ab === 'solarpower' && w === 'Sun') spa.push({ label: 'Solar Power', factor: 1.5 });
  if (it === 'choicespecs') spa.push({ label: 'Choice Specs', factor: 1.5 });
  if (ab === 'defeatist' && side.hpPercent <= 50) spa.push({ label: 'Defeatist', factor: 0.5 });
  if (qpStat === 'spa') spa.push({ label: input.ability, factor: 1.3 });

  // ---- Sp. Def ----
  const spd: Mod[] = [];
  if (it === 'assaultvest') spd.push({ label: 'Assault Vest', factor: 1.5 });
  if (it === 'eviolite') spd.push({ label: 'Eviolite', factor: 1.5 });
  if (w === 'Sand' && gen >= 4 && types.includes('Rock')) spd.push({ label: 'Sand (Rock type)', factor: 1.5 });
  if (qpStat === 'spd') spd.push({ label: input.ability, factor: 1.3 });

  // ---- Speed (order and arithmetic match the damage calculator exactly) ----
  const spe: Mod[] = [];
  if (side.tailwind) spe.push({ label: 'Tailwind', factor: 2 });
  const unburden = ab === 'unburden' && side.abilityOn;
  if (unburden) spe.push({ label: 'Unburden', factor: 2 });
  else if (WEATHER_SPEED[ab] && WEATHER_SPEED[ab] === w) spe.push({ label: input.ability, factor: 2 });
  else if (ab === 'surgesurfer' && field.terrain === 'Electric') spe.push({ label: 'Surge Surfer', factor: 2 });
  else if (ab === 'quickfeet' && statused) spe.push({ label: 'Quick Feet', factor: 1.5 });
  else if (ab === 'slowstart' && side.abilityOn) spe.push({ label: 'Slow Start', factor: 0.5 });
  else if (qpStat === 'spe') spe.push({ label: input.ability, factor: 1.5 });
  if (!unburden) {
    if (it === 'choicescarf') spe.push({ label: 'Choice Scarf', factor: 1.5 });
    else if (SLOW_ITEMS.has(it)) spe.push({ label: input.item, factor: 0.5 });
  }
  const speLine = line('spe', spe, 131172);
  if (side.status === 'par' && ab !== 'quickfeet') {
    // Paralysis quartered Speed until Gen 7 halved it.
    const pct = gen >= 7 ? 50 : 25;
    speLine.final = Math.floor((speLine.final * pct) / 100);
    speLine.mods = [...spe, { label: 'Paralysis', factor: pct / 100 }];
  }

  const result: Record<BoostStat, StatLine> = {
    atk: line('atk', atk),
    def: line('def', def),
    spa: line('spa', spa),
    spd: line('spd', spd),
    spe: speLine,
  };

  // ---- Damage taken (screens, Friend Guard) ----
  const doubles = field.gameType === 'Doubles';
  const screen = doubles ? 2732 / 4096 : 0.5;
  const physicalTaken: Mod[] = [];
  const specialTaken: Mod[] = [];
  if (side.reflect || side.auroraVeil) physicalTaken.push({ label: side.reflect ? 'Reflect' : 'Aurora Veil', factor: screen });
  if (side.lightScreen || side.auroraVeil) specialTaken.push({ label: side.lightScreen ? 'Light Screen' : 'Aurora Veil', factor: screen });
  if (side.friendGuard) {
    physicalTaken.push({ label: 'Friend Guard', factor: 0.75 });
    specialTaken.push({ label: 'Friend Guard', factor: 0.75 });
  }
  if (ab === 'multiscale' || ab === 'shadowshield') {
    if (side.hpPercent >= 100) {
      physicalTaken.push({ label: input.ability, factor: 0.5 });
      specialTaken.push({ label: input.ability, factor: 0.5 });
    }
  }
  if (ab === 'auraguard') physicalTaken.push({ label: 'Aura Guard (contact)', factor: 0.5 });
  const prod = (mods: Mod[]) => mods.reduce((a, m) => a * m.factor, 1);
  const hp = stats.hp;
  const physicalBulk = Math.round((hp * result.def.final) / prod(physicalTaken));
  const specialBulk = Math.round((hp * result.spd.final) / prod(specialTaken));

  const speedNote = field.trickRoom
    ? 'Trick Room: slower Pokémon move first within the same priority bracket.'
    : undefined;

  // Crits ignore the attacker's negative stat stages.
  const critStat = (s: 'atk' | 'spa', mods: Mod[]) => (side.boosts[s] < 0 ? applyMods(stats[s], mods) : result[s].final);
  const moves = input.moves.map((m) =>
    movePower(m, {
      ab, it, abilityName: input.ability, itemName: input.item, types, grounded, side, field,
      atk: input.crit ? critStat('atk', atk) : result.atk.final,
      spa: input.crit ? critStat('spa', spa) : result.spa.final,
      originalTypes: species.types,
      crit: !!input.crit,
      gen,
    }),
  );

  return {
    hp,
    stats: result,
    types,
    ability: input.ability,
    item: input.item,
    physicalTaken,
    specialTaken,
    physicalBulk,
    specialBulk,
    speedNote,
    moves,
  };
}

// ---------------------------------------------------------------------------
// Move power breakdown
// ---------------------------------------------------------------------------

interface PowerCtx {
  ab: string;
  it: string;
  abilityName: string;
  itemName: string;
  types: TypeName[];
  originalTypes: TypeName[];
  grounded: boolean;
  side: SideConditions;
  field: FieldConditions;
  atk: number;
  spa: number;
  crit: boolean;
  gen: number;
}

function movePower(m: Move, c: PowerCtx): MovePower {
  const bpMods: Mod[] = [];
  const dmgMods: Mod[] = [];
  let bp = m.basePower;
  const physical = m.category === 'Physical';
  let note: string | undefined;

  if (m.category === 'Status') {
    return {
      moveId: m.id, name: m.name, type: m.type, category: m.category, basePower: 0, effectivePower: 0, multiplier: 0,
      mods: [], stat: 'atk', statValue: 0, index: 0, note: 'Status move',
    };
  }
  // Only status moves (Curse in Gen 2–4) are typeless.
  let type = m.type as TypeName;

  // -ate abilities: Normal moves change type and gain 1.2×
  if (ATE[c.ab] && type === 'Normal') {
    type = ATE[c.ab];
    bpMods.push({ label: `${c.abilityName} (→ ${type})`, factor: 1.2 });
  }
  if (c.ab === 'liquidvoice' && m.flags.sound) type = 'Water';

  // Ability BP modifiers
  if (c.ab === 'technician' && bp <= 60) bpMods.push({ label: 'Technician', factor: 1.5 });
  if (c.ab === 'sharpness' && m.flags.slicing) bpMods.push({ label: 'Sharpness', factor: 1.5 });
  if (c.ab === 'toughclaws' && m.contact) bpMods.push({ label: 'Tough Claws', factor: 1.3 });
  if (c.ab === 'ironfist' && m.flags.punch) bpMods.push({ label: 'Iron Fist', factor: 1.2 });
  if (c.ab === 'strongjaw' && m.flags.bite) bpMods.push({ label: 'Strong Jaw', factor: 1.5 });
  if (c.ab === 'megalauncher' && m.flags.pulse) bpMods.push({ label: 'Mega Launcher', factor: 1.5 });
  if (c.ab === 'reckless' && m.recoil) bpMods.push({ label: 'Reckless', factor: 1.2 });
  if (c.ab === 'sheerforce' && m.secondary) bpMods.push({ label: 'Sheer Force', factor: 1.3 });
  if (c.ab === 'punkrock' && m.flags.sound) bpMods.push({ label: 'Punk Rock', factor: 1.3 });
  if (c.ab === 'sandforce' && c.field.weather === 'Sand' && ['Rock', 'Ground', 'Steel'].includes(type))
    bpMods.push({ label: 'Sand Force', factor: 1.3 });
  if (c.ab === 'steelworker' && type === 'Steel') bpMods.push({ label: 'Steelworker', factor: 1.5 });
  if (c.ab === 'transistor' && type === 'Electric') bpMods.push({ label: 'Transistor', factor: 1.3 });
  if (c.ab === 'dragonsmaw' && type === 'Dragon') bpMods.push({ label: "Dragon's Maw", factor: 1.5 });
  if (c.ab === 'rockypayload' && type === 'Rock') bpMods.push({ label: 'Rocky Payload', factor: 1.5 });
  if (c.ab === 'waterbubble' && type === 'Water') bpMods.push({ label: 'Water Bubble', factor: 2 });
  if (c.ab === 'blaze' && type === 'Fire' && c.side.hpPercent <= 33) bpMods.push({ label: 'Blaze', factor: 1.5 });
  if (c.ab === 'torrent' && type === 'Water' && c.side.hpPercent <= 33) bpMods.push({ label: 'Torrent', factor: 1.5 });
  if (c.ab === 'overgrow' && type === 'Grass' && c.side.hpPercent <= 33) bpMods.push({ label: 'Overgrow', factor: 1.5 });
  if (c.ab === 'swarm' && type === 'Bug' && c.side.hpPercent <= 33) bpMods.push({ label: 'Swarm', factor: 1.5 });
  if (c.ab === 'flashfire' && type === 'Fire' && c.side.abilityOn) bpMods.push({ label: 'Flash Fire', factor: 1.5 });

  // Item BP modifiers
  if (TYPE_ITEMS[c.it] === type) bpMods.push({ label: c.itemName, factor: 1.2 });
  if (c.it === 'muscleband' && physical) bpMods.push({ label: 'Muscle Band', factor: 1.1 });
  if (c.it === 'wiseglasses' && !physical) bpMods.push({ label: 'Wise Glasses', factor: 1.1 });
  if (c.it === 'normalgem' && type === 'Normal') bpMods.push({ label: 'Normal Gem', factor: 1.3 });
  if (c.side.helpingHand) bpMods.push({ label: 'Helping Hand', factor: 1.5 });

  // Terrain (attacker grounded)
  if (c.grounded) {
    if (c.field.terrain === 'Electric' && type === 'Electric') bpMods.push({ label: 'Electric Terrain', factor: 1.3 });
    if (c.field.terrain === 'Grassy' && type === 'Grass') bpMods.push({ label: 'Grassy Terrain', factor: 1.3 });
    if (c.field.terrain === 'Psychic' && type === 'Psychic') bpMods.push({ label: 'Psychic Terrain', factor: 1.3 });
  }
  if (c.field.terrain === 'Grassy' && ['earthquake', 'bulldoze'].includes(m.id)) bpMods.push({ label: 'Grassy Terrain', factor: 0.5 });
  if (c.field.terrain === 'Misty' && type === 'Dragon') bpMods.push({ label: 'Misty Terrain (vs grounded)', factor: 0.5 });

  const bpFactor = chainMods(bpMods.map((x) => toMod(x.factor))) / 4096;
  const effectivePower = Math.max(1, pokeRound(bp * bpFactor));
  bp = effectivePower;

  // Final damage modifiers
  if (m.target === 'allAdjacentFoes' || m.target === 'allAdjacent') {
    if (c.field.gameType === 'Doubles') dmgMods.push({ label: 'Spread move', factor: 0.75 });
  }
  const w = c.field.weather;
  if (w === 'Sun' && type === 'Fire') dmgMods.push({ label: 'Sun', factor: 1.5 });
  if (w === 'Sun' && type === 'Water') dmgMods.push({ label: 'Sun', factor: 0.5 });
  if (w === 'Rain' && type === 'Water') dmgMods.push({ label: 'Rain', factor: 1.5 });
  if (w === 'Rain' && type === 'Fire') dmgMods.push({ label: 'Rain', factor: 0.5 });

  // STAB (Tera keeps original-type STAB; Tera into a shared type → 2×)
  const stabTypes = new Set<TypeName>([...c.types, ...(c.side.tera ? c.originalTypes : [])]);
  if (stabTypes.has(type)) {
    const teraBoosted = c.side.tera && c.types.includes(type) && c.originalTypes.includes(type);
    const adapt = c.ab === 'adaptability';
    const stab = teraBoosted ? (adapt ? 2.25 : 2) : adapt ? 2 : 1.5;
    dmgMods.push({ label: adapt ? 'STAB (Adaptability)' : teraBoosted ? 'STAB (Tera)' : 'STAB', factor: stab });
  }
  if (c.side.status === 'brn' && physical && c.ab !== 'guts' && m.id !== 'facade') dmgMods.push({ label: 'Burn', factor: 0.5 });
  if (c.crit) {
    // Critical hits did 2× before Gen 6 (Gen 1's level-based crit is approximated as 2×).
    const base = c.gen >= 6 ? 1.5 : 2;
    dmgMods.push(c.ab === 'sniper' ? { label: 'Critical hit (Sniper)', factor: base * 1.5 } : { label: 'Critical hit', factor: base });
  }
  if (c.it === 'lifeorb') dmgMods.push({ label: 'Life Orb', factor: 1.3 });
  if (c.it === 'expertbelt') note = 'Expert Belt: ×1.2 on super-effective hits';
  if (c.ab === 'tintedlens') note = 'Tinted Lens: not-very-effective hits deal ×2';
  if (m.multihit) note = `Hits ${Array.isArray(m.multihit) ? `${m.multihit[0]}–${m.multihit[1]}` : m.multihit} times; power shown per hit`;

  const multiplier = dmgMods.reduce((a, x) => a * x.factor, 1);
  const stat = physical ? 'atk' : 'spa';
  const statValue = physical ? c.atk : c.spa;
  return {
    moveId: m.id,
    name: m.name,
    type,
    category: m.category,
    basePower: m.basePower,
    effectivePower,
    multiplier,
    mods: [...bpMods, ...dmgMods],
    stat,
    statValue,
    index: Math.round((bp * multiplier * statValue) / 100),
    note,
  };
}

/** Apply a critical hit to a power breakdown (1.5×; ignores negative attack stages). */
export const CRIT: Mod = { label: 'Critical hit', factor: 1.5 };
