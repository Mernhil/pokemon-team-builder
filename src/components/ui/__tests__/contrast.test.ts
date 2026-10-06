import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENERATIONS } from '@/domain/generations';
import { TYPE_BADGE, TYPE_COLORS, contrastRatio, readableOn } from '../color';

/** Reads the colour tokens of one block of src/index.css (`@theme {…}` or `.dark {…}`). */
function tokens(block: '@theme' | '.dark'): Record<string, string> {
  const css = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8');
  const start = css.indexOf(`${block} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const light = tokens('@theme');
const THEMES = { light, dark: { ...light, ...tokens('.dark') } };
const BACKGROUNDS = ['bg', 'surface', 'surface-2'];
const TEXT = ['fg', 'muted', 'accent', 'good', 'warn', 'bad', 'stat-hp', 'stat-atk', 'stat-def', 'stat-spa', 'stat-spd', 'stat-spe'];

describe.each(Object.entries(THEMES))('%s theme meets WCAG AA', (_name, t) => {
  it.each(TEXT)('%s text reaches 4.5:1 on every background', (fg) => {
    for (const bg of BACKGROUNDS) expect(contrastRatio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('control borders reach 3:1 (WCAG 1.4.11) and button text 4.5:1', () => {
    for (const bg of BACKGROUNDS) expect(contrastRatio(t['border-strong'], t[bg]), `border-strong on ${bg}`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(t['accent-fg'], t.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('text-bg on the bad fill (the active + nature button) reaches 4.5:1', () => {
    expect(contrastRatio(t.bg, t.bad)).toBeGreaterThanOrEqual(4.5);
  });

  it('uses no pure black or white page background', () => {
    expect(t.bg).not.toMatch(/^#(000000|ffffff)$/);
    expect(t.surface).not.toMatch(/^#(000000|ffffff)$/);
  });
});

describe('badges on official colours', () => {
  it('every type badge reads at 4.5:1, keeping the official colour where it can', () => {
    for (const [type, { fill, text }] of Object.entries(TYPE_BADGE)) {
      expect(contrastRatio(text, fill), type).toBeGreaterThanOrEqual(4.5);
      if (type !== 'Fire') expect(fill, type).toBe(TYPE_COLORS[type as keyof typeof TYPE_COLORS]);
    }
  });

  it('every generation badge reads at 4.5:1', () => {
    for (const g of GENERATIONS) {
      const { fill, text } = readableOn(g.color);
      expect(contrastRatio(text, fill), `Gen ${g.gen}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
