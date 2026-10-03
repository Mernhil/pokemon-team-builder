/**
 * Playthrough / Nuzlocke runs, pure: the run model and its rules (first encounter per area, dupes,
 * shiny and species clauses), level caps and the boss order from the Pokénav data, plus the
 * sanitiser the persisted store loads through. No React, no store.
 */
import type { Dex } from '@/data/dex';
import type { AtlasFile, AtlasTrainer } from './atlasTypes';
import { atlasGame } from './atlas';
import { createSet, createTeam } from './team';
import type { FormatRules, Pokemon, Team, TeamSlots } from './types';

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type EncounterStatus = 'caught' | 'fainted' | 'fled' | 'skipped' | 'gift';
export const ENCOUNTER_LABEL: Record<EncounterStatus, string> = { caught: 'Caught', fainted: 'Fainted', fled: 'Fled', skipped: 'Skipped', gift: 'Gift' };
const STATUSES = Object.keys(ENCOUNTER_LABEL) as EncounterStatus[];
/** The statuses that use up an area's one wild encounter. A gift is not a wild encounter; "skipped" records "nothing usable here" (a dupe re-roll, no way to find one) and leaves the area open. */
export const USES_AREA: readonly EncounterStatus[] = ['caught', 'fainted', 'fled'];

export type LevelCapMode = 'off' | 'soft' | 'hard';

export interface RunRules {
  nuzlocke: boolean;
  /** Only the first wild Pokémon met in each area counts. */
  firstEncounter: boolean;
  /** An evolution line already caught may be re-rolled: its area stays open. */
  dupes: boolean;
  /** A shiny may be caught even where the area is used. */
  shiny: boolean;
  /** Only one Pokémon of each evolution line in the party. */
  species: boolean;
  levelCaps: LevelCapMode;
  notes: string;
}

export const defaultRules = (nuzlocke: boolean): RunRules => ({ nuzlocke, firstEncounter: nuzlocke, dupes: nuzlocke, shiny: nuzlocke, species: false, levelCaps: nuzlocke ? 'soft' : 'off', notes: '' });

export interface RunEncounter {
  id: string;
  loc: string;
  species?: string;
  status: EncounterStatus;
  nickname?: string;
  shiny?: boolean;
  at: number;
}

export type MonState = 'party' | 'box' | 'dead';
export interface RunMon {
  id: string;
  species: string;
  nickname?: string;
  level: number;
  state: MonState;
  /** The encounter that gave it, when it came from one. */
  encounterId?: string;
  death?: { loc?: string; cause: string; at: number };
}

export interface Run {
  id: string;
  game: string;
  name: string;
  /** YYYY-MM-DD. */
  startedAt: string;
  rules: RunRules;
  encounters: RunEncounter[];
  mons: RunMon[];
  /** Milestone ids (see `milestones`) beaten so far: gym leaders (badges), Elite Four members, the Champion. */
  beaten: string[];
  createdAt: number;
  updatedAt: number;
}

export const PARTY_SIZE = 6;

let counter = 0;
const newId = (prefix: string, now: number) => `${prefix}-${now.toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export function createRun(input: { game: string; name?: string; rules?: RunRules; now?: number; id?: string }): Run {
  const now = input.now ?? Date.now();
  return {
    id: input.id ?? newId('run', now),
    game: input.game,
    name: input.name?.trim() || `${atlasGame(input.game).shortName} run`,
    startedAt: new Date(now).toISOString().slice(0, 10),
    rules: input.rules ?? defaultRules(true),
    encounters: [],
    mons: [],
    beaten: [],
    createdAt: now,
    updatedAt: now,
  };
}

const touch = (run: Run, now: number, patch: Partial<Run>): Run => ({ ...run, ...patch, updatedAt: now });

// ---------------------------------------------------------------------------
// Evolution lines and the clauses
// ---------------------------------------------------------------------------

type Get = (id: string) => Pick<Pokemon, 'prevo'> | undefined;

/** The earliest pre-evolution of a species: the id its whole line is known by. */
export function familyRoot(get: Get, speciesId: string): string {
  let id = speciesId;
  const seen = new Set<string>();
  for (;;) {
    const prevo = get(id)?.prevo;
    if (!prevo || seen.has(prevo) || !get(prevo)) return id;
    seen.add(id);
    id = prevo;
  }
}

/** Evolution lines already caught or gifted (the dupes clause), including those whose Pokémon has since died. */
export function caughtFamilies(run: Run, get: Get): Set<string> {
  return new Set(run.mons.map((m) => familyRoot(get, m.species)));
}

export type AreaStatus = 'used' | 'available' | 'none';

/** An area's wild encounter: used once a catch, faint or flee is logged there; "none" where the game has no wild encounters. */
export function areaStatus(run: Run, loc: string, hasEncounters: boolean): AreaStatus {
  if (!hasEncounters) return 'none';
  return run.encounters.some((e) => e.loc === loc && USES_AREA.includes(e.status)) ? 'used' : 'available';
}

export interface EncounterCheck {
  ok: boolean;
  /** Why not, in plain words (empty when ok). */
  problems: string[];
}

/** Do the rules allow logging this species as a wild encounter at `loc`? */
export function encounterCheck(run: Run, loc: string, speciesId: string, get: Get, opts: { shiny?: boolean } = {}): EncounterCheck {
  const problems: string[] = [];
  if (run.rules.nuzlocke) {
    const shinyOk = run.rules.shiny && opts.shiny;
    if (run.rules.firstEncounter && areaStatus(run, loc, true) === 'used' && !shinyOk) problems.push('This area’s encounter is already used.');
    if (run.rules.dupes && caughtFamilies(run, get).has(familyRoot(get, speciesId))) problems.push('Already caught: re-roll (dupes clause).');
  }
  return { ok: problems.length === 0, problems };
}

/** Species clause: evolution lines that appear more than once in the party. */
export function partyProblems(run: Run, get: Get): string[] {
  if (!run.rules.species) return [];
  const seen = new Map<string, string>();
  const out: string[] = [];
  for (const m of run.mons) {
    if (m.state !== 'party') continue;
    const root = familyRoot(get, m.species);
    const other = seen.get(root);
    if (other) out.push(`${other} and ${m.nickname || m.species} are the same evolution line.`);
    else seen.set(root, m.nickname || m.species);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Changing a run (each returns a new run)
// ---------------------------------------------------------------------------

export interface EncounterInput {
  loc: string;
  species?: string;
  status: EncounterStatus;
  nickname?: string;
  shiny?: boolean;
  level?: number;
}

/** Logs an encounter; a catch or a gift also adds the Pokémon (to the party while there is room, else the box). */
export function logEncounter(run: Run, input: EncounterInput, now = Date.now()): Run {
  const enc: RunEncounter = { id: newId('enc', now), loc: input.loc, species: input.species, status: input.status, nickname: input.nickname?.trim() || undefined, shiny: input.shiny || undefined, at: now };
  const mons = [...run.mons];
  if ((input.status === 'caught' || input.status === 'gift') && input.species) {
    const inParty = mons.filter((m) => m.state === 'party').length;
    mons.push({ id: newId('mon', now), species: input.species, nickname: enc.nickname, level: clampLevel(input.level ?? 5), state: inParty < PARTY_SIZE ? 'party' : 'box', encounterId: enc.id });
  }
  return touch(run, now, { encounters: [...run.encounters, enc], mons });
}

/** Removes a logged encounter and the Pokémon it gave. */
export function removeEncounter(run: Run, encounterId: string, now = Date.now()): Run {
  return touch(run, now, { encounters: run.encounters.filter((e) => e.id !== encounterId), mons: run.mons.filter((m) => m.encounterId !== encounterId) });
}

export const clampLevel = (n: number) => Math.max(1, Math.min(100, Math.round(Number.isFinite(n) ? n : 1)));

export function setMonLevel(run: Run, monId: string, level: number, now = Date.now()): Run {
  return touch(run, now, { mons: run.mons.map((m) => (m.id === monId ? { ...m, level: clampLevel(level) } : m)) });
}

/** Moves a Pokémon between party and box. A seventh party member is refused (the run comes back unchanged). A dead one stays dead. */
export function setMonState(run: Run, monId: string, state: 'party' | 'box', now = Date.now()): Run {
  const mon = run.mons.find((m) => m.id === monId);
  if (!mon || mon.state === 'dead' || mon.state === state) return run;
  if (state === 'party' && run.mons.filter((m) => m.state === 'party').length >= PARTY_SIZE) return run;
  return touch(run, now, { mons: run.mons.map((m) => (m.id === monId ? { ...m, state } : m)) });
}

export function markDeath(run: Run, monId: string, death: { loc?: string; cause: string }, now = Date.now()): Run {
  const mon = run.mons.find((m) => m.id === monId);
  if (!mon || mon.state === 'dead') return run;
  return touch(run, now, { mons: run.mons.map((m) => (m.id === monId ? { ...m, state: 'dead', death: { loc: death.loc, cause: death.cause.trim().slice(0, 200), at: now } } : m)) });
}

/** Brings a Pokémon back (an undone death, or a revive in a game without Nuzlocke rules): to the box. */
export function reviveMon(run: Run, monId: string, now = Date.now()): Run {
  return touch(run, now, { mons: run.mons.map((m) => (m.id === monId && m.state === 'dead' ? { ...m, state: 'box', death: undefined } : m)) });
}

export function toggleBeaten(run: Run, milestoneId: string, now = Date.now()): Run {
  const beaten = run.beaten.includes(milestoneId) ? run.beaten.filter((b) => b !== milestoneId) : [...run.beaten, milestoneId];
  return touch(run, now, { beaten });
}

export const partyOf = (run: Run) => run.mons.filter((m) => m.state === 'party');

// ---------------------------------------------------------------------------
// Milestones: gyms, Elite Four, Champion, and the level cap they set
// ---------------------------------------------------------------------------

export type MilestoneKind = 'gym' | 'elite-four' | 'champion';

export interface Milestone {
  id: string;
  kind: MilestoneKind;
  /** "Fantina", "Aaron", "Cynthia". */
  name: string;
  /** "Fantina (Relic Badge)" style text for lists and the cap line. */
  label: string;
  badge?: string;
  /** The highest level in their team. */
  level: number;
  /** The trainer's Pokénav group (to open their team), when the data has one. */
  group?: string;
  loc?: string;
  /** "Johto" / "Kanto" where a game has both. */
  region?: string;
}

interface Segment {
  kind: MilestoneKind;
  names: string[];
  /** Gym leaders the player may take in any order: sorted by level. */
  free?: boolean;
  region?: string;
}

const KANTO8 = ['Brock', 'Misty', 'Lt. Surge', 'Erika', 'Koga', 'Sabrina', 'Blaine', 'Giovanni'];
const KANTO_E4 = ['Lorelei', 'Bruno', 'Agatha', 'Lance'];
const JOHTO8 = ['Falkner', 'Bugsy', 'Whitney', 'Morty', 'Chuck', 'Jasmine', 'Pryce', 'Clair'];
const JOHTO_E4 = ['Will', 'Koga', 'Bruno', 'Karen'];
const HOENN8 = ['Roxanne', 'Brawly', 'Wattson', 'Flannery', 'Norman', 'Winona', 'Tate&Liza'];
const SINNOH_E4 = ['Aaron', 'Bertha', 'Flint', 'Lucian'];

/** The order of each game's progression. The Pokénav data's badge list is not in game order, so this is written out; keyed by the atlas file (Blue reads Red's, Silver Gold's…). */
const PLANS: Record<string, Segment[]> = {
  red: [{ kind: 'gym', names: KANTO8, region: 'Kanto' }, { kind: 'elite-four', names: KANTO_E4 }, { kind: 'champion', names: [] }],
  yellow: [{ kind: 'gym', names: KANTO8, region: 'Kanto' }, { kind: 'elite-four', names: KANTO_E4 }, { kind: 'champion', names: [] }],
  firered: [{ kind: 'gym', names: KANTO8, region: 'Kanto' }, { kind: 'elite-four', names: KANTO_E4 }, { kind: 'champion', names: [] }],
  gold: [
    { kind: 'gym', names: JOHTO8, region: 'Johto' }, { kind: 'elite-four', names: JOHTO_E4 }, { kind: 'champion', names: ['Lance'] },
    { kind: 'gym', names: ['Lt. Surge', 'Sabrina', 'Erika', 'Janine', 'Misty', 'Brock', 'Blaine'], free: true, region: 'Kanto' },
  ],
  crystal: [
    { kind: 'gym', names: JOHTO8, region: 'Johto' }, { kind: 'elite-four', names: JOHTO_E4 }, { kind: 'champion', names: ['Lance'] },
    { kind: 'gym', names: ['Lt. Surge', 'Sabrina', 'Erika', 'Janine', 'Misty', 'Brock', 'Blaine'], free: true, region: 'Kanto' },
  ],
  heartgold: [
    { kind: 'gym', names: JOHTO8, region: 'Johto' }, { kind: 'elite-four', names: JOHTO_E4 }, { kind: 'champion', names: ['Lance'] },
    { kind: 'gym', names: ['Brock', 'Misty', 'Lt. Surge', 'Erika', 'Janine', 'Sabrina', 'Blaine', 'Blue'], free: true, region: 'Kanto' },
  ],
  ruby: [{ kind: 'gym', names: [...HOENN8, 'Wallace'], region: 'Hoenn' }, { kind: 'elite-four', names: ['Sidney', 'Phoebe', 'Glacia', 'Drake'] }, { kind: 'champion', names: [] }],
  emerald: [{ kind: 'gym', names: [...HOENN8, 'Juan'], region: 'Hoenn' }, { kind: 'elite-four', names: ['Sidney', 'Phoebe', 'Glacia', 'Drake'] }, { kind: 'champion', names: [] }],
  diamond: [{ kind: 'gym', names: ['Roark', 'Gardenia', 'Maylene', 'Wake', 'Fantina', 'Byron', 'Candice', 'Volkner'], region: 'Sinnoh' }, { kind: 'elite-four', names: SINNOH_E4 }, { kind: 'champion', names: [] }],
  platinum: [{ kind: 'gym', names: ['Roark', 'Gardenia', 'Fantina', 'Maylene', 'Wake', 'Byron', 'Candice', 'Volkner'], region: 'Sinnoh' }, { kind: 'elite-four', names: SINNOH_E4 }, { kind: 'champion', names: [] }],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const topLevel = (t: AtlasTrainer) => Math.max(0, ...t.party.map((m) => m.level));
const ALIASES: Record<string, string> = { wake: 'crasherwake', ltsurge: 'ltsurge' };
const sameName = (a: string, b: string) => norm(a) === norm(b) || norm(a) === ALIASES[norm(b)] || ALIASES[norm(a)] === norm(b);

/** Is this game's Pokénav data complete enough for caps and bosses? Encounters-only games and games without a plan are not. */
export function hasMilestones(gameId: string): boolean {
  const g = atlasGame(gameId);
  return !g.lite && !!PLANS[g.file ?? g.id];
}

function resolveGym(file: AtlasFile, name: string): Omit<Milestone, 'id' | 'kind' | 'label' | 'region'> | undefined {
  const gymLoc = Object.values(file.locations).find((l) => l.gym && sameName(l.gym.leader, name));
  // First battle only, standing in the gym (a leader may also appear elsewhere, e.g. a rematch tower or the Battle Frontier).
  const here = gymLoc?.trainers.map((id) => file.trainers[id]).filter((t): t is AtlasTrainer => !!t && sameName(t.name, name) && t.order === 0);
  const pick = here?.[0] ?? Object.values(file.trainers).filter((t) => (t.kind === 'leader' || t.kind === 'boss') && sameName(t.name, name) && t.order === 0 && t.loc === gymLoc?.id)[0] ?? Object.values(file.trainers).find((t) => t.kind === 'leader' && sameName(t.name, name) && t.order === 0);
  if (pick) return { name: pick.name, badge: gymLoc?.gym?.badge, level: topLevel(pick), group: pick.group, loc: gymLoc?.id ?? pick.loc };
  if (gymLoc?.gym) return { name: gymLoc.gym.leader, badge: gymLoc.gym.badge, level: gymLoc.gym.levelCap, loc: gymLoc.id };
  return undefined;
}

function resolveByKind(file: AtlasFile, kind: 'elite-four' | 'champion', name?: string): Omit<Milestone, 'id' | 'kind' | 'label' | 'region'> | undefined {
  const pool = Object.values(file.trainers).filter((t) => t.kind === kind && (!name || sameName(t.name, name)));
  // The first battle: the lowest `order`, and the lowest level among equals (rematches repeat the same name later).
  pool.sort((a, b) => a.order - b.order || topLevel(a) - topLevel(b));
  const t = pool[0];
  return t ? { name: t.name, level: topLevel(t), group: t.group, loc: t.loc } : undefined;
}

/**
 * Gym leaders, the Elite Four and the Champion in the order the game sets, each with the highest
 * level of their team. A level never drops inside the Elite Four and Champion run (the data's
 * Johto Champion is sometimes a story battle at a lower level).
 */
export function milestones(file: AtlasFile, gameId: string): Milestone[] {
  const g = atlasGame(gameId);
  const plan = g.lite ? undefined : PLANS[g.file ?? g.id];
  if (!plan) return [];
  const out: Milestone[] = [];
  for (const seg of plan) {
    const part: Milestone[] = [];
    if (seg.kind === 'champion') {
      const r = resolveByKind(file, 'champion', seg.names[0]);
      if (r) part.push({ id: `champion:${norm(r.name)}`, kind: 'champion', label: `Champion ${r.name}`, ...r });
    } else {
      for (const name of seg.names) {
        const r = seg.kind === 'gym' ? resolveGym(file, name) : resolveByKind(file, 'elite-four', name);
        if (!r) continue;
        part.push({ id: `${seg.kind}:${norm(r.name)}`, kind: seg.kind, label: seg.kind === 'gym' ? `${r.name}${r.badge ? ` (${r.badge.replace(/ Badge$/, '')} Badge)` : ''}` : `Elite Four ${r.name}`, region: seg.region, ...r });
      }
      if (seg.free) part.sort((a, b) => a.level - b.level);
    }
    out.push(...part);
  }
  // Elite Four and Champion: never lower than the one before.
  let floor = 0;
  return out.map((m) => {
    if (m.kind === 'gym') return m;
    const level = Math.max(m.level, floor);
    floor = level;
    return level === m.level ? m : { ...m, level };
  });
}

/** The first milestone not beaten yet (undefined when the run has beaten them all). */
export const nextMilestone = (list: Milestone[], run: Pick<Run, 'beaten'>): Milestone | undefined => list.find((m) => !run.beaten.includes(m.id));

export const badgeCount = (list: Milestone[], run: Pick<Run, 'beaten'>) => list.filter((m) => m.kind === 'gym' && run.beaten.includes(m.id)).length;

export interface CapWarning {
  monId: string;
  level: number;
  cap: number;
}

/** Party members above the next cap (the Pokémon that should wait). With caps off, or nothing left to beat, there are none. */
export function capWarnings(run: Run, next: Milestone | undefined): CapWarning[] {
  if (!next || run.rules.levelCaps === 'off') return [];
  return partyOf(run).filter((m) => m.level > next.level).map((m) => ({ monId: m.id, level: m.level, cap: next.level }));
}

export interface RunSummary {
  badges: number;
  totalBadges: number;
  alive: number;
  dead: number;
  next?: Milestone;
}

export function summarize(run: Run, list: Milestone[]): RunSummary {
  return {
    badges: badgeCount(list, run),
    totalBadges: list.filter((m) => m.kind === 'gym').length,
    alive: run.mons.filter((m) => m.state !== 'dead').length,
    dead: run.mons.filter((m) => m.state === 'dead').length,
    next: nextMilestone(list, run),
  };
}

// ---------------------------------------------------------------------------
// The party as a team, and type matchups against a boss
// ---------------------------------------------------------------------------

/** The party as a Builder team in the game's format (levels and nicknames kept; moves and the rest are the Builder's defaults). */
export function partyToTeam(run: Run, dex: Dex, format: FormatRules): Team {
  const team = createTeam(format, `${run.name} (party)`);
  const slots = [...team.slots] as TeamSlots;
  partyOf(run).slice(0, format.teamSize).forEach((m, i) => {
    slots[i] = { ...createSet(dex, m.species, format), level: m.level, nickname: m.nickname };
  });
  return { ...team, slots, category: `${format.shortName} · Run` };
}

/** Something that attacks with a set of types (a Pokémon's own types, or the types of its attacking moves). */
export interface TypeSide {
  name: string;
  types: string[];
}
export interface MatchupRow {
  defender: string;
  /** The best (attacker, type) against it; undefined when no attacker has a type to use. */
  best?: { attacker: string; type: string; mult: number };
}

/** For each defender, which attacker's type hits it hardest. Plain type matchups, ties go to the earlier attacker. */
export function bestMatchups(attackers: TypeSide[], defenders: { name: string; types: string[] }[], effectiveness: (attack: string, defender: string[]) => number): MatchupRow[] {
  return defenders.map((d) => {
    let best: MatchupRow['best'];
    for (const a of attackers)
      for (const type of a.types) {
        const mult = effectiveness(type, d.types);
        if (!best || mult > best.mult) best = { attacker: a.name, type, mult };
      }
    return { defender: d.name, best };
  });
}

// ---------------------------------------------------------------------------
// Loading: sanitiser and migration
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const ID = /^[A-Za-z0-9._:-]{1,80}$/;
const idOf = (v: unknown, fallback: () => string) => (typeof v === 'string' && ID.test(v) ? v : fallback());

export function sanitizeRules(v: unknown): RunRules {
  const r = isObj(v) ? v : {};
  const nuz = bool(r.nuzlocke, true);
  const d = defaultRules(nuz);
  return {
    nuzlocke: nuz,
    firstEncounter: bool(r.firstEncounter, d.firstEncounter),
    dupes: bool(r.dupes, d.dupes),
    shiny: bool(r.shiny, d.shiny),
    species: bool(r.species, d.species),
    levelCaps: r.levelCaps === 'off' || r.levelCaps === 'soft' || r.levelCaps === 'hard' ? r.levelCaps : d.levelCaps,
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 2000) : '',
  };
}

/** A well-formed copy of a stored run, or null when it isn't recognisably one. Unknown games are kept (the picker just won't offer them). */
export function sanitizeRun(v: unknown): Run | null {
  if (!isObj(v)) return null;
  const game = str(v.game, 40);
  if (!game) return null;
  const now = Date.now();
  const encounters: RunEncounter[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(v.encounters) ? v.encounters.slice(0, 2000) : []) {
    if (!isObj(raw)) continue;
    const loc = str(raw.loc, 120);
    const status = STATUSES.find((s) => s === raw.status);
    if (!loc || !status) continue;
    const id = idOf(raw.id, () => newId('enc', now));
    if (seen.has(id)) continue;
    seen.add(id);
    encounters.push({ id, loc, species: str(raw.species, 64), status, nickname: str(raw.nickname, 30), shiny: raw.shiny === true ? true : undefined, at: num(raw.at, now) });
  }
  const mons: RunMon[] = [];
  const monIds = new Set<string>();
  let inParty = 0;
  for (const raw of Array.isArray(v.mons) ? v.mons.slice(0, 1000) : []) {
    if (!isObj(raw)) continue;
    const species = str(raw.species, 64);
    if (!species) continue;
    const id = idOf(raw.id, () => newId('mon', now));
    if (monIds.has(id)) continue;
    monIds.add(id);
    let state: MonState = raw.state === 'dead' ? 'dead' : raw.state === 'box' ? 'box' : 'party';
    if (state === 'party' && ++inParty > PARTY_SIZE) state = 'box'; // never more than six in the party
    const death = isObj(raw.death) ? { loc: str(raw.death.loc, 120), cause: str(raw.death.cause, 200) ?? '', at: num(raw.death.at, now) } : undefined;
    mons.push({ id, species, nickname: str(raw.nickname, 30), level: clampLevel(num(raw.level, 5)), state, encounterId: typeof raw.encounterId === 'string' && seen.has(raw.encounterId) ? raw.encounterId : undefined, death: state === 'dead' ? (death ?? { cause: '', at: now }) : undefined });
  }
  const startedAt = typeof v.startedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.startedAt) ? v.startedAt : new Date(num(v.createdAt, now)).toISOString().slice(0, 10);
  return {
    id: idOf(v.id, () => newId('run', now)),
    game,
    name: str(v.name, 60) ?? 'Run',
    startedAt,
    rules: sanitizeRules(v.rules),
    encounters,
    mons,
    beaten: Array.isArray(v.beaten) ? [...new Set(v.beaten.filter((b): b is string => typeof b === 'string' && b.length <= 80))].slice(0, 100) : [],
    createdAt: num(v.createdAt, now),
    updatedAt: num(v.updatedAt, now),
  };
}
