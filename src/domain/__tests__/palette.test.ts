import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHROMA_RANGE, PALETTE_PRESETS, STATUS_BASE, STATUS_TOKEN_NAMES, contrast, paletteTokens, sanitizePalette } from '../palette';

const BGS = ['bg', 'surface', 'surface-2'] as const;

describe.each(['light', 'dark'] as const)('%s palettes meet WCAG AA at every hue and vividness', (theme) => {
  it('text, accent and control borders stay readable', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      for (const chroma of [CHROMA_RANGE.min, 0.05, 0.1, 0.15, CHROMA_RANGE.max]) {
        const t = paletteTokens({ hue, chroma }, theme);
        const at = `hue ${hue}, chroma ${chroma}`;
        for (const bg of BGS) {
          expect(contrast(t.fg, t[bg]), `fg ${at}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t.muted, t[bg]), `muted ${at}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t.accent, t[bg]), `accent ${at}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t['border-strong'], t[bg]), `border ${at}`).toBeGreaterThanOrEqual(3);
        }
        expect(contrast(t['accent-fg'], t.accent), `accent-fg ${at}`).toBeGreaterThanOrEqual(4.5);
        for (const name of STATUS_TOKEN_NAMES) for (const bg of BGS) expect(contrast(t[name], t[bg]), `${name} on ${bg}, ${at}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('presets and sanitising', () => {
  it('every preset produces valid hex colours', () => {
    for (const p of PALETTE_PRESETS) for (const theme of ['light', 'dark'] as const) for (const v of Object.values(paletteTokens(p, theme))) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('clamps and rejects bad saved values', () => {
    expect(sanitizePalette({ hue: 400, chroma: 5 })).toEqual({ hue: 40, chroma: CHROMA_RANGE.max });
    expect(sanitizePalette({ hue: -10, chroma: -1 })).toEqual({ hue: 350, chroma: 0 });
    expect(sanitizePalette('x')).toBeNull();
    expect(sanitizePalette({ hue: NaN, chroma: 0.1 })).toBeNull();
  });
});

describe('status colours', () => {
  it('STATUS_BASE matches the tokens in index.css', () => {
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    const block = (start: string) => css.slice(css.indexOf(start), css.indexOf('}', css.indexOf(start)));
    const read = (b: string, n: string) => b.match(new RegExp(`--color-${n}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1].toLowerCase();
    for (const n of STATUS_TOKEN_NAMES) {
      expect(read(block('@theme {'), n), `light ${n}`).toBe(STATUS_BASE.light[n]);
      expect(read(block('.dark {'), n), `dark ${n}`).toBe(STATUS_BASE.dark[n]);
    }
  });
  it('keeps a colour that already reads, and only moves the ones that do not', () => {
    // Iris-like surfaces: the default status colours are fine, so they come back unchanged or very close.
    const t = paletteTokens({ hue: 268, chroma: 0.15 }, 'dark');
    expect(contrast(t.good, t.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
