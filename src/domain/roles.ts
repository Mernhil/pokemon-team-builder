/**
 * What a set does for its team besides hitting: support (Fake Out, redirection, Intimidate, Wide
 * Guard) and speed control (Tailwind, Trick Room, Icy Wind, Electroweb). Pure and small on purpose:
 * the bring planner and the archetype detector share it without sharing the damage engine.
 */
export type SupportKind = 'Fake Out' | 'Intimidate' | 'redirection' | 'Wide Guard';
export type ControlKind = 'Tailwind' | 'Trick Room' | 'Icy Wind' | 'Electroweb';

const SUPPORT_MOVES: Record<string, SupportKind> = { fakeout: 'Fake Out', followme: 'redirection', ragepowder: 'redirection', wideguard: 'Wide Guard' };
const CONTROL_MOVES: Record<string, ControlKind> = { tailwind: 'Tailwind', trickroom: 'Trick Room', icywind: 'Icy Wind', electroweb: 'Electroweb' };

/** Only the moves and the ability are read, so a half-known set (a logged Pokémon) works too. */
type Known = { moves: readonly string[]; abilityId?: string };

export function supportOf(set: Known): SupportKind[] {
  const out = new Set<SupportKind>();
  for (const m of set.moves) if (SUPPORT_MOVES[m]) out.add(SUPPORT_MOVES[m]);
  if (set.abilityId === 'intimidate') out.add('Intimidate');
  return [...out];
}

export function controlOf(set: Known): ControlKind[] {
  const out = new Set<ControlKind>();
  for (const m of set.moves) if (CONTROL_MOVES[m]) out.add(CONTROL_MOVES[m]);
  return [...out];
}
