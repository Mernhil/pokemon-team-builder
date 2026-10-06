/**
 * Colour palettes: one hue and one "vividness" make a full set of interface colours for the light
 * or dark theme. Every text/background pair is nudged until it reaches WCAG AA, so any slider
 * position stays readable (palette.test.ts sweeps the whole range). Pure functions, no React.
 */

export type Theme = 'dark' | 'light';
export interface Palette {
  /** Hue angle, 0–359 (OKLCH). */
  hue: number;
  /** How colourful, 0 (grey) to 0.2 (vivid). */
  chroma: number;
}
/** The status and stat colours, which keep their hue but are darkened or lightened until they read on a palette's surfaces. */
export const STATUS_TOKEN_NAMES = ['good', 'warn', 'bad', 'stat-hp', 'stat-atk', 'stat-def', 'stat-spa', 'stat-spd', 'stat-spe'] as const;
type StatusToken = (typeof STATUS_TOKEN_NAMES)[number];

/** The tokens a palette overrides. */
export type PaletteTokens = Record<'bg' | 'surface' | 'surface-2' | 'border' | 'border-strong' | 'fg' | 'muted' | 'accent' | 'accent-fg' | StatusToken, string>;

export const PALETTE_TOKEN_NAMES = ['bg', 'surface', 'surface-2', 'border', 'border-strong', 'fg', 'muted', 'accent', 'accent-fg', ...STATUS_TOKEN_NAMES] as const satisfies readonly (keyof PaletteTokens)[];

/** The hand-tuned values in index.css (a test keeps these in step with it). */
export const STATUS_BASE: Record<Theme, Record<StatusToken, string>> = {
  light: { good: '#1d7943', warn: '#925e0a', bad: '#c0392f', 'stat-hp': '#bc3b3b', 'stat-atk': '#a35410', 'stat-def': '#826600', 'stat-spa': '#3264c8', 'stat-spd': '#2c7838', 'stat-spe': '#b8356f' },
  dark: { good: '#5fd08a', warn: '#e9b75a', bad: '#f08a80', 'stat-hp': '#f07a7a', 'stat-atk': '#f0a060', 'stat-def': '#e6cc5c', 'stat-spa': '#7fa6f5', 'stat-spd': '#7cd08a', 'stat-spe': '#f07fae' },
};

export const CHROMA_RANGE = { min: 0, max: 0.2 } as const;

export const PALETTE_PRESETS: readonly (Palette & { id: string; name: string })[] = [
  { id: 'iris', name: 'Iris', hue: 268, chroma: 0.15 },
  { id: 'ember', name: 'Ember', hue: 40, chroma: 0.16 },
  { id: 'moss', name: 'Moss', hue: 145, chroma: 0.14 },
  { id: 'ocean', name: 'Ocean', hue: 225, chroma: 0.12 },
  { id: 'rose', name: 'Rose', hue: 350, chroma: 0.17 },
  { id: 'graphite', name: 'Graphite', hue: 260, chroma: 0.02 },
];
/** The look the app ships with: no overrides at all, the hand-tuned tokens in index.css. */
export const DEFAULT_PALETTE_ID = 'iris';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** OKLCH to gamma-encoded sRGB channels (0–1), clipped to the gamut. */
function oklch(L: number, C: number, hue: number): number[] {
  const h = (hue * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((c) => {
    const v = clamp01(c);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  });
}
const hex = (rgb: number[]) => '#' + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('');
const make = (L: number, C: number, hue: number) => hex(oklch(L, C, hue));

const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Moves lightness from `L` towards `dir` (+1 lighter, −1 darker) until the colour reaches `min` on every background. */
function fit(L: number, C: number, hue: number, backgrounds: string[], min: number, dir: 1 | -1): string {
  let color = make(L, C, hue);
  for (let i = 0; i < 100 && backgrounds.some((bg) => contrast(color, bg) < min); i++) {
    L = clamp01(L + dir * 0.01);
    color = make(L, C, hue);
  }
  return color;
}

/** Mixes `hex` towards black or white in small steps until it reaches `min` on every background (a little over AA, so text on a tinted fill still passes). */
function nudge(hex: string, backgrounds: string[], min: number, towards: '#000000' | '#ffffff'): string {
  const mix = (t: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - t) + parseInt(towards.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
  for (let t = 0; t <= 1; t += 0.02) {
    const c = mix(t);
    if (backgrounds.every((bg) => contrast(c, bg) >= min)) return c;
  }
  return towards;
}

const statusTokens = (theme: Theme, backgrounds: string[]) =>
  Object.fromEntries(STATUS_TOKEN_NAMES.map((n) => [n, nudge(STATUS_BASE[theme][n], backgrounds, 4.7, theme === 'dark' ? '#ffffff' : '#000000')])) as Record<StatusToken, string>;

/** The interface colours for a palette in one theme. */
export function paletteTokens({ hue, chroma }: Palette, theme: Theme): PaletteTokens {
  const c = Math.max(CHROMA_RANGE.min, Math.min(CHROMA_RANGE.max, chroma));
  // Backgrounds stay quiet whatever the slider says: a fraction of the chroma, never more than a tint.
  const tint = Math.min(c * 0.2, 0.03);
  if (theme === 'dark') {
    const bg = make(0.19, tint, hue);
    const surface = make(0.235, tint, hue);
    const surface2 = make(0.29, tint * 1.1, hue);
    const bgs = [bg, surface, surface2];
    const accent = fit(0.78, c, hue, bgs, 4.5, 1);
    return {
      bg,
      surface,
      'surface-2': surface2,
      border: make(0.34, tint * 1.2, hue),
      'border-strong': fit(0.55, tint * 2, hue, bgs, 3, 1),
      fg: make(0.95, tint * 0.3, hue),
      muted: fit(0.72, tint * 1.5, hue, bgs, 4.5, 1),
      accent,
      'accent-fg': contrast('#111111', accent) >= contrast('#ffffff', accent) ? '#111111' : '#ffffff',
      ...statusTokens('dark', bgs),
    };
  }
  const bg = make(0.96, tint * 0.7, hue);
  const surface = make(0.99, tint * 0.4, hue);
  const surface2 = make(0.93, tint * 0.9, hue);
  const bgs = [bg, surface, surface2];
  const accent = fit(0.52, c, hue, [...bgs, '#ffffff'], 4.5, -1);
  return {
    bg,
    surface,
    'surface-2': surface2,
    border: make(0.87, tint, hue),
    'border-strong': fit(0.62, tint * 2, hue, bgs, 3, -1),
    fg: make(0.22, tint, hue),
    muted: fit(0.48, tint * 1.5, hue, bgs, 4.5, -1),
    accent,
    'accent-fg': '#ffffff',
    ...statusTokens('light', bgs),
  };
}

/** The preset a palette equals, if any. */
export const presetOf = (p: Palette | null) => (p === null ? PALETTE_PRESETS.find((x) => x.id === DEFAULT_PALETTE_ID) : PALETTE_PRESETS.find((x) => x.hue === p.hue && x.chroma === p.chroma));

/** A saved or shared value, or anything else, to a safe palette (null = the default look). */
export function sanitizePalette(v: unknown): Palette | null {
  if (!v || typeof v !== 'object') return null;
  const { hue, chroma } = v as Record<string, unknown>;
  if (typeof hue !== 'number' || typeof chroma !== 'number' || !Number.isFinite(hue) || !Number.isFinite(chroma)) return null;
  return { hue: Math.round(((hue % 360) + 360) % 360), chroma: Math.round(Math.max(CHROMA_RANGE.min, Math.min(CHROMA_RANGE.max, chroma)) * 1000) / 1000 };
}
