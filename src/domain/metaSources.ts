/**
 * Early meta sources: what the Meta tab (and everything built on it) shows for a Champions
 * regulation before Smogon publishes its first month of usage statistics. Pure and React-free;
 * scripts/build-meta.ts does the fetching and calls these.
 *
 *  - Tournament team lists (Limitless VGC, open team sheets): every member's item, ability and
 *    moves, but no spreads.
 *  - Public Showdown replays: Team Preview shows all six Pokémon of both teams, so species usage and
 *    teammates are exact for the games sampled; moves, items and abilities are only what the battle
 *    revealed, as a share of the games the Pokémon was brought to.
 *  - Carry-over: the previous regulation's numbers for the Pokémon, items and moves still allowed.
 *
 * Neither replays nor team lists show spreads, so fillSpreads borrows each species' spreads from
 * another regulation's Smogon statistics, or estimates one from base stats, and marks the entry.
 */
import { z } from 'zod';
import { MetaSnapshotSchema, type MetaEntry, type MetaSnapshot } from './meta.ts';
import { toID } from './id.ts';

const round1 = (n: number) => Math.round(n * 10) / 10;
const isId = (s: string) => /^[a-z0-9]{1,64}$/.test(s);

// ---------------------------------------------------------------------------
// Team records: one team as a source saw it
// ---------------------------------------------------------------------------

interface TeamMember {
  speciesId: string;
  /** Replays: whether it was sent out (VGC brings 4 of 6). Team lists: always true. */
  brought: boolean;
  itemId?: string;
  abilityId?: string;
  moves: string[];
}
export type TeamRecord = TeamMember[];

export interface AggregateOptions {
  regulationId: string;
  source: MetaSnapshot['source'];
  updatedAt?: string;
  maxSpecies?: number;
  /** Species under this usage % are dropped. */
  minUsagePct?: number;
}

/**
 * Usage from a set of teams: usage = % of teams with the species; teammates = % of its teams that
 * also have the other one; items, abilities and moves = % of the teams that brought it where they
 * were seen (for team lists, that's every team with it).
 */
export function teamsToSnapshot(teams: TeamRecord[], o: AggregateOptions): MetaSnapshot | null {
  const valid = teams.filter((t) => t.length > 0);
  if (!valid.length) return null;
  interface Acc {
    teams: number;
    brought: number;
    items: Map<string, number>;
    abilities: Map<string, number>;
    moves: Map<string, number>;
    mates: Map<string, number>;
  }
  const bySpecies = new Map<string, Acc>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const team of valid) {
    const species = [...new Set(team.map((m) => m.speciesId).filter(isId))];
    for (const member of team) {
      if (!isId(member.speciesId)) continue;
      const acc = bySpecies.get(member.speciesId) ?? { teams: 0, brought: 0, items: new Map(), abilities: new Map(), moves: new Map(), mates: new Map() };
      bySpecies.set(member.speciesId, acc);
      // A species twice on one team (not legal in VGC, but a source could say so) counts once.
      if (team.find((m) => m.speciesId === member.speciesId) !== member) continue;
      acc.teams++;
      for (const other of species) if (other !== member.speciesId) bump(acc.mates, other);
      if (!member.brought) continue;
      acc.brought++;
      if (member.itemId && isId(member.itemId)) bump(acc.items, member.itemId);
      if (member.abilityId && isId(member.abilityId)) bump(acc.abilities, member.abilityId);
      for (const mv of new Set(member.moves)) if (isId(mv)) bump(acc.moves, mv);
    }
  }
  const share = (m: Map<string, number>, denom: number, n: number) =>
    [...m.entries()]
      .map(([id, c]) => ({ id, pct: denom > 0 ? round1((c / denom) * 100) : 0 }))
      .filter((x) => x.pct >= 1)
      .sort((a, b) => b.pct - a.pct || a.id.localeCompare(b.id))
      .slice(0, n);
  const entries: MetaEntry[] = [...bySpecies.entries()]
    .map(([speciesId, a]) => ({
      speciesId,
      usagePct: round1(Math.min(100, (a.teams / valid.length) * 100)),
      abilities: share(a.abilities, a.brought, 3),
      items: share(a.items, a.brought, 6),
      moves: share(a.moves, a.brought, 8),
      teammates: share(a.mates, a.teams, 6),
      spreads: [],
    }))
    .filter((e) => e.usagePct >= (o.minUsagePct ?? 1))
    .sort((a, b) => b.usagePct - a.usagePct || a.speciesId.localeCompare(b.speciesId))
    .slice(0, o.maxSpecies ?? 60);
  if (!entries.length) return null;
  return MetaSnapshotSchema.parse({ regulationId: o.regulationId, updatedAt: o.updatedAt ?? new Date().toISOString().slice(0, 10), source: o.source, entries });
}

// ---------------------------------------------------------------------------
// Showdown replay logs
// ---------------------------------------------------------------------------

/** One parsed replay: both teams, plus what the replay server says about it. */
export interface ReplayGame {
  id: string;
  /** Unix seconds. */
  uploadtime: number;
  /** The replay's ladder rating (0 = unrated or unknown). */
  rating: number;
  teams: [TeamRecord, TeamRecord];
}

/** Showdown name → this app's species id (Mega formes count as their base forme), or undefined. */
export type SpeciesResolver = (name: string) => string | undefined;

/** Items that change hands mid-battle make later item reveals unreliable. */
const ITEM_SWAPS = /^\[from\] (move: (Trick|Switcheroo|Thief|Covet|Bestow)|ability: (Pickpocket|Magician|Symbiosis))$/;
/** Abilities that copy another Pokémon's: the line reveals both. */
const ABILITY_COPIERS = new Set(['trace', 'receiver', 'powerofalchemy']);
/** Abilities that replace the attacker's on contact. */
const ABILITY_SPREADERS = new Set(['mummy', 'lingeringaroma', 'wanderingspirit']);

/**
 * Reads a Showdown battle log (the `log` of https://replay.pokemonshowdown.com/<id>.json). Returns
 * null for a log without two Team Previews. Reveals that can't be pinned on a Pokémon's original
 * set (an item after Trick, an ability after Skill Swap or Mega Evolution) are ignored.
 */
export function parseReplayLog(log: string, resolve: SpeciesResolver): [TeamRecord, TeamRecord] | null {
  interface Mon extends TeamMember {
    previewName: string;
    itemTainted: boolean;
    abilityTainted: boolean;
    movesTainted: boolean;
  }
  const sides: Record<'p1' | 'p2', Mon[]> = { p1: [], p2: [] };
  /** "p1: Nickname" → the team member. */
  const byNick = new Map<string, Mon>();
  const sideOf = (s: string) => (s === 'p1' || s === 'p2' ? s : undefined);
  const speciesOf = (details: string) => details.split(',')[0].trim();

  /** "p1a: Nick" → the member it names (once it has switched in). */
  const mon = (ref: string | undefined): Mon | undefined => {
    const m = ref?.match(/^(p[12])[a-d]?: (.+)$/);
    return m ? byNick.get(`${m[1]}: ${m[2]}`) : undefined;
  };
  /** Pairs a switch-in with its Team Preview entry (first by resolved species, then by forme-hidden "Urshifu-*"). */
  const claim = (side: 'p1' | 'p2', nick: string, details: string) => {
    const key = `${side}: ${nick}`;
    if (byNick.has(key)) return;
    const name = speciesOf(details);
    const id = resolve(name);
    const team = sides[side];
    let m = id ? team.find((x) => x.speciesId === id && !x.brought) : undefined;
    if (!m) {
      const base = name.split('-')[0];
      m = team.find((x) => !x.brought && x.previewName.endsWith('-*') && x.previewName.startsWith(base));
      if (m && id) m.speciesId = id;
    }
    if (!m) return;
    m.brought = true;
    byNick.set(key, m);
  };
  const ofArg = (args: string[]) => args.find((a) => a.startsWith('[of] '))?.slice(5);
  const fromArg = (args: string[]) => args.find((a) => a.startsWith('[from]'));
  const setItem = (m: Mon | undefined, name: string) => {
    if (m && !m.itemTainted && !m.itemId && name) m.itemId = toID(name);
  };
  const setAbility = (m: Mon | undefined, name: string) => {
    if (m && !m.abilityTainted && !m.abilityId && name) m.abilityId = toID(name);
  };

  for (const line of log.split('\n')) {
    if (!line.startsWith('|')) continue;
    const [, cmd, ...args] = line.split('|');
    const from = fromArg(args);
    const of = mon(ofArg(args));
    switch (cmd) {
      case 'poke': {
        const side = sideOf(args[0]);
        const name = speciesOf(args[1] ?? '');
        if (!side || !name || sides[side].length >= 6) break;
        // "Urshifu-*": the forme is hidden until it switches in (claim fills it in; never sent out = dropped).
        const id = name.endsWith('-*') ? (resolve(name.slice(0, -2)) ?? '') : resolve(name);
        if (id === undefined) break;
        sides[side].push({ speciesId: id, previewName: name, brought: false, moves: [], itemTainted: false, abilityTainted: false, movesTainted: false });
        break;
      }
      case 'switch':
      case 'drag':
      case 'replace': {
        const ref = args[0]?.match(/^(p[12])[a-d]?: (.+)$/);
        const side = ref ? sideOf(ref[1]) : undefined;
        if (ref && side && args[1]) claim(side, ref[2], args[1]);
        break;
      }
      case 'detailschange': {
        // Mega Evolution: the Mega's ability isn't the set's.
        const m = mon(args[0]);
        if (m) m.abilityTainted = true;
        break;
      }
      case '-mega': {
        const m = mon(args[0]);
        if (m && args[2]) setItem(m, args[2]);
        if (m) m.abilityTainted = true;
        break;
      }
      case 'move': {
        const m = mon(args[0]);
        const name = args[1] ?? '';
        if (!m || m.movesTainted || !name || name === 'Struggle' || from) break;
        const id = toID(name);
        if (!m.moves.includes(id)) m.moves.push(id);
        break;
      }
      case '-transform': {
        // Transform / Imposter: from here on it uses the target's moves and ability.
        const m = mon(args[0]);
        const imposter = from?.match(/^\[from\] ability: (.+)$/)?.[1];
        if (imposter) setAbility(m, imposter);
        if (m) m.movesTainted = m.abilityTainted = true;
        break;
      }
      case '-item': {
        const m = mon(args[0]);
        if (from === '[from] ability: Frisk') setAbility(of, 'Frisk');
        if (!from || from === '[from] ability: Frisk') setItem(m, args[1] ?? '');
        else if (ITEM_SWAPS.test(from) && m) m.itemTainted = true;
        if (from && ITEM_SWAPS.test(from) && of) of.itemTainted = true;
        break;
      }
      case '-enditem':
        setItem(mon(args[0]), args[1] ?? '');
        break;
      case '-ability': {
        const m = mon(args[0]);
        const fromAbility = from?.match(/^\[from\] ability: (.+)$/)?.[1];
        if (from?.startsWith('[from] move:')) {
          if (m) m.abilityTainted = true;
        } else if (fromAbility && ABILITY_COPIERS.has(toID(fromAbility))) {
          setAbility(m, fromAbility);
          setAbility(of, args[1] ?? '');
          if (m) m.abilityTainted = true;
        } else {
          setAbility(m, args[1] ?? '');
        }
        break;
      }
      case '-activate':
      case '-start': {
        const what = args[1] ?? '';
        if (what === 'move: Skill Swap') {
          for (const m of [mon(args[0]), of]) if (m) m.abilityTainted = true;
        } else if (ABILITY_SPREADERS.has(toID(what.slice(9))) && of) {
          // Mummy and the like: "[of]" holds it; the subject loses its own (named after it, if shown).
          const m = mon(args[0]);
          setAbility(of, what.slice(9));
          if (args[2] && !args[2].startsWith('[')) setAbility(m, args[2]);
          if (m) m.abilityTainted = true;
        } else if (what.startsWith('ability: ')) {
          setAbility(mon(args[0]), what.slice(9));
        }
        break;
      }
      default:
        break;
    }
    // "[from] item: Life Orb" / "[from] ability: Rough Skin|[of] p2a: X" on any other line.
    if (from && cmd !== '-item' && cmd !== '-enditem' && cmd !== '-ability' && cmd !== 'move') {
      const holder = of ?? mon(args[0]);
      const item = from.match(/^\[from\] item: (.+)$/)?.[1];
      const ability = from.match(/^\[from\] ability: (.+)$/)?.[1];
      if (item) setItem(holder, item);
      if (ability) setAbility(holder, ability);
    }
  }
  if (sides.p1.length < 4 || sides.p2.length < 4) return null;
  const strip = (team: Mon[]): TeamRecord =>
    team.filter((m) => m.speciesId).map((m) => ({ speciesId: m.speciesId, brought: m.brought, itemId: m.itemId, abilityId: m.abilityId, moves: m.moves }));
  return [strip(sides.p1), strip(sides.p2)];
}

/** The highest pre-battle ladder rating in a log's rating lines ("p1's rating: 1234 → 1250"), else 0. */
export function ratingFromLog(log: string): number {
  let best = 0;
  for (const m of log.matchAll(/rating: (\d{3,4}) &rarr;/g)) best = Math.max(best, Number(m[1]));
  return best;
}

/** Rating cutoffs tried for replays, best first: the highest with enough games is used. */
const REPLAY_CUTOFFS = [1500, 1300, 1100, 0];

/** Picks the highest rating cutoff with at least `minGames` games (else everything). */
export function replayCutoff(games: Pick<ReplayGame, 'rating'>[], minGames: number): number {
  for (const c of REPLAY_CUTOFFS) if (games.filter((g) => g.rating >= c).length >= minGames) return c;
  return 0;
}

// ---------------------------------------------------------------------------
// Tournament team lists (Limitless VGC open team sheets)
// ---------------------------------------------------------------------------

/** One Pokémon of a Limitless VGC team list (field names vary a little, so several are accepted). */
const Member = z
  .object({
    id: z.string().nullish(),
    name: z.string().nullish(),
    species: z.string().nullish(),
    pokemon: z.string().nullish(),
    item: z.string().nullish(),
    ability: z.string().nullish(),
    attacks: z.array(z.string()).nullish(),
    moves: z.array(z.string()).nullish(),
  })
  .passthrough();
/** A Limitless VGC team list → a team record (either an array of Pokémon or `{ pokemon: [...] }`). */
export function teamFromDecklist(decklist: unknown, speciesId: SpeciesResolver): TeamRecord | null {
  const list = Array.isArray(decklist) ? decklist : decklist && typeof decklist === 'object' ? (decklist as { pokemon?: unknown }).pokemon : undefined;
  if (!Array.isArray(list)) return null;
  const team: TeamRecord = [];
  for (const raw of list) {
    const m = Member.safeParse(raw);
    if (!m.success) return null;
    const name = m.data.name ?? m.data.species ?? m.data.pokemon ?? m.data.id;
    const id = name ? speciesId(name) : undefined;
    if (!id) return null;
    team.push({
      speciesId: id,
      brought: true,
      itemId: m.data.item ? toID(m.data.item) || undefined : undefined,
      abilityId: m.data.ability ? toID(m.data.ability) || undefined : undefined,
      moves: (m.data.attacks ?? m.data.moves ?? []).map(toID).filter(Boolean),
    });
  }
  return team.length >= 4 ? team : null;
}


// ---------------------------------------------------------------------------
// Carry-over from the previous regulation
// ---------------------------------------------------------------------------

export interface Legality {
  species: (id: string) => boolean;
  item: (id: string) => boolean;
  move: (id: string) => boolean;
}

/**
 * The previous regulation's numbers for what the new one still allows (species, items, moves and
 * teammates that aren't are dropped; the percentages stay those of the old regulation's teams).
 */
export function carryOverSnapshot(prev: MetaSnapshot, regulationId: string, legal: Legality, today = new Date().toISOString().slice(0, 10)): MetaSnapshot | null {
  const entries = prev.entries
    .filter((e) => legal.species(e.speciesId))
    .map((e) => ({
      ...e,
      items: e.items.filter((i) => legal.item(i.id)),
      moves: e.moves.filter((m) => legal.move(m.id)),
      teammates: e.teammates.filter((t) => legal.species(t.id)),
    }));
  if (!entries.length) return null;
  const { kind: _kind, basedOn: _basedOn, ...rest } = prev.source;
  return MetaSnapshotSchema.parse({
    regulationId,
    updatedAt: today,
    // A carry-over of a carry-over still names the regulation the numbers come from.
    source: { ...rest, kind: 'carryover', basedOn: prev.source.kind === 'carryover' ? (prev.source.basedOn ?? prev.regulationId) : prev.regulationId },
    entries,
  });
}

// ---------------------------------------------------------------------------
// Spreads for sources that don't have them
// ---------------------------------------------------------------------------

type Stats = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };

/**
 * A plain Champions spread (66 Stat Points) from base stats: the better attacking stat maxed, then
 * Speed for fast Pokémon, else HP; minus Speed for very slow ones (Trick Room).
 */
export function estimateSpread(base: Stats): MetaEntry['spreads'][number] {
  const physical = base.atk >= base.spa;
  if (base.spe >= 90)
    return { nature: physical ? 'Jolly' : 'Timid', values: physical ? [2, 32, 0, 0, 0, 32] : [2, 0, 0, 32, 0, 32], pct: 0 };
  return {
    nature: base.spe <= 50 ? (physical ? 'Brave' : 'Quiet') : physical ? 'Adamant' : 'Modest',
    values: physical ? [32, 32, 0, 0, 2, 0] : [32, 0, 0, 32, 2, 0],
    pct: 0,
  };
}

/**
 * Gives every entry without spreads some: the same species' spreads from the first donor that has
 * them (Smogon snapshots of other regulations, nearest first), else an estimate from base stats.
 * Entries that already have spreads are left alone.
 */
export function fillSpreads(snap: MetaSnapshot, donors: MetaSnapshot[], baseStats: (speciesId: string) => Stats | undefined): MetaSnapshot {
  return {
    ...snap,
    entries: snap.entries.map((e) => {
      if (e.spreads.length) return e;
      for (const d of donors) {
        const spreads = d.entries.find((x) => x.speciesId === e.speciesId)?.spreads;
        if (spreads?.length) return { ...e, spreads: spreads.slice(0, 3), spreadFrom: d.regulationId };
      }
      const base = baseStats(e.speciesId);
      return base ? { ...e, spreads: [estimateSpread(base)], spreadFrom: 'estimate' } : e;
    }),
  };
}

// ---------------------------------------------------------------------------
// Pokémon Champions' in-game Battle Data (ranked season usage)
// ---------------------------------------------------------------------------

/** One daily snapshot of the in-game ranked usage, as the community mirror publishes it. */
const IngameShare = z.tuple([z.string(), z.number(), z.number()]).rest(z.unknown());
const IngameSnapshotSchema = z.object({
  season: z.string().min(1).max(16),
  /** dd_mm_yyyy */
  date: z.string().regex(/^\d{2}_\d{2}_\d{4}$/),
  format: z.string(),
  pokemon: z.record(
    z.string(),
    z.object({
      /** Usage rank, 1 = most used. */
      position: z.number().int().min(1),
      move: z.array(IngameShare).default([]),
      held_item: z.array(IngameShare).default([]),
      ability: z.array(IngameShare).default([]),
      /** [nature, %, raised stat, lowered stat, rank] */
      stat_alignment: z.array(z.tuple([z.string(), z.number()]).rest(z.unknown())).default([]),
      /** [%, HP, Atk, Def, SpA, SpD, Spe, rank] */
      stat_points: z.array(z.array(z.number()).length(8)).default([]),
      /** [species, rank] */
      teammate: z.array(z.tuple([z.string(), z.number()]).rest(z.unknown())).default([]),
    }),
  ),
});
export type IngameSnapshot = z.infer<typeof IngameSnapshotSchema>;

/** "03_10_2026" → "2026-10-03". */
export const ingameDate = (d: string) => `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}`;

export interface IngameOptions {
  regulationId: string;
  url: string;
  /** Showdown-style species name → this app's species id (Megas → base forme), undefined = unknown. */
  speciesId: SpeciesResolver;
  maxSpecies?: number;
}

/**
 * Normalises one in-game snapshot. Usage is a rank only (the game doesn't publish percentages for
 * species), so entries carry `usageRank` and no `usagePct`; teammates likewise carry ranks. The game
 * lists natures and Stat Point spreads separately, so each spread is paired with the species' most
 * common nature. A species listed twice (e.g. a Mega forme and its base) keeps its better rank.
 */
export function ingameToSnapshot(raw: unknown, o: IngameOptions): MetaSnapshot {
  const snap = IngameSnapshotSchema.parse(raw);
  const shares = (rows: z.infer<typeof IngameShare>[], n: number) =>
    rows
      .map(([name, pct]) => ({ id: toID(name), pct: round1(Math.min(100, Math.max(0, pct))) }))
      .filter((x) => isId(x.id) && x.pct >= 1)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, n);
  const byId = new Map<string, MetaEntry>();
  for (const [name, d] of Object.entries(snap.pokemon)) {
    const speciesId = o.speciesId(name);
    if (!speciesId) continue;
    const prev = byId.get(speciesId);
    if (prev && (prev.usageRank ?? Infinity) <= d.position) continue;
    const nature = d.stat_alignment.slice().sort((a, b) => b[1] - a[1])[0]?.[0];
    const teammates = d.teammate
      .map(([mate, rank]) => ({ id: o.speciesId(mate), rank }))
      .filter((t): t is { id: string; rank: number } => !!t.id && t.id !== speciesId && Number.isInteger(t.rank) && t.rank >= 1)
      .sort((a, b) => a.rank - b.rank)
      .filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
      .slice(0, 6);
    byId.set(speciesId, {
      speciesId,
      usageRank: d.position,
      abilities: shares(d.ability, 3),
      items: shares(d.held_item, 6),
      moves: shares(d.move, 8),
      teammates,
      spreads: nature
        ? d.stat_points
            .map(([pct, ...rest]) => ({ nature, values: rest.slice(0, 6) as [number, number, number, number, number, number], pct: round1(pct) }))
            .filter((x) => x.pct >= 1 && x.values.every((v) => Number.isInteger(v) && v >= 0 && v <= 32))
            .sort((a, b) => b.pct - a.pct)
            .slice(0, 5)
        : [],
    });
  }
  const entries = [...byId.values()].sort((a, b) => (a.usageRank ?? 0) - (b.usageRank ?? 0)).slice(0, o.maxSpecies ?? 60);
  return MetaSnapshotSchema.parse({
    regulationId: o.regulationId,
    updatedAt: ingameDate(snap.date),
    source: { kind: 'ingame', name: 'Pokémon Champions in-game Battle Data (ranked Doubles)', url: o.url, format: snap.format, season: snap.season },
    entries,
  });
}
