/**
 * Choices a person makes inside an analysis screen (how many threats, the field, the Meta tab and
 * period) that should still be there next time. Pure: the store (src/store/viewStore.ts) persists
 * them and runs everything through `sanitizeView`.
 */
import type { FieldConditions } from './battle/conditions.ts';
import { TREND_PERIODS, type TrendPeriod } from './metaHistory.ts';
import { THREAT_COUNTS, type ThreatField } from './threats.ts';

export const META_TABS = ['usage', 'trends', 'teams'] as const;
export type MetaTab = (typeof META_TABS)[number];

export interface ViewPrefs {
  threatCount: number;
  threatField: ThreatField;
  metaTab: MetaTab;
  metaPeriod: TrendPeriod;
}

export const DEFAULT_VIEW: ViewPrefs = {
  threatCount: 20,
  threatField: { gameType: 'Doubles', weather: '', terrain: '', trickRoom: false, gravity: false },
  metaTab: 'usage',
  metaPeriod: 7,
};

const WEATHER = ['', 'Sun', 'Rain', 'Sand', 'Snow'];
const TERRAIN = ['', 'Electric', 'Grassy', 'Psychic', 'Misty'];

/** A saved value of any shape as valid preferences: anything unknown falls back to the default. */
export function sanitizeView(raw: unknown): ViewPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const f = r.threatField && typeof r.threatField === 'object' ? (r.threatField as Record<string, unknown>) : {};
  const d = DEFAULT_VIEW;
  return {
    threatCount: (THREAT_COUNTS as readonly unknown[]).includes(r.threatCount) ? (r.threatCount as number) : d.threatCount,
    threatField: {
      gameType: f.gameType === 'Singles' ? 'Singles' : 'Doubles',
      weather: WEATHER.includes(f.weather as string) ? (f.weather as FieldConditions['weather']) : '',
      terrain: TERRAIN.includes(f.terrain as string) ? (f.terrain as FieldConditions['terrain']) : '',
      trickRoom: f.trickRoom === true,
      gravity: f.gravity === true,
      ...(f.myTailwind === true ? { myTailwind: true } : {}),
      ...(f.theirTailwind === true ? { theirTailwind: true } : {}),
      ...(f.maxHits === true ? { maxHits: true } : {}),
    },
    metaTab: (META_TABS as readonly unknown[]).includes(r.metaTab) ? (r.metaTab as MetaTab) : d.metaTab,
    metaPeriod: (TREND_PERIODS as readonly unknown[]).includes(r.metaPeriod) ? (r.metaPeriod as TrendPeriod) : d.metaPeriod,
  };
}
