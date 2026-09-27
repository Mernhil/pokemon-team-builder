import manifestJson from '@/data/generated/regulations.json';
import type { FormatRules, RegulationInfo, RegulationManifest, StatSystem } from './types';

export const REGULATION_MANIFEST = manifestJson as RegulationManifest;

const championsSP: StatSystem = { kind: 'champions-sp', totalCap: 66, perStatCap: 32 };
const legacyEV: StatSystem = { kind: 'modern-ev', totalCap: 510, perStatCap: 252, ivMax: 31 };

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
 * Phase 2 formats: declared so the type system, sprite sets and UI already account for them,
 * flagged unavailable until a dataset exists.
 */
const legacyFormats: FormatRules[] = [
  {
    id: 'gen9-vgc',
    name: 'Scarlet/Violet · VGC (EV/IV)',
    shortName: 'Gen 9 VGC',
    generation: 9,
    datasetId: 'gen9',
    spriteSet: 'gen9',
    statSystem: legacyEV,
    level: { fixed: 50, min: 50, max: 50, default: 50 },
    teamSize: 6,
    bring: 6,
    pick: 4,
    gameType: 'doubles',
    clauses: { species: true, item: true },
    gimmicks: { mega: false, tera: true },
    openTeamList: false,
    available: false,
  },
  {
    id: 'gen4-playthrough',
    name: 'Gen 4 · Playthrough / Nuzlocke',
    shortName: 'Gen 4 Run',
    generation: 4,
    datasetId: 'gen4',
    spriteSet: 'gen4',
    statSystem: legacyEV,
    level: { min: 1, max: 100, default: 50 },
    teamSize: 6,
    gameType: 'singles',
    clauses: { species: false, item: false },
    gimmicks: { mega: false, tera: false },
    openTeamList: false,
    available: false,
  },
  {
    id: 'gen1-playthrough',
    name: 'Gen 1 · Playthrough (DV / Stat Exp)',
    shortName: 'Gen 1 Run',
    generation: 1,
    datasetId: 'gen1',
    spriteSet: 'gen1',
    statSystem: { kind: 'gb-statexp', statExpMax: 65535, dvMax: 15 },
    level: { min: 1, max: 100, default: 50 },
    teamSize: 6,
    gameType: 'singles',
    clauses: { species: false, item: false },
    gimmicks: { mega: false, tera: false },
    openTeamList: false,
    available: false,
  },
];

export const FORMATS: FormatRules[] = [...championsFormats, ...legacyFormats];

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
  return FORMATS.find((f) => f.id === id) ?? FORMATS.find((f) => f.id === DEFAULT_FORMAT_ID)!;
}

export function regulationInfo(regId?: string): RegulationInfo | undefined {
  return REGULATION_MANIFEST.regulations.find((r) => r.id === regId);
}
