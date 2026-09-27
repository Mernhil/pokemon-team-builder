import manifestJson from '@/data/generated/regulations.json';
import { GAMES } from './games';
import { GEN_GAMES, GENERATIONS } from './generations';
import type { FormatRules, RegulationInfo, RegulationManifest, StatSystem } from './types';

export const REGULATION_MANIFEST = manifestJson as RegulationManifest;

const championsSP: StatSystem = { kind: 'champions-sp', totalCap: 66, perStatCap: 32 };
const legacyEV: StatSystem = { kind: 'modern-ev', totalCap: 510, perStatCap: 252, ivMax: 31 };
const gbStatExp: StatSystem = { kind: 'gb-statexp', statExpMax: 65535, dvMax: 15 };

/** Champions formats are generated from the regulation manifest, newest first. */
const championsFormats: FormatRules[] = [...REGULATION_MANIFEST.regulations]
  .filter((r) => r.game === 'champions')
  .sort((a, b) => b.start.localeCompare(a.start))
  .map((r) => ({
    id: `champions-vgc-${r.id.replace(/^champions-/, '')}`,
    name: `Pokémon Champions · VGC ${r.shortName}`,
    shortName: r.shortName,
    generation: 9,
    datasetId: 'champions',
    spriteSet: 'champions',
    regulationId: r.id,
    statSystem: championsSP,
    level: { fixed: 50, min: 50, max: 50, default: 50 },
    fixedIVs: 31,
    teamSize: 6,
    bring: 6,
    pick: 4,
    gameType: 'doubles',
    clauses: { species: true, item: true },
    gimmicks: { mega: true, tera: true }, // mirrors Showdown's Champions formats (no Terastal Clause)
    openTeamList: true,
    available: true,
  }));

/**
 * Main-series formats, one per generation: that generation's Pokédex, movepools, move data,
 * type chart and stat system. Level is free (default 100), like a cartridge team.
 */
const genFormats: FormatRules[] = GENERATIONS.map((g) => ({
  id: `gen${g.gen}`,
  name: `Gen ${g.gen} · ${GEN_GAMES[g.gen].replace(/ \(.*\)$/, '')}`,
  shortName: `Gen ${g.gen}`,
  generation: g.gen,
  datasetId: `gen${g.gen}`,
  spriteSet: `gen${g.gen}` as FormatRules['spriteSet'],
  regulationId: `gen${g.gen}`,
  statSystem: g.gen <= 2 ? gbStatExp : legacyEV,
  level: { min: 1, max: 100, default: 100 },
  teamSize: 6,
  gameType: 'singles',
  clauses: { species: false, item: false },
  gimmicks: { mega: g.gen === 6 || g.gen === 7, tera: g.gen === 9 },
  openTeamList: false,
  available: true,
}));

/** One format per remaining main-series game (Let's Go, BDSP, Legends): its roster, movepools and rules. */
const gameFormats: FormatRules[] = GAMES.map((g) => ({
  id: g.id,
  name: `${g.name} (Gen ${g.generation})`,
  shortName: g.shortName,
  generation: g.generation,
  datasetId: g.id,
  spriteSet: g.spriteSet,
  regulationId: g.id,
  statSystem: g.statSystem,
  level: { min: 1, max: 100, default: 100 },
  teamSize: 6,
  gameType: 'singles',
  clauses: { species: false, item: false },
  gimmicks: { mega: g.mega, tera: false },
  openTeamList: false,
  available: true,
  game: g.id,
}));

/** Ids of the placeholder formats earlier versions declared, mapped to their generation. */
const LEGACY_IDS: Record<string, string> = { 'gen9-vgc': 'gen9', 'gen4-playthrough': 'gen4', 'gen1-playthrough': 'gen1' };

export const FORMATS: FormatRules[] = [...championsFormats, ...genFormats, ...gameFormats];

/** The regulation live right now (latest one whose start date has passed). */
export function currentRegulation(now = new Date()): RegulationInfo | undefined {
  const t = now.toISOString();
  return [...REGULATION_MANIFEST.regulations]
    .filter((r) => r.start <= t)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
}

export function formatForRegulation(regId?: string): FormatRules | undefined {
  return championsFormats.find((f) => f.regulationId === regId);
}

export const DEFAULT_FORMAT_ID = (formatForRegulation(currentRegulation()?.id) ?? FORMATS[0]).id;

export function getFormat(id: string): FormatRules {
  const key = LEGACY_IDS[id] ?? id;
  return FORMATS.find((f) => f.id === key) ?? FORMATS.find((f) => f.id === DEFAULT_FORMAT_ID)!;
}

export function regulationInfo(regId?: string): RegulationInfo | undefined {
  return REGULATION_MANIFEST.regulations.find((r) => r.id === regId);
}
