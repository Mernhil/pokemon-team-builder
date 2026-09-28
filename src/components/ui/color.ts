/**
 * Colour helpers shared by the UI: the official type colours, WCAG contrast maths and the
 * readable text colour for anything drawn on a type or generation colour.
 */
import type { MoveType, StatId, TeraType } from '@/domain/types';

/** Official type colours (the games' own). */
export const TYPE_COLORS: Record<TeraType | '???', string> = {
  Normal: '#9fa19f', Fire: '#e62829', Water: '#2980ef', Electric: '#fac000', Grass: '#3fa129',
  Ice: '#3dcef3', Fighting: '#ff8000', Poison: '#9141cb', Ground: '#915121', Flying: '#81b9ef',
  Psychic: '#ef4179', Bug: '#91a119', Rock: '#afa981', Ghost: '#704170', Dragon: '#5060e1',
  Dark: '#624d4e', Steel: '#60a1b8', Fairy: '#ef70ef', Stellar: '#40b5a5', '???': '#68a090',
};

export const STAT_COLOR_VAR: Record<StatId, string> = {
  hp: 'var(--color-stat-hp)',
  atk: 'var(--color-stat-atk)',
  def: 'var(--color-stat-def)',
  spa: 'var(--color-stat-spa)',
  spd: 'var(--color-stat-spd)',
  spe: 'var(--color-stat-spe)',
};

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toHex = (rgb: number[]) => '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');

/** WCAG 2 relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two #rrggbb colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const LIGHT_TEXT = '#ffffff';
export const DARK_TEXT = '#111111';

/**
 * Fill and text colour for a label on `color`: white or near-black, whichever reads better. If
 * neither reaches `min` (Fire's red sits just under 4.5:1 with both), the fill is darkened in 1%
 * steps until white does — visually the same colour, but legible.
 */
export function readableOn(color: string, min = 4.5): { fill: string; text: string } {
  let fill = color;
  for (let step = 1; step <= 40; step++) {
    const light = contrastRatio(LIGHT_TEXT, fill);
    const dark = contrastRatio(DARK_TEXT, fill);
    if (Math.max(light, dark) >= min) return { fill, text: light >= dark ? LIGHT_TEXT : DARK_TEXT };
    fill = toHex(channels(color).map((c) => c * (1 - step / 100)));
  }
  return { fill, text: LIGHT_TEXT };
}

/** Badge colours for every type, computed once. */
export const TYPE_BADGE = Object.fromEntries(
  Object.entries(TYPE_COLORS).map(([t, c]) => [t, readableOn(c)]),
) as Record<TeraType | MoveType, { fill: string; text: string }>;
