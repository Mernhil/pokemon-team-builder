/**
 * Where the app can be: the views and, inside Analyse, its tabs; and how they map to the URL hash.
 * Before 0.24 Speed tiers, the Threat report, the OHKO reports, Team overview and Compare were views
 * of their own; their old hashes (#speed, #threats, #ohko, #ohkod, #showcase, #compare) still work and
 * land on the matching Analyse tab. Pure: no React, no store.
 */
export const VIEWS = ['builder', 'calc', 'analyse', 'dex', 'atlas', 'matches', 'gameday', 'meta', 'reverse', 'regdiff'] as const;
export type View = (typeof VIEWS)[number];

export const ANALYSE_TABS = ['overview', 'speed', 'threats', 'ohko', 'compare'] as const;
export type AnalyseTab = (typeof ANALYSE_TABS)[number];

/** The OHKO tab's two lists: what can OHKO my team (`by`), and what my team can OHKO (`to`). */
export type { OhkoMode } from './threats.ts';
import type { OhkoMode } from './threats.ts';

export interface Route {
  view: View;
  /** Only with `view: 'analyse'`. */
  tab?: AnalyseTab;
  /** Only with `tab: 'ohko'`. */
  ohko?: OhkoMode;
}

export const DEFAULT_ANALYSE_TAB: AnalyseTab = 'overview';
export const DEFAULT_OHKO_MODE: OhkoMode = 'by';

/** The hashes of the screens that moved into Analyse. */
const LEGACY: Record<string, Route> = {
  speed: { view: 'analyse', tab: 'speed' },
  threats: { view: 'analyse', tab: 'threats' },
  ohkod: { view: 'analyse', tab: 'ohko', ohko: 'by' },
  ohko: { view: 'analyse', tab: 'ohko', ohko: 'to' },
  showcase: { view: 'analyse', tab: 'overview' },
  compare: { view: 'analyse', tab: 'compare' },
};

const isView = (s: string): s is View => (VIEWS as readonly string[]).includes(s);
const isTab = (s: string): s is AnalyseTab => (ANALYSE_TABS as readonly string[]).includes(s);

/** A URL hash (with or without the `#`) as a route; null when it names nothing the app knows. */
export function parseRoute(hash: string): Route | null {
  const [head, tab, extra, ...rest] = hash.replace(/^#/, '').split('/');
  if (rest.length) return null;
  if (!tab && Object.hasOwn(LEGACY, head)) return { ...LEGACY[head] };
  if (!isView(head)) return null;
  if (head !== 'analyse') return tab ? null : { view: head };
  if (!tab) return { view: 'analyse', tab: DEFAULT_ANALYSE_TAB };
  if (!isTab(tab)) return null;
  if (tab !== 'ohko') return extra ? null : { view: 'analyse', tab };
  if (extra && extra !== 'by' && extra !== 'to') return null;
  return { view: 'analyse', tab, ohko: (extra as OhkoMode | undefined) ?? DEFAULT_OHKO_MODE };
}

/** The hash for a route (with the `#`): `#calc`, `#analyse/speed`, `#analyse/ohko/to`. */
export function routeHash(route: Route): string {
  if (route.view !== 'analyse') return `#${route.view}`;
  const tab = route.tab ?? DEFAULT_ANALYSE_TAB;
  if (tab === 'ohko') return `#analyse/ohko/${route.ohko ?? DEFAULT_OHKO_MODE}`;
  return `#analyse/${tab}`;
}

/** A view id saved by an older version (it may be one that has moved into Analyse) as today's route. */
export const routeFromSaved = (view: unknown): Route => (typeof view === 'string' ? parseRoute(view) : null) ?? { view: 'builder' };
