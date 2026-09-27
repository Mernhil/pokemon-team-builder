import { uid } from './team';
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

function statTable(v: unknown, dflt: number): StatTable {
  const src = isObj(v) ? v : {};
  return Object.fromEntries(STAT_IDS.map((k) => [k, int(src[k], 0, 255, dflt)])) as StatTable;
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
    evs: statTable(v.evs, 0),
    ivs: statTable(v.ivs, 31),
    gender,
    shiny: v.shiny === true ? true : undefined,
  };
}

/** Returns a well-formed copy of `v`, or null when it isn't recognisably a team. */
export function sanitizeTeam(v: unknown): Team | null {
  if (!isObj(v) || !Array.isArray(v.slots)) return null;
  const now = Date.now();
  const slots = Array.from({ length: 6 }, (_, i) => sanitizeSet((v.slots as unknown[])[i])) as TeamSlots;
  return {
    id: safeId(v.id),
    name: str(v.name, MAX_NAME) ?? 'Imported Team',
    formatId: str(v.formatId, MAX_ID) ?? '',
    category: str(v.category, MAX_NAME),
    notes: str(v.notes, MAX_NOTES),
    replicaCode: str(v.replicaCode, 16),
    slots,
    createdAt: int(v.createdAt, 0, Number.MAX_SAFE_INTEGER, now),
    updatedAt: int(v.updatedAt, 0, Number.MAX_SAFE_INTEGER, now),
  };
}
