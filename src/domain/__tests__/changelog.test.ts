import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareVersions, destinationFor, inlineRuns, parseChangelog, releasesSince } from '@/domain/changelog';

const SAMPLE = `# Changelog

Intro text.

## 0.24.0 — 2026-10-05

### New
- **Analyse** (one picker for *every* tab) and \`#analyse/speed\`.
- Plain bullet with no title.

### Fixed
- **Team overview** got faster.

## 0.23.0 — 2026-10-04
- Before any heading.

## 0.22.1
### Changed
- **Reverse search** link.
`;

describe('parseChangelog', () => {
  const r = parseChangelog(SAMPLE);
  it('reads versions, dates and sections in order', () => {
    expect(r.map((x) => x.version)).toEqual(['0.24.0', '0.23.0', '0.22.1']);
    expect(r[0].date).toBe('2026-10-05');
    expect(r[2].date).toBeUndefined();
    expect(r[0].sections.map((s) => s.heading)).toEqual(['New', 'Fixed']);
  });
  it('takes the bold title and keeps the whole text', () => {
    expect(r[0].sections[0].items[0].title).toBe('Analyse');
    expect(r[0].sections[0].items[0].text).toContain('*every*');
    expect(r[0].sections[0].items[1].title).toBeUndefined();
  });
  it('puts bullets that follow no heading in an unnamed section', () => {
    expect(r[1].sections).toEqual([{ heading: '', items: [{ text: 'Before any heading.' }] }]);
  });
  it('honours the limit', () => {
    expect(parseChangelog(SAMPLE, 2).map((x) => x.version)).toEqual(['0.24.0', '0.23.0']);
  });
  it('parses the real CHANGELOG.md: the current version is first and every release has something in it', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
    const real = parseChangelog(readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8'));
    expect(real[0].version).toBe(pkg.version);
    for (const rel of real) expect(rel.sections.flatMap((s) => s.items).length, rel.version).toBeGreaterThan(0);
  });
});

describe('versions', () => {
  it('compares x.y.z numerically', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.24.0', '0.24.0')).toBe(0);
    expect(compareVersions('junk', '0.0.0')).toBe(0);
  });
  it('lists the releases after the one last seen, up to the current one, newest first', () => {
    const rel = parseChangelog(SAMPLE);
    expect(releasesSince(rel, '0.22.1', '0.24.0').map((x) => x.version)).toEqual(['0.24.0', '0.23.0']);
    expect(releasesSince(rel, '0.24.0', '0.24.0')).toEqual([]);
    expect(releasesSince(rel, '0.0.0', '0.23.0').map((x) => x.version)).toEqual(['0.23.0', '0.22.1']);
  });
});

describe('destinationFor', () => {
  it('points a title at the screen it names', () => {
    expect(destinationFor('Team overview')).toBe('#analyse/overview');
    expect(destinationFor('Reverse search: "Has to know a move"')).toBe('#reverse');
    expect(destinationFor('Recommended items and way to use')).toBeUndefined();
    expect(destinationFor('Meta data before Smogon')).toBe('#meta');
    expect(destinationFor('Pokénav for Gen 5+')).toBe('#atlas');
    expect(destinationFor(undefined)).toBeUndefined();
  });
});

describe('inlineRuns', () => {
  it('splits bold, italic and code, leaving the rest as text', () => {
    expect(inlineRuns('A **b** and *i* and `c` end')).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' and ' },
      { kind: 'italic', text: 'i' },
      { kind: 'text', text: ' and ' },
      { kind: 'code', text: 'c' },
      { kind: 'text', text: ' end' },
    ]);
    expect(inlineRuns('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
  });
});
