/**
 * Move reach: what one move of a built Pokémon knocks out. The move is calculated with the Pokémon's own
 * set (item, nature, stat points) against the most-used set of each common Pokémon, with the Damage
 * Calc's engine, so it can never disagree with the calculator. Pure and React-free.
 */
import type { Dex } from '@/data/dex';
import { calcMoves } from './battle/damage';
import { defaultSide, type FieldConditions } from './battle/conditions';
import type { MetaSet } from './metaSets';
import { targetMegaMode } from './reverseSearch';
import { classifyKill, type Kill } from './threats';
import type { FormatRules, PokemonSet } from './types';

/** One Pokémon the move reaches, with the numbers behind it. */
export interface ReachRow {
  speciesId: string;
  usagePct?: number;
  usageRank?: number;
  /** The target's most-used item (what the numbers assume). */
  itemId?: string;
  kill: Kill;
  /** Damage as a % of the target's HP, lowest to highest roll. */
  percent: [number, number];
  /** The calculator's sentence ("guaranteed OHKO", "17.2% chance to 2HKO"…). */
  text: string;
}

export interface MoveReach {
  /** Pokémon the move is guaranteed to knock out in one hit. */
  ohko: ReachRow[];
  /** One hit only on a high roll. */
  possible: ReachRow[];
  /** Two hits (guaranteed or on most rolls, as the calculator reads it). */
  twoHit: ReachRow[];
  /** How many Pokémon were checked. */
  checked: number;
}

/** What this move, on this Pokémon, one-shots or two-shots among `targets` (most used first). */
export function moveReach(dex: Dex, format: FormatRules, mine: PokemonSet, moveId: string, targets: MetaSet[], field: FieldConditions): MoveReach {
  const out: MoveReach = { ohko: [], possible: [], twoHit: [], checked: 0 };
  const move = dex.move(moveId);
  if (!move || move.category === 'Status') return out;
  // Only this move, so the other three can't change the answer; a Mega Stone holder attacks as the Mega.
  const set: PokemonSet = { ...mine, moves: [moveId, '', '', ''] };
  const mega = !!dex.megaFor(mine.speciesId, mine.itemId) && format.capabilities.mega;
  const attacker = { set, cond: { ...defaultSide(mega), megaMode: mega ? ('mega' as const) : ('base' as const) } };
  for (const t of targets) {
    out.checked++;
    const megaMode = targetMegaMode(dex, format, t.set);
    const defender = { set: t.set, cond: { ...defaultSide(megaMode !== 'base'), megaMode } };
    const forms = calcMoves(dex, attacker, defender, field)[0]?.forms ?? [];
    if (forms.length === 0) continue;
    // More than one combination only when a side has formes in play: read the worst for the attacker.
    const f = forms.reduce((a, b) => (b.percent[1] < a.percent[1] ? b : a));
    const kill = classifyKill(f.koText, f.percent);
    const row: ReachRow = { speciesId: t.speciesId, usagePct: t.usagePct, usageRank: t.usageRank, itemId: t.set.itemId, kill, percent: f.percent, text: f.koText };
    if (kill === 'ohko') out.ohko.push(row);
    else if (kill === 'pohko') out.possible.push(row);
    else if (kill === '2hko') out.twoHit.push(row);
  }
  return out;
}
