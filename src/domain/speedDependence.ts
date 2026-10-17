/**
 * Does the team depend on its speed control? "Move first" is counted for every (my Pokémon, their
 * Pokémon) pair with the plan off and on: a Tailwind team that is outsped by most of the field
 * without Tailwind, or a Trick Room team that is outsped without the room, loses the speed war when
 * its setter is KO'd, flinched or Taunted. Pure and React-free; Speeds come from the speed ladder
 * (`buildLadder`), so the numbers agree with the Speed tab.
 */
import type { Dex } from '@/data/dex';
import { controlOf, type ControlKind } from './roles';
import { buildLadder, neutralScenario, type MetaVariant, type SpeedScenario, type TeamMember } from './speedTiers';
import type { PokemonSet } from './types';

/** The plan must gain at least this share of pairs, and end up ahead in at least `PLAN_WORKS`, to count as depended on. */
export const DEPENDENT_GAIN = 0.25;
export const PARTLY_GAIN = 0.15;
export const PLAN_WORKS = 0.5;
/** Without any control, moving first against less than this share of the field is worth a warning. */
export const OUTSPED_BELOW = 0.35;

export type SpeedPlan = 'Tailwind' | 'Trick Room';

export interface PlanDependence {
  plan: SpeedPlan;
  /** Team members that know the setting move. */
  setters: { slot: number; name: string }[];
  /** Share (0–1) of my-Pokémon × their-Pokémon pairs where I move first, plan off and plan on. */
  free: number;
  withPlan: number;
  verdict: 'dependent' | 'partly' | 'independent';
  /** One setter: if it goes down early, the plan is gone. */
  singleSetter: boolean;
  /** Another speed control (the other plan, Icy Wind, Electroweb) the team could fall back on. */
  backup: ControlKind[];
  lines: string[];
}

export interface SpeedDependence {
  plans: PlanDependence[];
  /** No control at all and mostly outsped (or built for a room it can't set). */
  noControl?: { free: number; line: string };
  /** Anything worth showing: a plan that matters, or a warning. */
  notable: boolean;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Their sets as speed variants (Game day: the six actually seen). */
export function variantsFromSets(dex: Dex, foes: { speciesId: string; set: PokemonSet }[]): MetaVariant[] {
  return foes.map((f, i) => ({
    key: `${f.speciesId}:${i}`,
    speciesId: f.speciesId,
    set: f.set,
    spreadPct: 0,
    scarf: false,
    hasMega: !!dex.megaFor(f.speciesId, f.set.itemId),
    label: '',
  }));
}

/** Share of (my Pokémon, their variant) pairs where mine moves first. Ties and Mega rows count against me. */
function firstShare(dex: Dex, variants: MetaVariant[], team: TeamMember[], scenario: SpeedScenario): number {
  const rows = buildLadder(dex, variants, team, scenario);
  const mine = new Map<number, number[]>();
  const theirs = new Map<string, number[]>();
  for (const r of rows) {
    if (r.mine && r.slot !== undefined) mine.set(r.slot, [...(mine.get(r.slot) ?? []), r.speed]);
    else if (r.variantKey) theirs.set(r.variantKey, [...(theirs.get(r.variantKey) ?? []), r.speed]);
  }
  let first = 0;
  let pairs = 0;
  for (const mySpeeds of mine.values()) {
    for (const theirSpeeds of theirs.values()) {
      pairs++;
      // The worse case for me: my slowest (fastest under Trick Room) against their quickest (slowest).
      const ok = scenario.trickRoom
        ? Math.max(...mySpeeds) < Math.min(...theirSpeeds)
        : Math.min(...mySpeeds) > Math.max(...theirSpeeds);
      if (ok) first++;
    }
  }
  return pairs ? first / pairs : 0;
}

export function speedDependence(dex: Dex, variants: MetaVariant[], team: TeamMember[], foeLabel = 'the common Pokémon'): SpeedDependence {
  if (!variants.length || !team.length) return { plans: [], notable: false };
  const base = neutralScenario();
  const scenarios: Record<SpeedPlan, SpeedScenario> = {
    Tailwind: { ...base, mine: { ...base.mine, tailwind: true } },
    'Trick Room': { ...base, trickRoom: true },
  };
  const free = firstShare(dex, variants, team, base);
  const controls = team.map((m) => ({ m, kinds: controlOf({ moves: m.set.moves, abilityId: m.set.abilityId }) }));
  const name = (slot: number) => dex.species(team.find((t) => t.slot === slot)?.set.speciesId ?? '')?.name ?? 'it';

  const plans: PlanDependence[] = [];
  for (const plan of ['Tailwind', 'Trick Room'] as const) {
    const setters = controls.filter((c) => c.kinds.includes(plan)).map((c) => ({ slot: c.m.slot, name: name(c.m.slot) }));
    if (!setters.length) continue;
    const withPlan = firstShare(dex, variants, team, scenarios[plan]);
    const gain = withPlan - free;
    const verdict = gain >= DEPENDENT_GAIN && withPlan >= PLAN_WORKS && free < PLAN_WORKS ? 'dependent' : gain >= PARTLY_GAIN ? 'partly' : 'independent';
    const backup = [...new Set(controls.flatMap((c) => c.kinds).filter((k) => k !== plan))] as ControlKind[];
    const singleSetter = setters.length === 1;
    const lines: string[] = [];
    if (verdict !== 'independent') {
      lines.push(
        `You move first against ${pct(free)} of ${foeLabel} on a normal turn and ${pct(withPlan)} with ${plan} up. ${verdict === 'dependent' ? `The team leans on ${plan}.` : `${plan} helps a good part of the team.`}`,
      );
      if (singleSetter) {
        lines.push(
          `Only ${setters[0].name} sets ${plan}: if it is KO'd, flinched or Taunted before it moves, you lose the speed war.${backup.length ? ` ${backup.join(' and ')} is some backup.` : ' Nothing else on the team controls speed.'}`,
        );
      } else {
        lines.push(`${setters.map((s) => s.name).join(' and ')} can set ${plan}, so losing one doesn't end the plan.`);
      }
    }
    plans.push({ plan, setters, free, withPlan, verdict, singleSetter, backup, lines });
  }

  let noControl: SpeedDependence['noControl'];
  if (!controls.some((c) => c.kinds.length) && free < OUTSPED_BELOW) {
    const tailwind = firstShare(dex, variants, team, scenarios.Tailwind);
    const room = firstShare(dex, variants, team, scenarios['Trick Room']);
    const hint = room - free >= DEPENDENT_GAIN && room >= PLAN_WORKS ? ` Under Trick Room it would be ${pct(room)}: the team looks built for a room it can't set.` : tailwind - free >= DEPENDENT_GAIN && tailwind >= PLAN_WORKS ? ` With Tailwind it would be ${pct(tailwind)}.` : '';
    noControl = { free, line: `You move first against only ${pct(free)} of ${foeLabel} and nothing on the team controls speed (no Tailwind, Trick Room, Icy Wind or Electroweb).${hint}` };
  }
  const notable = !!noControl || plans.some((p) => p.verdict !== 'independent');
  return { plans, noControl, notable };
}
