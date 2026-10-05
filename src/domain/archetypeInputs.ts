/**
 * Feeds the archetype detector from the app's data: a saved team's Pokémon, a logged team's species,
 * the most-used set of a species from a meta snapshot, and a match's two archetype fields. Pure.
 */
import type { Dex } from '@/data/dex';
import { detectArchetypes, type ArchetypeMon, type ArchetypeTag, type MetaLookup } from './archetypes';
import { formatForRegulation } from './formats';
import type { LoggedMon, Match } from './matches';
import type { MetaSnapshot } from './meta';
import { metaSet } from './metaSets';
import type { FormatRules, Team } from './types';

/** A saved team's filled slots, with everything its sets say. */
export const monsOfTeam = (team: Team): ArchetypeMon[] =>
  team.slots.flatMap((s) => (s ? [{ speciesId: s.speciesId, abilityId: s.abilityId, itemId: s.itemId, moves: s.moves.filter(Boolean), nature: s.nature }] : []));

/** A logged team: species, and whatever was seen of each. */
export const monsOfLogged = (list: readonly LoggedMon[]): ArchetypeMon[] =>
  list.filter((m) => m.speciesId).map((m) => ({ speciesId: m.speciesId, abilityId: m.abilityId, itemId: m.itemId, moves: m.moves }));

/** The most-used set of each species in a snapshot, for Pokémon that are only a species. Undefined without a snapshot. */
export function metaSetLookup(snapshot: MetaSnapshot | undefined, dex: Dex, format: FormatRules): MetaLookup | undefined {
  if (!snapshot) return undefined;
  const cache = new Map<string, ReturnType<MetaLookup>>();
  return (speciesId) => {
    if (!cache.has(speciesId)) {
      const entry = snapshot.entries.find((e) => e.speciesId === speciesId);
      const m = entry && metaSet(entry, dex, format);
      cache.set(speciesId, m ? { abilityId: m.set.abilityId, itemId: m.set.itemId, moves: m.set.moves, nature: m.set.nature } : undefined);
    }
    return cache.get(speciesId);
  };
}

export interface MatchSuggestion {
  myArchetype?: ArchetypeTag;
  opponentArchetype?: ArchetypeTag;
}

/**
 * The tags a match could get for the archetype fields that are still empty. A value the player set is
 * never replaced (and never suggested over), so a field with text gets no suggestion.
 */
export function suggestForMatch(match: Match, teams: Record<string, Team>, dex: Dex, format: FormatRules, snapshot?: MetaSnapshot): MatchSuggestion {
  const f = formatForRegulation(match.regulationId) ?? format;
  const metaFor = metaSetLookup(snapshot, dex, f);
  const out: MatchSuggestion = {};
  if (!match.myArchetype) {
    const saved = match.myTeamId ? teams[match.myTeamId] : undefined;
    const mons = saved ? monsOfTeam(saved) : monsOfLogged(match.myTeam ?? []);
    const tag = detectArchetypes(mons, dex, f, metaFor).tags[0];
    if (tag) out.myArchetype = tag;
  }
  if (!match.opponentArchetype) {
    const tag = detectArchetypes(monsOfLogged(match.opponentTeam), dex, f, metaFor).tags[0];
    if (tag) out.opponentArchetype = tag;
  }
  return out;
}

export interface UntaggedMatch {
  match: Match;
  suggestion: MatchSuggestion;
}

/** The matches with an empty archetype field a tag can be suggested for, in the order given. */
export function untaggedMatches(matches: readonly Match[], teams: Record<string, Team>, dex: Dex, format: FormatRules, snapshotFor: (regulationId: string | undefined) => MetaSnapshot | undefined): UntaggedMatch[] {
  const out: UntaggedMatch[] = [];
  for (const match of matches) {
    if (match.myArchetype && match.opponentArchetype) continue;
    const suggestion = suggestForMatch(match, teams, dex, format, snapshotFor(match.regulationId));
    if (suggestion.myArchetype || suggestion.opponentArchetype) out.push({ match, suggestion });
  }
  return out;
}

/** The patch that applies a suggestion: only the fields it has a tag for, never one already filled. */
export const suggestionPatch = (match: Match, s: MatchSuggestion): Partial<Pick<Match, 'myArchetype' | 'opponentArchetype'>> => ({
  ...(s.myArchetype && !match.myArchetype ? { myArchetype: s.myArchetype.tag } : {}),
  ...(s.opponentArchetype && !match.opponentArchetype ? { opponentArchetype: s.opponentArchetype.tag } : {}),
});
