import { toID, type Dex } from '@/data/dex';
import type { Benchmark } from './benchmarks';
import { formatMechanics } from './games';
import { calcStats, evToStatExp, statExpToEV } from './stats';
import { sanitizeTeam } from './sanitize';
import { getFormat } from './formats';
import { stripUnsupported } from './capabilities';
import { createSet, createTeam, emptySlots, enforceCapabilities } from './team';
import {
  STAT_IDS,
  STAT_LABELS,
  emptyStats,
  type FormatRules,
  type PokemonSet,
  type StatId,
  type StatTable,
  type Team,
  type TeamSlots,
  type TeraType,
} from './types';

// ===========================================================================
// Showdown export / import
//   In Showdown's Champions mod, the "EVs:" line carries Stat Points directly,
//   so Champions teams round-trip with Showdown unchanged.
//   Gen 1–2: Showdown writes Stat Exp as EVs (⌈√StatExp⌉, 252 = max, the default) and
//   DVs as IVs (IV = 2 × DV, 30 = max, the default).
//   Let's Go: Showdown's "EVs:" line holds AVs and "Happiness:" the friendship.
//   Legends: Arceus has no Showdown format; its Effort Levels get their own line.
// ===========================================================================

const mapStats = (t: StatTable, f: (v: number) => number): StatTable =>
  Object.fromEntries(STAT_IDS.map((s) => [s, f(t[s])])) as StatTable;

const spreadLine = (t: StatTable, skipValue: number) =>
  STAT_IDS.filter((s) => t[s] !== skipValue)
    .map((s) => `${t[s]} ${STAT_LABELS[s]}`)
    .join(' / ');

export function exportSetShowdown(set: PokemonSet, dex: Dex, format: FormatRules): string {
  const sp = dex.species(set.speciesId);
  const name = sp?.name ?? set.speciesId;
  const head = set.nickname && set.nickname !== name ? `${set.nickname} (${name})` : name;
  const lines: string[] = [];
  const gender = set.gender ? ` (${set.gender})` : '';
  const item = dex.item(set.itemId);
  lines.push(`${head}${gender}${item ? ` @ ${item.name}` : ''}`);
  const mech = formatMechanics(format);
  const ab = mech.abilities ? dex.ability(set.abilityId) : undefined;
  if (ab) lines.push(`Ability: ${ab.name}`);
  if (!format.level.fixed && set.level !== 100) lines.push(`Level: ${set.level}`);
  if (set.shiny) lines.push('Shiny: Yes');
  if (format.capabilities.tera && set.teraType) lines.push(`Tera Type: ${set.teraType}`);

  const sys = format.statSystem;
  if (sys.kind === 'gb-statexp') {
    const ev = spreadLine(mapStats(set.evs, statExpToEV), 252);
    if (ev) lines.push(`EVs: ${ev}`);
    const iv = spreadLine(mapStats({ ...set.ivs, hp: 15 }, (d) => Math.min(15, d) * 2), 30);
    if (iv) lines.push(`IVs: ${iv}`);
  } else if (sys.kind === 'pla-effort') {
    const el = spreadLine(set.evs, 0);
    if (el) lines.push(`Effort Levels: ${el}`);
    if (set.nature && mech.natures) lines.push(`${set.nature} Nature`);
  } else {
    if (sys.kind === 'lgpe-av' && (set.friendship ?? 255) !== 255) lines.push(`Happiness: ${set.friendship ?? 255}`);
    const spread = sys.kind === 'champions-sp' ? set.sp : set.evs;
    const ev = spreadLine(spread, 0);
    if (ev) lines.push(`EVs: ${ev}`);
    if (set.nature && mech.natures) lines.push(`${set.nature} Nature`);
    if (!format.fixedIVs) {
      const iv = spreadLine(set.ivs, 31);
      if (iv) lines.push(`IVs: ${iv}`);
    }
  }
  for (const m of set.moves) if (m) lines.push(`- ${dex.move(m)?.name ?? m}`);
  return lines.join('\n');
}

export function exportTeamShowdown(team: Team, dex: Dex, format: FormatRules): string {
  return team.slots
    .filter((s): s is PokemonSet => !!s)
    .map((s) => exportSetShowdown(s, dex, format))
    .join('\n\n');
}

const STAT_ALIASES: Record<string, StatId> = {
  hp: 'hp', atk: 'atk', attack: 'atk', def: 'def', defense: 'def',
  spa: 'spa', spatk: 'spa', specialattack: 'spa', spc: 'spa',
  spd: 'spd', spdef: 'spd', specialdefense: 'spd',
  spe: 'spe', speed: 'spe',
};

function parseSpread(text: string, into: StatTable): StatTable {
  const out = { ...into };
  for (const part of text.split('/')) {
    const m = part.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) continue;
    const stat = STAT_ALIASES[toID(m[2])];
    if (stat) out[stat] = parseInt(m[1], 10);
  }
  return out;
}

export interface ImportResult {
  team: Team;
  warnings: string[];
}

/** Parse Showdown export text (one or more sets separated by blank lines). */
export function importShowdown(text: string, dex: Dex, format: FormatRules, name = 'Imported Team'): ImportResult {
  const warnings: string[] = [];
  const blocks = text
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b && !b.startsWith('==='));
  const slots: TeamSlots = emptySlots();
  let teraIgnored = false;

  blocks.slice(0, format.teamSize).forEach((block, idx) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const first = lines.shift()!;
    const [left, itemName] = first.split(/\s+@\s+/);
    let head = left.trim();
    let gender: 'M' | 'F' | undefined;
    const g = head.match(/\s\((M|F)\)$/);
    if (g) {
      gender = g[1] as 'M' | 'F';
      head = head.slice(0, g.index).trim();
    }
    let nickname: string | undefined;
    let speciesName = head;
    const nick = head.match(/^(.*)\s\(([^()]+)\)$/);
    if (nick) {
      nickname = nick[1];
      speciesName = nick[2];
    }
    let species = dex.species(speciesName);
    // A Mega forme in the header means "base species holding its stone".
    if (species?.isMega && species.battleOnly) species = dex.species(species.battleOnly);
    if (!species) {
      warnings.push(`Slot ${idx + 1}: unknown species "${speciesName}" — skipped.`);
      return;
    }
    const set = createSet(dex, species.id, format);
    set.nickname = nickname;
    set.gender = gender;
    if (itemName) {
      const it = dex.item(itemName);
      if (it) set.itemId = it.id;
      else warnings.push(`${species.name}: unknown item "${itemName}".`);
    }
    const moves: string[] = [];
    for (const line of lines) {
      if (line.startsWith('-')) {
        const mv = dex.move(line.slice(1).split('/')[0].trim());
        if (mv) moves.push(mv.id);
        else warnings.push(`${species.name}: unknown move "${line.slice(1).trim()}".`);
        continue;
      }
      const [k, ...rest] = line.split(':');
      const v = rest.join(':').trim();
      switch (toID(k)) {
        case 'ability': {
          const a = dex.ability(v);
          if (a) set.abilityId = a.id;
          else warnings.push(`${species.name}: unknown ability "${v}".`);
          break;
        }
        case 'level':
          set.level = format.level.fixed ?? Math.max(1, Math.min(100, parseInt(v, 10) || 100));
          break;
        case 'shiny':
          set.shiny = /yes/i.test(v);
          break;
        case 'teratype': {
          // Only Scarlet/Violet has Terastallization; other games' pastes may still carry the line.
          if (!format.capabilities.tera) {
            teraIgnored = true;
            break;
          }
          const t = [...dex.types, 'Stellar'].find((x) => toID(x) === toID(v));
          if (t) set.teraType = t as TeraType;
          break;
        }
        case 'happiness':
        case 'friendship':
          if (format.statSystem.kind === 'lgpe-av') set.friendship = Math.max(0, Math.min(255, parseInt(v, 10) || 0));
          break;
        case 'effortlevels':
        case 'avs':
        case 'evs':
        case 'sp':
        case 'statpoints': {
          if (format.statSystem.kind === 'gb-statexp') {
            const parsed = mapStats(parseSpread(v, emptyStats(252)), evToStatExp);
            set.evs = { ...parsed, spd: parsed.spa };
            break;
          }
          const parsed = parseSpread(v, emptyStats(0));
          if (format.statSystem.kind === 'champions-sp') set.sp = parsed;
          else set.evs = parsed;
          break;
        }
        case 'ivs':
          if (format.statSystem.kind === 'gb-statexp') {
            const dvs = mapStats(parseSpread(v, emptyStats(30)), (iv) => Math.min(15, Math.floor(iv / 2)));
            set.ivs = { ...dvs, spd: dvs.spa };
          } else if (!format.fixedIVs) set.ivs = parseSpread(v, set.ivs);
          break;
        default: {
          const nat = line.match(/^(\w+)\s+Nature$/i);
          if (nat && dex.nature(nat[1])) set.nature = dex.nature(nat[1])!.name;
        }
      }
    }
    set.moves = [moves[0] ?? '', moves[1] ?? '', moves[2] ?? '', moves[3] ?? ''];
    slots[idx] = set;
  });

  if (blocks.length > format.teamSize) warnings.push(`Only the first ${format.teamSize} sets were imported.`);
  if (teraIgnored) warnings.push(`Tera Types were ignored: ${format.shortName} has no Terastallization.`);
  const team = createTeam(format, name);
  team.slots = slots;
  return { team, warnings };
}

// ===========================================================================
// Champions Open Team List text (human-readable, for sharing / printing)
// ===========================================================================

export function exportChampionsText(team: Team, dex: Dex, format: FormatRules): string {
  const out: string[] = [`${team.name} — ${format.name}`];
  if (team.replicaCode) out.push(`Replica Team: ${formatReplicaCode(team.replicaCode)}`);
  out.push('');
  team.slots.forEach((s, i) => {
    if (!s) return;
    const sp = dex.species(s.speciesId);
    const mega = format.capabilities.mega ? dex.megaFor(s.speciesId, s.itemId) : undefined;
    const nat = dex.nature(s.nature);
    const stats = sp ? calcStats(sp.baseStats, s, format, nat) : undefined;
    const align = nat?.plus && nat.plus !== nat.minus ? ` (+${STAT_LABELS[nat.plus]} −${STAT_LABELS[nat.minus!]})` : '';
    out.push(`${i + 1}. ${sp?.name ?? s.speciesId}${s.itemId ? ` @ ${dex.item(s.itemId)?.name}` : ''}${mega ? `  → ${mega.name}` : ''}`);
    out.push(`   Ability: ${dex.ability(s.abilityId)?.name ?? '—'} · Stat Alignment: ${s.nature}${align}`);
    if (format.capabilities.tera) out.push(`   Tera Type: ${s.teraType ?? '—'}`);
    out.push(`   SP: ${spreadLine(s.sp, 0) || '—'}`);
    if (stats) out.push(`   Stats: ${STAT_IDS.map((k) => `${stats[k]} ${STAT_LABELS[k]}`).join(' / ')}`);
    out.push(`   Moves: ${s.moves.filter(Boolean).map((m) => dex.move(m)?.name ?? m).join(' / ') || '—'}`);
    out.push('');
  });
  return out.join('\n').trimEnd();
}

// ===========================================================================
// Replica Team codes
//   Codes are issued by the game's servers and resolve to a team stored there, so the
//   builder can't mint one. We validate, normalise and attach them to a team.
// ===========================================================================

const REPLICA_RE = /^[A-Z0-9]{10}$/;

export function normalizeReplicaCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return REPLICA_RE.test(code) ? code : null;
}
export const formatReplicaCode = (code: string) => `${code.slice(0, 5)} ${code.slice(5)}`;

// ===========================================================================
// Local share string (portable, self-contained — works offline between builders)
// ===========================================================================

type CompactSet = [string, string?, string?, string?, string?, string[]?, number[]?, number[]?, number[]?, number?, string?, Benchmark[]?];

function toCompact(s: PokemonSet): CompactSet {
  return [
    s.speciesId,
    s.abilityId,
    s.itemId,
    s.nature,
    s.teraType,
    s.moves,
    STAT_IDS.map((k) => s.sp[k]),
    STAT_IDS.map((k) => s.evs[k]),
    STAT_IDS.map((k) => s.ivs[k]),
    s.level,
    s.notes,
    s.benchmarks,
  ];
}

const b64url = {
  enc: (str: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(str)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, ''),
  dec: (b: string) => {
    const bin = atob(b.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  },
};

export function encodeShareString(team: Team): string {
  const caps = getFormat(team.formatId).capabilities;
  // Notes and benchmarks travel with the sets; a matchup note's leads are slot numbers here (set ids are new on the other side).
  const slotOf = new Map(team.slots.flatMap((s, i) => (s ? [[s.uid, i] as const] : [])));
  const matchups = team.matchupNotes?.map((m) => ({ t: m.title, x: m.text, ...(m.leads?.length ? { l: m.leads.flatMap((u) => (slotOf.has(u) ? [slotOf.get(u)!] : [])) } : {}) }));
  const payload = { v: 1, n: team.name, f: team.formatId, s: team.slots.map((s) => (s ? toCompact(stripUnsupported(s, caps)) : 0)), ...(team.notes ? { tn: team.notes } : {}), ...(matchups?.length ? { mn: matchups } : {}) };
  return 'PTB1.' + b64url.enc(JSON.stringify(payload));
}

export function decodeShareString(str: string, dex: Dex, format: FormatRules): Team {
  const raw = str.trim().replace(/^PTB1\./, '');
  const p = JSON.parse(b64url.dec(raw)) as { n: string; f: string; s: (CompactSet | 0)[]; tn?: string; mn?: { t: string; x: string; l?: number[] }[] } | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.s)) throw new Error('Not a valid share code.');
  const team = createTeam(format, p.n);
  team.formatId = p.f;
  const toTable = (a?: number[], d = 0): StatTable =>
    Object.fromEntries(STAT_IDS.map((k, i) => [k, a?.[i] ?? d])) as StatTable;
  team.slots = p.s.slice(0, 6).map((c) => {
    if (!Array.isArray(c)) return null;
    const set = createSet(dex, c[0], format);
    set.abilityId = c[1] ?? set.abilityId;
    set.itemId = c[2];
    set.nature = c[3] ?? set.nature;
    set.teraType = c[4] as TeraType | undefined;
    const m = c[5] ?? [];
    set.moves = [m[0] ?? '', m[1] ?? '', m[2] ?? '', m[3] ?? ''];
    set.sp = toTable(c[6]);
    set.evs = toTable(c[7]);
    set.ivs = toTable(c[8], 31);
    set.level = c[9] ?? set.level;
    // Written by a newer version; the sanitiser below validates both.
    set.notes = typeof c[10] === 'string' ? c[10] : undefined;
    set.benchmarks = Array.isArray(c[11]) ? c[11] : undefined;
    return set;
  }) as TeamSlots;
  team.notes = typeof p.tn === 'string' ? p.tn : undefined;
  const uids = team.slots;
  team.matchupNotes = Array.isArray(p.mn)
    ? p.mn.map((m, i) => ({ id: `m${i}`, title: String(m.t ?? ''), text: String(m.x ?? ''), leads: (m.l ?? []).flatMap((slot) => (uids[slot] ? [uids[slot]!.uid] : [])) }))
    : undefined;
  while (team.slots.length < 6) (team.slots as (PokemonSet | null)[]).push(null);
  // Codes from older versions carry a Tera Type for every game; keep it only where the game has Tera.
  return enforceCapabilities(sanitizeTeam(team)!);
}

// ===========================================================================
// JSON backup / restore
// ===========================================================================

export interface Backup {
  app: 'pokemon-team-builder';
  version: 1;
  exportedAt: string;
  teams: Team[];
}

export const exportBackup = (teams: Team[]): string =>
  JSON.stringify({ app: 'pokemon-team-builder', version: 1, exportedAt: new Date().toISOString(), teams } satisfies Backup, null, 2);

/** More than any real collection; restored teams are persisted, and localStorage holds only ~5 MB. */
export const MAX_BACKUP_TEAMS = 1000;

export function parseBackup(json: string): Team[] {
  const data = JSON.parse(json) as Partial<Backup> | null;
  if (!data || data.app !== 'pokemon-team-builder' || !Array.isArray(data.teams)) throw new Error('Not a Team Builder backup file.');
  if (data.teams.length > MAX_BACKUP_TEAMS) throw new Error(`That backup holds ${data.teams.length} teams; at most ${MAX_BACKUP_TEAMS} can be restored at once.`);
  return data.teams
    .map(sanitizeTeam)
    .filter((t): t is Team => !!t)
    .map(enforceCapabilities);
}
