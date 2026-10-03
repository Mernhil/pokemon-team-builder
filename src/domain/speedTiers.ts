/**
 * Speed tiers: where a team's Pokémon sit against the Pokémon people actually use (Champions).
 *
 * Pure and React-free. Every Speed on the ladder comes from `calcSpeed` (the Damage Calc's own
 * speed, @smogon/calc's getFinalSpeed), so this chart can never disagree with the calculator.
 * The meta side is built from a MetaSnapshot: each species' most common spreads (spreads with the
 * same final Speed merge), its most common ability and item, plus Choice Scarf and Mega variants.
 */
import type { Dex } from '@/data/dex';
import { calcSpeed } from './battle/damage';
import { defaultField, defaultSide, type FieldConditions, type SideConditions, type Terrain, type Weather } from './battle/conditions';
import { metaAgeDays, metaDataDate, type MetaEntry, type MetaSnapshot } from './meta';
import { byUsage } from './usage.ts';
import { createSet } from './team';
import type { FormatRules, Nature, PokemonSet, StatTable } from './types';

/** How many of the most-used species the ladder covers by default. */
export const DEFAULT_TOP_N = 30;
/** A species gets its own Choice Scarf row when at least this % of its sets hold one. */
export const SCARF_MIN_PCT = 10;
/** Most distinct Speeds shown per species, and the smallest spread share (%) worth a row of its own. */
export const MAX_SPEEDS_PER_SPECIES = 2;
export const MIN_SPREAD_PCT = 10;

export const SCARF_ID = 'choicescarf';

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export type SpeedStage = -1 | 0 | 1 | 2;

/** Speed modifiers that belong to one side. */
export interface SideSpeedScenario {
  tailwind: boolean;
  /** Speed stage: −1 (Icy Wind / Electroweb), +1, +2. */
  stage: SpeedStage;
  paralyzed: boolean;
}

export interface SpeedScenario {
  mine: SideSpeedScenario & {
    /** My team's Pokémon all hold a Choice Scarf (replaces their item). */
    scarf: boolean;
  };
  theirs: SideSpeedScenario;
  /** Weather and terrain are field-wide: Swift Swim, Chlorophyll, Sand Rush, Slush Rush, Surge Surfer, Protosynthesis, Quark Drive. */
  weather: Weather;
  terrain: Terrain;
  /** Flips the order: the slowest moves first. */
  trickRoom: boolean;
}

export const neutralSide = (): SideSpeedScenario => ({ tailwind: false, stage: 0, paralyzed: false });
export const neutralScenario = (): SpeedScenario => ({
  mine: { ...neutralSide(), scarf: false },
  theirs: neutralSide(),
  weather: '',
  terrain: '',
  trickRoom: false,
});

function fieldFor(s: SpeedScenario): FieldConditions {
  return { ...defaultField(), weather: s.weather, terrain: s.terrain, trickRoom: s.trickRoom };
}

function condFor(side: SideSpeedScenario, set: PokemonSet, hasMega: boolean): SideConditions {
  return {
    ...defaultSide(hasMega),
    megaMode: hasMega ? 'both' : 'base',
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: side.stage },
    status: side.paralyzed ? 'par' : '',
    tailwind: side.tailwind,
    // Booster Energy means Protosynthesis / Quark Drive are active.
    abilityOn: set.itemId === 'boosterenergy',
  };
}

// ---------------------------------------------------------------------------
// Meta sets
// ---------------------------------------------------------------------------

/** A species' likely set, before any scenario is applied. */
export interface MetaVariant {
  key: string;
  speciesId: string;
  set: PokemonSet;
  /** The species' usage: a %, or (in-game data) a rank. */
  usagePct?: number;
  usageRank?: number;
  /** % of this species' sets with this Speed (merged spreads), 0 when unknown. */
  spreadPct: number;
  /** Choice Scarf variant of a species whose main set doesn't hold one. */
  scarf: boolean;
  /** The held item is a Mega Stone for this species, so it is also shown as its Mega forme. */
  hasMega: boolean;
  /** "32 Spe Jolly". */
  label: string;
}

export const spLabel = (sp: number, nature: string) => `${sp} Spe ${nature}`;

const NEUTRAL_FIELD = defaultField();

function neutralSpeed(dex: Dex, set: PokemonSet, hasMega: boolean): number {
  const cond = condFor(neutralSide(), set, hasMega);
  // calcSpeed returns one entry per forme in play: base first.
  return calcSpeed(dex, { set, cond: { ...cond, megaMode: 'base' } }, NEUTRAL_FIELD)[0].speed;
}

function toStatTable(values: readonly number[]): StatTable {
  return { hp: values[0], atk: values[1], def: values[2], spa: values[3], spd: values[4], spe: values[5] };
}

/** The most common (ability, item, spread) sets of one meta entry as speed variants. */
export function variantsFor(entry: MetaEntry, dex: Dex, format: FormatRules): MetaVariant[] {
  const species = dex.species(entry.speciesId);
  if (!species || entry.spreads.length === 0) return [];
  const topAbility = entry.abilities.find((a) => dex.ability(a.id))?.id;
  const topItem = entry.items[0]?.id;
  const scarfPct = entry.items.find((i) => i.id === SCARF_ID)?.pct ?? 0;

  const build = (spread: MetaEntry['spreads'][number], itemId: string | undefined): PokemonSet => ({
    ...createSet(dex, entry.speciesId, format),
    abilityId: topAbility ?? dex.ability(species.abilities['0'])?.id,
    itemId,
    nature: spread.nature,
    sp: toStatTable(spread.values),
  });

  // Spreads with the same final Speed merge: their shares add up, the most common one names the row.
  const bySpeed = new Map<number, { spread: MetaEntry['spreads'][number]; pct: number }>();
  for (const spread of entry.spreads) {
    const speed = neutralSpeed(dex, build(spread, topItem), false);
    const cur = bySpeed.get(speed);
    if (!cur) bySpeed.set(speed, { spread, pct: spread.pct });
    else cur.pct += spread.pct;
  }
  const groups = [...bySpeed.entries()].sort((a, b) => b[1].pct - a[1].pct || b[0] - a[0]);
  const kept = groups.filter(([, g], i) => i === 0 || (i < MAX_SPEEDS_PER_SPECIES && g.pct >= MIN_SPREAD_PCT));

  const out: MetaVariant[] = [];
  for (const [, g] of kept) {
    const set = build(g.spread, topItem);
    const label = spLabel(g.spread.values[5], g.spread.nature);
    out.push({
      key: `${entry.speciesId}:${label}`,
      speciesId: entry.speciesId,
      set,
      usagePct: entry.usagePct,
      usageRank: entry.usageRank,
      spreadPct: Math.round(g.pct * 10) / 10,
      scarf: false,
      hasMega: !!dex.megaFor(entry.speciesId, topItem),
      label,
    });
  }
  // Choice Scarf is its own row when enough of the species run it (and the main set doesn't already).
  if (scarfPct >= SCARF_MIN_PCT && topItem !== SCARF_ID) {
    const [, g] = kept[0];
    out.push({
      key: `${entry.speciesId}:scarf`,
      speciesId: entry.speciesId,
      set: build(g.spread, SCARF_ID),
      usagePct: entry.usagePct,
      usageRank: entry.usageRank,
      spreadPct: scarfPct,
      scarf: true,
      hasMega: false,
      label: `Scarf · ${spLabel(g.spread.values[5], g.spread.nature)}`,
    });
  }
  return out;
}

/** Variants of the `topN` most used species that have spread data. */
export function metaVariants(snapshot: MetaSnapshot, dex: Dex, format: FormatRules, topN = DEFAULT_TOP_N): MetaVariant[] {
  const out: MetaVariant[] = [];
  let species = 0;
  for (const entry of snapshot.entries) {
    if (species >= topN) break;
    const v = variantsFor(entry, dex, format);
    if (v.length === 0) continue;
    species++;
    out.push(...v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

export interface SpeedRow {
  key: string;
  speciesId: string;
  /** Species or Mega forme id the Speed is for. */
  formeId: string;
  name: string;
  forme: 'base' | 'mega';
  speed: number;
  mine: boolean;
  /** Team slot (mine only). */
  slot?: number;
  usagePct?: number;
  usageRank?: number;
  spreadPct?: number;
  label: string;
  scarf: boolean;
  /** Another row has exactly this Speed and at least one of the two is mine. */
  tie: boolean;
  /** The meta variant (meta rows) for "Outspeed this". */
  variantKey?: string;
}

function rowsFor(
  dex: Dex,
  set: PokemonSet,
  side: SideSpeedScenario,
  scenario: SpeedScenario,
  base: Omit<SpeedRow, 'speed' | 'forme' | 'formeId' | 'name' | 'key'> & { key: string },
): SpeedRow[] {
  const hasMega = !!dex.megaFor(set.speciesId, set.itemId);
  const results = calcSpeed(dex, { set, cond: condFor(side, set, hasMega) }, fieldFor(scenario));
  return results.map((r) => {
    const forme = r.form === 'mega' ? dex.megaFor(set.speciesId, set.itemId) : undefined;
    return {
      ...base,
      key: `${base.key}:${r.form}`,
      formeId: forme?.id ?? set.speciesId,
      name: forme?.name ?? dex.species(set.speciesId)?.name ?? set.speciesId,
      forme: r.form,
      speed: r.speed,
    };
  });
}

/** A team member as ladder input. */
export interface TeamMember {
  slot: number;
  set: PokemonSet;
}

/**
 * The full ladder, fastest first (slowest first under Trick Room). My side's modifiers apply to my
 * team, theirs to the meta rows; weather, terrain and Trick Room are shared.
 */
export function buildLadder(dex: Dex, variants: MetaVariant[], team: TeamMember[], scenario: SpeedScenario): SpeedRow[] {
  const rows: SpeedRow[] = [];
  for (const v of variants) {
    rows.push(
      ...rowsFor(dex, v.set, scenario.theirs, scenario, {
        key: v.key,
        speciesId: v.speciesId,
        mine: false,
        usagePct: v.usagePct,
        usageRank: v.usageRank,
        spreadPct: v.spreadPct,
        label: v.label,
        scarf: v.scarf,
        tie: false,
        variantKey: v.key,
      }),
    );
  }
  for (const m of team) {
    const set = scenario.mine.scarf ? { ...m.set, itemId: SCARF_ID } : m.set;
    rows.push(
      ...rowsFor(dex, set, scenario.mine, scenario, {
        key: `mine:${m.slot}`,
        speciesId: m.set.speciesId,
        mine: true,
        slot: m.slot,
        label: spLabel(m.set.sp.spe, m.set.nature),
        scarf: set.itemId === SCARF_ID,
        tie: false,
      }),
    );
  }
  // Ties: same final Speed, with one of my own involved.
  const bySpeed = new Map<number, SpeedRow[]>();
  for (const r of rows) bySpeed.set(r.speed, [...(bySpeed.get(r.speed) ?? []), r]);
  for (const group of bySpeed.values()) if (group.length > 1 && group.some((r) => r.mine)) for (const r of group) r.tie = true;

  const dir = scenario.trickRoom ? 1 : -1;
  return rows.sort((a, b) => dir * (a.speed - b.speed) || Number(b.mine) - Number(a.mine) || byUsage(a, b) || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Which regulation's numbers
// ---------------------------------------------------------------------------

export interface PickedSnapshot {
  snapshot: MetaSnapshot;
  regulationId: string;
  /** The wanted regulation has no usage data: this is the newest one that does. */
  fellBackFrom?: string;
}

/** The snapshot for `wanted`, else the first of `newestFirst` that has one. */
export function pickSpeedSnapshot(
  wanted: string | undefined,
  newestFirst: string[],
  lookup: (regulationId: string) => MetaSnapshot | undefined,
): PickedSnapshot | undefined {
  const own = wanted ? lookup(wanted) : undefined;
  if (own && wanted) return { snapshot: own, regulationId: wanted };
  for (const id of newestFirst) {
    const s = lookup(id);
    if (s && id !== wanted) return { snapshot: s, regulationId: id, fellBackFrom: wanted };
  }
  return undefined;
}

/** "August 2026 · 1,269,250 battles · 31 days old": where the ladder's numbers come from. */
export function snapshotAge(snapshot: MetaSnapshot, now = Date.now()) {
  return { dataDate: metaDataDate(snapshot), days: metaAgeDays(snapshot, now) };
}

// ---------------------------------------------------------------------------
// "Outspeed this"
// ---------------------------------------------------------------------------

export interface OutspeedPlan {
  /** Already faster (or, under Trick Room, already slower): nothing to change. */
  status: 'already' | 'reachable' | 'unreachable';
  nature: string;
  sp: number;
  /** The Speed that investment gives, in the scenario. */
  speed: number;
  natureChanged: boolean;
  /** SP in other stats this set already spends (so the Speed investment must fit in the rest). */
  budgetLeft: number;
  /** The plan doesn't fit in the Stat Points still unspent (the caller can free some). */
  overBudget: boolean;
}

const speedNatures = (dex: Dex, plusSpe: boolean): Nature[] =>
  dex.natures.filter((n) => (plusSpe ? n.plus === 'spe' && n.minus !== 'spe' : n.minus === 'spe' && n.plus !== 'spe'));

/**
 * The least Speed investment that beats `target` for one of my Pokémon in the given scenario
 * (strictly faster; under Trick Room, strictly slower, with the least investment). Tries the set's
 * own nature first, then a Speed-raising (or, in Trick Room, -lowering) nature. Champions only.
 */
export function planOutspeed(
  dex: Dex,
  format: FormatRules,
  set: PokemonSet,
  forme: 'base' | 'mega',
  target: number,
  scenario: SpeedScenario,
): OutspeedPlan {
  const sys = format.statSystem;
  const cap = sys.kind === 'champions-sp' ? sys.perStatCap : 32;
  const total = sys.kind === 'champions-sp' ? sys.totalCap : 66;
  const hasMega = !!dex.megaFor(set.speciesId, set.itemId);
  const scarfSet = scenario.mine.scarf ? { ...set, itemId: SCARF_ID } : set;
  const speedAt = (sp: number, nature: string) => {
    const s: PokemonSet = { ...scarfSet, nature, sp: { ...scarfSet.sp, spe: sp } };
    const cond = { ...condFor(scenario.mine, s, hasMega), megaMode: (hasMega && forme === 'mega' ? 'mega' : 'base') as SideConditions['megaMode'] };
    return calcSpeed(dex, { set: s, cond }, fieldFor(scenario))[0].speed;
  };
  const others = Object.entries(set.sp).reduce((a, [k, v]) => a + (k === 'spe' ? 0 : (v as number)), 0);
  const budgetLeft = Math.max(0, total - others);
  const trick = scenario.trickRoom;
  const ok = (speed: number) => (trick ? speed < target : speed > target);
  const plan = (status: OutspeedPlan['status'], sp: number, nature: string): OutspeedPlan => ({
    status,
    sp,
    nature,
    speed: speedAt(sp, nature),
    natureChanged: nature !== set.nature,
    budgetLeft,
    overBudget: sp > budgetLeft,
  });

  if (ok(speedAt(set.sp.spe, set.nature))) return plan('already', set.sp.spe, set.nature);

  const natures = [set.nature, ...speedNatures(dex, !trick).map((n) => n.name).filter((n) => n !== set.nature)];
  // Normal order: smallest investment that wins. Trick Room: the slowest set-up is the one to compare, so walk down.
  for (const nature of natures) {
    if (trick) {
      if (ok(speedAt(0, nature))) {
        let sp = 0;
        // Keep as much Speed investment as still stays under (it only matters for ties with others).
        while (sp + 1 <= cap && ok(speedAt(sp + 1, nature))) sp++;
        return plan('reachable', Math.min(sp, set.sp.spe), nature);
      }
    } else {
      for (let sp = 0; sp <= cap; sp++) if (ok(speedAt(sp, nature))) return plan('reachable', sp, nature);
    }
  }
  return plan('unreachable', trick ? 0 : cap, natures[natures.length - 1]);
}

/** Human summary of a plan: "+12 SP (Jolly) outspeeds it", for the UI. */
export function describePlan(plan: OutspeedPlan, current: PokemonSet, trickRoom: boolean): string {
  const verb = trickRoom ? 'moves before it' : 'outspeeds it';
  if (plan.status === 'already') return `Already ${trickRoom ? 'slower' : 'faster'}: ${current.sp.spe} Spe ${current.nature} ${verb}.`;
  if (plan.status === 'unreachable') return `Can't ${trickRoom ? 'get under it' : 'outspeed it'}, even with ${plan.sp} Spe ${plan.nature} (${plan.speed}).`;
  const nature = plan.natureChanged ? ` and ${plan.nature}` : '';
  return `${plan.sp} Spe${nature} → ${plan.speed}, ${verb}.`;
}
