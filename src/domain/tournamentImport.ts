/**
 * Using a tournament team in the app: a Team of saved sets from a tournament team (see
 * tournamentTeams.ts). Team sheets carry no spreads, so each set gets the species' most common spread
 * from the meta (or an estimate from base stats) and says so in its notes. Pure.
 */
import type { Dex } from '@/data/dex';
import type { MetaSnapshot } from './meta';
import { estimateSpread } from './metaSources';
import { createSet, createTeam } from './team';
import { TOURNAMENT_CATEGORY, placingLabel, type TournamentEvent, type TournamentTeam } from './tournamentTeams';
import type { FormatRules, PokemonSet, Team } from './types';

export interface ImportedTournamentTeam {
  team: Team;
  /** Species whose spread is an estimate (every one: team sheets carry none). */
  estimated: string[];
  /** Things the format doesn't allow that were left out, in plain language. */
  dropped: string[];
}

/**
 * A team of the app from a tournament team: the sheet's item, ability and moves, plus the species'
 * most common spread and nature from the meta snapshot (or an estimate from base stats), with
 * "Spread estimated" in each set's notes. Anything the regulation doesn't allow is dropped and listed.
 */
export function tournamentTeamToTeam(
  t: TournamentTeam,
  event: TournamentEvent,
  dex: Dex,
  format: FormatRules,
  snapshot?: MetaSnapshot,
  regulationName = format.shortName,
): ImportedTournamentTeam {
  const team = createTeam(format, `${event.name} · ${placingLabel(t.p)}`);
  team.category = TOURNAMENT_CATEGORY;
  team.notes = `Tournament team: ${placingLabel(t.p)} at ${event.name} (${event.date}, ${event.players} players), played by ${t.n}.\nSource: Limitless ${event.url}\nItems, abilities and moves are from the open team sheet; spreads are estimated.`.slice(0, 600);
  const reg = format.regulationId;
  const estimated: string[] = [];
  const dropped: string[] = [];
  const slots: (PokemonSet | null)[] = [];
  for (const [speciesId, itemId, abilityId, moveIds] of t.m) {
    const sp = dex.species(speciesId);
    if (!sp || (reg && !sp.legalIn.includes(reg))) {
      dropped.push(`${sp?.name ?? speciesId} isn't legal in ${regulationName}.`);
      continue;
    }
    const base = createSet(dex, sp.id, format);
    const item = dex.item(itemId);
    const itemOk = !!item && (!reg || item.legalIn.includes(reg)) && (!item.megaStone || !!dex.megaFor(sp.id, item.id));
    if (itemId && !itemOk) dropped.push(`${sp.name}: item ${item?.name ?? itemId} isn't legal.`);
    const ab = dex.ability(abilityId);
    const abilityOk = !!ab && Object.values(sp.abilities).some((a) => dex.ability(a)?.id === ab.id);
    const moves: string[] = [];
    for (const m of moveIds) {
      const mv = dex.move(m);
      if (mv && dex.canLearn(sp.id, mv.id) && (!reg || mv.legalIn.includes(reg))) moves.push(mv.id);
      else dropped.push(`${sp.name}: move ${mv?.name ?? m} isn't legal.`);
    }
    const metaSpread = snapshot?.entries.find((e) => e.speciesId === sp.id)?.spreads[0];
    const spread = metaSpread ?? estimateSpread(sp.baseStats);
    const [hp, atk, def, spa, spd, spe] = spread.values;
    estimated.push(sp.id);
    slots.push({
      ...base,
      abilityId: abilityOk ? ab!.id : base.abilityId,
      itemId: itemOk ? item!.id : undefined,
      nature: dex.nature(spread.nature)?.name ?? base.nature,
      sp: { hp, atk, def, spa, spd, spe },
      moves: [...moves, '', '', '', ''].slice(0, 4) as PokemonSet['moves'],
      notes: (metaSpread ? `Spread estimated: the most common ${regulationName} spread for ${sp.name}.` : `Spread estimated from base stats.`) + ' The team sheet shows none.',
    });
  }
  team.slots = [...slots, null, null, null, null, null, null].slice(0, 6) as Team['slots'];
  return { team, estimated, dropped };
}
