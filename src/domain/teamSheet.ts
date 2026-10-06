import type { Dex } from '@/data/dex';
import { exportChampionsText, exportTeamShowdown, formatReplicaCode } from './codecs';
import { calcStats } from './stats';
import type { FormatRules, PokemonSet, Team } from './types';

/** Final Speed of each member (a Mega's as its own row), fastest first. Shared by the Team tab and the sheet. */
export function speedOrder(team: Team, dex: Dex, format: FormatRules) {
  const rows = team.slots.flatMap((set) => {
    const sp = set && dex.species(set.speciesId);
    if (!set || !sp) return [];
    const nature = dex.nature(set.nature);
    const mega = format.capabilities.mega ? dex.megaFor(set.speciesId, set.itemId) : undefined;
    const out = [{ id: sp.id, name: sp.name, types: sp.types, speed: calcStats(sp.baseStats, set, format, nature).spe, mega: false }];
    if (mega) out.push({ id: mega.id, name: mega.name, types: mega.types, speed: calcStats(mega.baseStats, set, format, nature).spe, mega: true });
    return out;
  });
  return rows.sort((a, b) => b.speed - a.speed || a.name.localeCompare(b.name));
}

/** "Lead Incineroar + Garchomp" for a matchup note, from the leads that are still on the team. */
function matchupLeads(team: Team, dex: Dex, leads: readonly string[] | undefined): string[] {
  return (leads ?? []).flatMap((uid) => {
    const s = team.slots.find((x): x is PokemonSet => !!x && x.uid === uid);
    return s ? [s.nickname || dex.species(s.speciesId)?.name || s.speciesId] : [];
  });
}

/**
 * The whole team as plain text for a printed sheet or a chat: name and format, replica code, team
 * notes, each Pokémon (with its own notes), Speed order, plans against kinds of opponents and the
 * Showdown export at the end.
 */
export function teamSheetText(team: Team, dex: Dex, format: FormatRules): string {
  const out: string[] = [];
  if (format.datasetId === 'champions') out.push(exportChampionsText(team, dex, format));
  else out.push(`${team.name} — ${format.name}`, team.replicaCode ? `Replica Team: ${formatReplicaCode(team.replicaCode)}` : '');
  if (team.notes?.trim()) out.push('', 'Team notes', team.notes.trim());
  const noted = team.slots.flatMap((s) => (s?.notes ? [s] : []));
  if (noted.length) {
    out.push('', 'Pokémon notes');
    for (const s of noted) out.push(`${s.nickname || dex.species(s.speciesId)?.name || s.speciesId}: ${s.notes}`);
  }
  const speeds = speedOrder(team, dex, format);
  if (speeds.length) out.push('', 'Speed order', speeds.map((r) => `${r.name} ${r.speed}`).join(' > '));
  if (team.matchupNotes?.length) {
    out.push('', 'Matchup notes');
    for (const n of team.matchupNotes) {
      const leads = matchupLeads(team, dex, n.leads);
      out.push(`${n.title}${leads.length ? ` (lead ${leads.join(' + ')})` : ''}${n.text ? `: ${n.text}` : ''}`);
    }
  }
  out.push('', 'Showdown export', exportTeamShowdown(team, dex, format));
  return out.filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();
}
