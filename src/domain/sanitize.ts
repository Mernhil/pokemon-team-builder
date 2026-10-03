import type { LoggedMon, Match, MatchResult } from './matches';
import { emptySlots, uid } from './team';
import { STAT_IDS, type PokemonSet, type StatTable, type Team, type TeamSlots, type TeraType } from './types';

/**
 * Structural coercion for teams coming from outside the app (JSON backups, share codes, persisted
 * storage). Imported data is persisted, so one malformed field would otherwise crash every reload.
 * This only guarantees the shape the UI relies on; legality is still reported by validation.ts.
 */

const MAX_NAME = 100;
const MAX_NOTES = 5000;
const MAX_ID = 64;
/** Ids key plain objects: restrict to what uid() produces (no `__proto__`). */
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const safeId = (v: unknown): string => (typeof v === 'string' && ID_RE.test(v) ? v : uid());

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const int = (v: unknown, min: number, max: number, dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : dflt;

function statTable(v: unknown, dflt: number, max = 255): StatTable {
  const src = isObj(v) ? v : {};
  return Object.fromEntries(STAT_IDS.map((k) => [k, int(src[k], 0, max, dflt)])) as StatTable;
}

export function sanitizeSet(v: unknown): PokemonSet | null {
  if (!isObj(v)) return null;
  const speciesId = str(v.speciesId, MAX_ID);
  if (!speciesId) return null;
  const m = Array.isArray(v.moves) ? v.moves : [];
  const move = (i: number) => str(m[i], MAX_ID) ?? '';
  const gender = v.gender === 'M' || v.gender === 'F' ? v.gender : undefined;
  return {
    uid: safeId(v.uid),
    speciesId,
    nickname: str(v.nickname, MAX_NAME),
    abilityId: str(v.abilityId, MAX_ID),
    itemId: str(v.itemId, MAX_ID),
    nature: str(v.nature, MAX_ID) ?? 'Hardy',
    teraType: str(v.teraType, MAX_ID) as TeraType | undefined,
    moves: [move(0), move(1), move(2), move(3)],
    level: int(v.level, 1, 100, 100),
    sp: statTable(v.sp, 0),
    // evs also holds Gen 1–2 Stat Exp (up to 65535); per-format ranges are validation.ts' job.
    evs: statTable(v.evs, 0, 65535),
    ivs: statTable(v.ivs, 31),
    gender,
    shiny: v.shiny === true ? true : undefined,
    friendship: v.friendship === undefined ? undefined : int(v.friendship, 0, 255, 255),
  };
}

/** Returns a well-formed copy of `v`, or null when it isn't recognisably a team. */
export function sanitizeTeam(v: unknown): Team | null {
  if (!isObj(v) || !Array.isArray(v.slots)) return null;
  const now = Date.now();
  const slots = Array.from({ length: 6 }, (_, i) => sanitizeSet((v.slots as unknown[])[i])) as TeamSlots;
  // Only a genuine reference (self-refs are dropped) — group-existence is checked by the caller,
  // which has visibility into the rest of the batch/store.
  const id = safeId(v.id);
  const groupId = typeof v.groupId === 'string' && ID_RE.test(v.groupId) && v.groupId !== id ? v.groupId : undefined;
  const slotsByFormat = isObj(v.slotsByFormat)
    ? Object.fromEntries(
        Object.entries(v.slotsByFormat)
          .filter(([k]) => typeof k === 'string' && k.length <= MAX_ID)
          .map(([k, s]) => [k, Array.isArray(s) ? (Array.from({ length: 6 }, (_, i) => sanitizeSet((s as unknown[])[i])) as TeamSlots) : emptySlots()]),
      )
    : undefined;
  return {
    id,
    name: str(v.name, MAX_NAME) ?? 'Imported Team',
    formatId: str(v.formatId, MAX_ID) ?? '',
    category: str(v.category, MAX_NAME),
    notes: str(v.notes, MAX_NOTES),
    replicaCode: str(v.replicaCode, 16),
    slots,
    slotsByFormat: slotsByFormat && Object.keys(slotsByFormat).length ? slotsByFormat : undefined,
    createdAt: int(v.createdAt, 0, Number.MAX_SAFE_INTEGER, now),
    updatedAt: int(v.updatedAt, 0, Number.MAX_SAFE_INTEGER, now),
    groupId,
    variationLabel: str(v.variationLabel, MAX_NAME),
    shared: sanitizeShared(v.shared),
  };
}

function sanitizeShared(v: unknown): Team['shared'] {
  if (!isObj(v)) return undefined;
  const owner = str(v.owner, 254);
  if (!owner || !owner.includes('@')) return undefined;
  return { owner: owner.toLowerCase(), role: v.role === 'edit' ? 'edit' : 'view' };
}

function sanitizeLoggedMon(v: unknown): LoggedMon | null {
  if (!isObj(v)) return null;
  const speciesId = str(v.speciesId, MAX_ID);
  if (!speciesId) return null;
  const moves = Array.isArray(v.moves) ? v.moves.map((m) => str(m, MAX_ID)).filter((m): m is string => !!m).slice(0, 4) : undefined;
  return {
    speciesId,
    itemId: str(v.itemId, MAX_ID),
    abilityId: str(v.abilityId, MAX_ID),
    moves: moves && moves.length ? moves : undefined,
    teraType: str(v.teraType, MAX_ID) as TeraType | undefined,
  };
}

/** A list of ids (deduped, at most `max`), or undefined when there are none. */
function idList(v: unknown, max: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ids = [...new Set(v.map((x) => str(x, MAX_ID)).filter((x): x is string => !!x))].slice(0, max);
  return ids.length ? ids : undefined;
}

/** Returns a well-formed copy of `v`, or null when it isn't recognisably a match. */
export function sanitizeMatch(v: unknown): Match | null {
  if (!isObj(v)) return null;
  const date = str(v.date, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const now = Date.now();
  const opponentTeam = Array.isArray(v.opponentTeam)
    ? v.opponentTeam.map(sanitizeLoggedMon).filter((m): m is LoggedMon => !!m).slice(0, 6)
    : [];
  const myTeam = Array.isArray(v.myTeam)
    ? v.myTeam.map(sanitizeLoggedMon).filter((m): m is LoggedMon => !!m).slice(0, 6)
    : undefined;
  // Brought: up to 6 (the roster); leads: up to 2, and only among those brought when brought is known.
  const myBrought = idList(v.myBrought, 6);
  const oppBrought = idList(v.oppBrought, 6);
  const leadsOf = (leads: unknown, brought: string[] | undefined) => {
    const all = idList(leads, 6);
    const l = (brought ? all?.filter((x) => brought.includes(x)) : all)?.slice(0, 2);
    return l && l.length ? l : undefined;
  };
  return {
    id: safeId(v.id),
    date,
    result: v.result === 'loss' ? 'loss' : ('win' as MatchResult),
    regulationId: str(v.regulationId, MAX_ID),
    category: str(v.category, MAX_NAME),
    eventName: str(v.eventName, MAX_NAME),
    myTeamId: str(v.myTeamId, MAX_ID),
    myTeam: myTeam && myTeam.length ? myTeam : undefined,
    myArchetype: str(v.myArchetype, MAX_NAME),
    opponentTeam,
    opponentArchetype: str(v.opponentArchetype, MAX_NAME),
    myBrought,
    myLeads: leadsOf(v.myLeads, myBrought),
    oppBrought,
    oppLeads: leadsOf(v.oppLeads, oppBrought),
    notes: str(v.notes, MAX_NOTES),
    createdAt: int(v.createdAt, 0, Number.MAX_SAFE_INTEGER, now),
    updatedAt: int(v.updatedAt, 0, Number.MAX_SAFE_INTEGER, now),
  };
}
