import type { Dex } from '@/data/dex';
import { sumStats } from './stats';
import { STAT_IDS, STAT_LABELS, type FormatRules, type Team } from './types';

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: Severity;
  code: string;
  message: string;
  /** Slot index (0–5) the issue belongs to; undefined = team-level. */
  slot?: number;
}

/**
 * Pure, synchronous validator. Runs on every edit, so it must stay cheap.
 * Errors = the team cannot be registered; warnings = legal but probably unintended.
 */
export function validateTeam(team: Team, format: FormatRules, dex: Dex): Issue[] {
  const issues: Issue[] = [];
  const reg = format.regulationId;
  const filled = team.slots.map((s, i) => [s, i] as const).filter(([s]) => s);

  if (filled.length < format.teamSize) {
    issues.push({
      severity: filled.length === 0 ? 'info' : 'warning',
      code: 'team-size',
      message: `${filled.length}/${format.teamSize} Pokémon — ${format.name} requires ${format.teamSize}.`,
    });
  }

  // ---- Clauses -------------------------------------------------------------------------
  if (format.clauses.species) {
    const seen = new Map<number, number>();
    for (const [s, i] of filled) {
      const sp = dex.species(s!.speciesId);
      if (!sp) continue;
      if (seen.has(sp.num)) {
        issues.push({
          severity: 'error',
          code: 'species-clause',
          slot: i,
          message: `Species Clause: ${sp.name} duplicates slot ${seen.get(sp.num)! + 1} (Dex #${sp.num}).`,
        });
      } else seen.set(sp.num, i);
    }
  }
  if (format.clauses.item) {
    const seen = new Map<string, number>();
    for (const [s, i] of filled) {
      if (!s!.itemId) continue;
      if (seen.has(s!.itemId)) {
        issues.push({
          severity: 'error',
          code: 'item-clause',
          slot: i,
          message: `Duplicate Held Item: ${dex.item(s!.itemId)?.name ?? s!.itemId} is also on slot ${seen.get(s!.itemId)! + 1}.`,
        });
      } else seen.set(s!.itemId, i);
    }
  }

  // ---- Per-slot ------------------------------------------------------------------------
  for (const [set, i] of filled) {
    const s = set!;
    const sp = dex.species(s.speciesId);
    const label = sp?.name ?? s.speciesId;
    const push = (severity: Severity, code: string, message: string) =>
      issues.push({ severity, code, slot: i, message: `${label}: ${message}` });

    if (!sp) {
      push('error', 'unknown-species', 'unknown species.');
      continue;
    }
    if (reg && !sp.legalIn.includes(reg)) push('error', 'species-illegal', `not legal in ${format.shortName}.`);

    // Ability
    if (!s.abilityId) push('warning', 'no-ability', 'no ability selected.');
    else if (!Object.values(sp.abilities).some((a) => dex.ability(a)?.id === s.abilityId))
      push('error', 'ability-illegal', `${dex.ability(s.abilityId)?.name ?? s.abilityId} is not one of its abilities.`);

    // Item
    if (s.itemId) {
      const item = dex.item(s.itemId);
      if (!item) push('error', 'unknown-item', `unknown item "${s.itemId}".`);
      else if (reg && !item.legalIn.includes(reg)) push('error', 'item-illegal', `${item.name} is not legal in ${format.shortName}.`);
      else if (item.megaStone && !item.megaStone[sp.id])
        push('warning', 'mega-stone-mismatch', `${item.name} does nothing on ${sp.name}.`);
      if (item?.megaStone && !format.gimmicks.mega) push('error', 'mega-banned', 'Mega Evolution is not allowed in this format.');
    } else push('info', 'no-item', 'no held item.');

    // Moves
    const moves = s.moves.filter(Boolean);
    if (moves.length === 0) push('warning', 'no-moves', 'no moves selected.');
    const seenMoves = new Set<string>();
    for (const m of moves) {
      const mv = dex.move(m);
      if (!mv) push('error', 'unknown-move', `unknown move "${m}".`);
      else if (!dex.canLearn(sp.id, mv.id))
        push('error', 'move-illegal', `Invalid Move for Selected Regulation: ${mv.name} is not in its ${format.shortName} learnset.`);
      else if (reg && !mv.legalIn.includes(reg))
        push('error', 'move-illegal', `Invalid Move for Selected Regulation: ${mv.name} is not usable in ${format.shortName}.`);
      if (seenMoves.has(m)) push('error', 'duplicate-move', `${mv?.name ?? m} is selected twice.`);
      seenMoves.add(m);
    }

    // Spread
    const sys = format.statSystem;
    if (sys.kind === 'champions-sp' || sys.kind === 'modern-ev') {
      const spread = sys.kind === 'champions-sp' ? s.sp : s.evs;
      const unit = sys.kind === 'champions-sp' ? 'SP' : 'EVs';
      const total = sumStats(spread);
      if (total > sys.totalCap) push('error', 'spread-over', `Exceeded ${sys.totalCap} ${unit} Cap (${total}/${sys.totalCap}).`);
      else if (total < sys.totalCap)
        push('warning', 'spread-under', `${sys.totalCap - total} ${unit} unallocated (${total}/${sys.totalCap}).`);
      for (const k of STAT_IDS) {
        if (spread[k] > sys.perStatCap)
          push('error', 'stat-over', `${STAT_LABELS[k]} has ${spread[k]} ${unit} (max ${sys.perStatCap}).`);
        if (spread[k] < 0) push('error', 'stat-negative', `${STAT_LABELS[k]} ${unit} cannot be negative.`);
      }
    }

    if (format.gimmicks.tera && !s.teraType) push('info', 'no-tera', 'no Tera Type set.');
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.slot ?? -1) - (b.slot ?? -1));
}
