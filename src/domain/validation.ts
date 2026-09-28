import type { Dex } from '@/data/dex';
import { formatMechanics } from './games';
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
  const mech = formatMechanics(format);
  const champions = format.statSystem.kind === 'champions-sp';
  const where = champions ? format.shortName : `${format.shortName} (${format.name.replace(/^Gen \d+ · /, '')})`;
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
    if (reg && !sp.legalIn.includes(reg))
      push('error', 'species-illegal', champions ? `not legal in ${format.shortName}.` : `not obtainable in ${where}.`);

    // Ability (Gen 3+)
    if (mech.abilities) {
      if (!s.abilityId) push('warning', 'no-ability', 'no ability selected.');
      else if (!Object.values(sp.abilities).some((a) => dex.ability(a)?.id === s.abilityId))
        push('error', 'ability-illegal', `${dex.ability(s.abilityId)?.name ?? s.abilityId} is not one of its abilities${champions ? '' : ` in Gen ${format.generation}`}.`);
    }

    // Level
    if (!format.level.fixed && (s.level < format.level.min || s.level > format.level.max))
      push('error', 'level-range', `level ${s.level} is outside ${format.level.min}–${format.level.max}.`);

    // Item (held items arrived in Gen 2)
    const where2 = format.game ? format.shortName : `Gen ${format.generation}`;
    if (s.itemId && !mech.heldItems && !(mech.megaStoneOnly && dex.item(s.itemId)?.megaStone))
      push('error', 'item-illegal', mech.megaStoneOnly ? `only a Mega Stone can be chosen in ${where2}.` : `Pokémon can't hold items in ${where2}.`);
    else if (s.itemId) {
      const item = dex.item(s.itemId);
      if (!item) push('error', 'unknown-item', `unknown item "${s.itemId}".`);
      else if (reg && !item.legalIn.includes(reg)) push('error', 'item-illegal', `${item.name} is not legal in ${format.shortName}.`);
      else if (item.megaStone && !item.megaStone[sp.id])
        push('warning', 'mega-stone-mismatch', `${item.name} does nothing on ${sp.name}.`);
      if (item?.megaStone && !format.capabilities.mega) push('error', 'mega-banned', 'Mega Evolution is not allowed in this format.');
    } else if (mech.heldItems) push('info', 'no-item', 'no held item.');

    // Moves
    const moves = s.moves.filter(Boolean);
    if (moves.length === 0) push('warning', 'no-moves', 'no moves selected.');
    const seenMoves = new Set<string>();
    for (const m of moves) {
      const mv = dex.move(m);
      if (!mv) push('error', 'unknown-move', `unknown move "${m}".`);
      else if (!dex.canLearn(sp.id, mv.id))
        push(
          'error',
          'move-illegal',
          champions
            ? `Invalid Move for Selected Regulation: ${mv.name} is not in its ${format.shortName} learnset.`
            : `${mv.name} can't be learned in ${where}.`,
        );
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
    if (sys.kind === 'modern-ev') {
      for (const k of STAT_IDS)
        if (s.ivs[k] < 0 || s.ivs[k] > sys.ivMax) push('error', 'iv-range', `${STAT_LABELS[k]} IV ${s.ivs[k]} is outside 0–${sys.ivMax}.`);
    }
    if (sys.kind === 'lgpe-av' || sys.kind === 'pla-effort') {
      const max = sys.kind === 'lgpe-av' ? sys.avMax : sys.levelMax;
      const unit = sys.kind === 'lgpe-av' ? 'AVs' : 'Effort Level';
      for (const k of STAT_IDS)
        if (s.evs[k] < 0 || s.evs[k] > max) push('error', 'stat-over', `${STAT_LABELS[k]} ${unit} ${s.evs[k]} is outside 0–${max}.`);
      if (sys.kind === 'lgpe-av')
        for (const k of STAT_IDS)
          if (s.ivs[k] < 0 || s.ivs[k] > sys.ivMax) push('error', 'iv-range', `${STAT_LABELS[k]} IV ${s.ivs[k]} is outside 0–${sys.ivMax}.`);
    }
    if (sys.kind === 'gb-statexp') {
      for (const k of STAT_IDS) {
        if (s.evs[k] < 0 || s.evs[k] > sys.statExpMax)
          push('error', 'statexp-range', `${STAT_LABELS[k]} Stat Exp ${s.evs[k]} is outside 0–${sys.statExpMax}.`);
        if (k !== 'hp' && (s.ivs[k] < 0 || s.ivs[k] > sys.dvMax))
          push('warning', 'dv-range', `${STAT_LABELS[k]} DV ${s.ivs[k]} is outside 0–${sys.dvMax} (treated as ${Math.min(sys.dvMax, Math.max(0, s.ivs[k]))}).`);
      }
    }

    if (format.capabilities.tera && !s.teraType) push('info', 'no-tera', 'no Tera Type set.');
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.slot ?? -1) - (b.slot ?? -1));
}
