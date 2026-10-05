/**
 * The main bar: which destinations sit in it (the bottom bar on a phone, the top bar on desktop) and
 * which are behind "More". The player can choose them (Settings → Navigation); the default is Build,
 * Calc, Analyse, Pokédex on a phone and those plus Pokénav on desktop. Pokénav (maps of the main
 * games) means nothing for Pokémon Champions, so there its slot is Reverse search. Pure.
 */
import { VIEWS, type View } from './routes.ts';

/** Every destination that can be in the bar (Settings and the Game day screen are not destinations). */
export type NavId = View;
export const NAV_IDS: readonly NavId[] = VIEWS;

export const NAV_LABELS: Record<NavId, string> = {
  builder: 'Build',
  calc: 'Calc',
  analyse: 'Analyse',
  dex: 'Pokédex',
  atlas: 'Pokénav',
  matches: 'Match log',
  gameday: 'Game day',
  meta: 'Meta',
  reverse: 'Reverse search',
  regdiff: 'Regulation diff',
};

export type NavKind = 'desktop' | 'phone';
export const NAV_LIMITS: Record<NavKind, { min: number; max: number }> = { desktop: { min: 3, max: 6 }, phone: { min: 2, max: 4 } };

export const DEFAULT_NAV: Record<NavKind, NavId[]> = {
  desktop: ['builder', 'calc', 'analyse', 'dex', 'atlas'],
  phone: ['builder', 'calc', 'analyse', 'dex'],
};

export type NavPrefs = Partial<Record<NavKind, NavId[]>>;

const isNavId = (v: unknown): v is NavId => typeof v === 'string' && (NAV_IDS as readonly string[]).includes(v);

/** A saved choice of any shape as a valid one: unknown or repeated ids drop out, a list outside its limits is ignored. */
export function sanitizeNav(raw: unknown): NavPrefs {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: NavPrefs = {};
  for (const kind of ['desktop', 'phone'] as const) {
    const list = Array.isArray(src[kind]) ? [...new Set((src[kind] as unknown[]).filter(isNavId))].slice(0, NAV_LIMITS[kind].max) : [];
    if (list.length >= NAV_LIMITS[kind].min) out[kind] = list;
  }
  return out;
}

/**
 * The bar's destinations, in order. In the default bar for Champions, Pokénav is swapped for Reverse
 * search; a bar the player chose is shown exactly as chosen.
 */
export function resolveBar(kind: NavKind, prefs: NavPrefs | undefined, champions: boolean): NavId[] {
  const chosen = prefs?.[kind];
  if (chosen) return chosen;
  return [...new Set(DEFAULT_NAV[kind].map((id) => (champions && id === 'atlas' ? 'reverse' : id)))];
}

const MORE_ORDER: NavId[] = ['builder', 'calc', 'analyse', 'dex', 'matches', 'gameday', 'meta'];
const TOOLS_ORDER: NavId[] = ['reverse', 'regdiff', 'atlas'];

/** What "More" lists: everything not in the bar, as a main group and a Tools group. `hidePokenav`: the default Champions bar, which has no use for it. */
export function moreGroups(bar: readonly NavId[], hidePokenav: boolean): { main: NavId[]; tools: NavId[] } {
  const rest = (ids: NavId[]) => ids.filter((id) => !bar.includes(id) && !(hidePokenav && id === 'atlas'));
  return { main: rest(MORE_ORDER), tools: rest(TOOLS_ORDER) };
}

/** `ids` with the destination at `slot` replaced by `id`; if `id` is already elsewhere, the two swap places. */
export function setSlot(ids: readonly NavId[], slot: number, id: NavId): NavId[] {
  const next = [...ids];
  const from = next.indexOf(id);
  if (from >= 0 && from !== slot) next[from] = next[slot];
  next[slot] = id;
  return next;
}

/** Adds a slot (the first destination not yet in the bar), or removes one, within the limits. */
export function resizeBar(ids: readonly NavId[], kind: NavKind, delta: 1 | -1): NavId[] {
  const { min, max } = NAV_LIMITS[kind];
  if (delta > 0) {
    const free = NAV_IDS.find((id) => !ids.includes(id));
    return ids.length < max && free ? [...ids, free] : [...ids];
  }
  return ids.length > min ? ids.slice(0, -1) : [...ids];
}
