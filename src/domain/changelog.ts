/**
 * CHANGELOG.md as data, for "What's new". Parsed at build time (vite.config.ts → `virtual:changelog`)
 * and read in the app; pure, so it is tested without either.
 *
 * A release is `## 0.24.0 — 2026-10-05`, then `### New` / `### Changed` / `### Fixed`, then bullets.
 * A bullet that starts with **a bold title** is a feature; the title can name where to find it.
 */
interface ChangeItem {
  /** The bold title the bullet starts with, if any (without the **). */
  title?: string;
  /** The whole bullet, as Markdown (**bold**, *italic*, `code`). */
  text: string;
}
interface ChangeSection {
  /** "New", "Changed", "Fixed", or "" for bullets under no heading. */
  heading: string;
  items: ChangeItem[];
}
export interface Release {
  version: string;
  date?: string;
  sections: ChangeSection[];
}

/** Releases listed in CHANGELOG.md, newest first as written, at most `limit`. */
export function parseChangelog(markdown: string, limit = Infinity): Release[] {
  const releases: Release[] = [];
  let release: Release | undefined;
  let section: ChangeSection | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const head = /^## (\d+\.\d+\.\d+)(?:\s+[—–-]\s+(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (head) {
      if (releases.length >= limit) break;
      release = { version: head[1], ...(head[2] ? { date: head[2] } : {}), sections: [] };
      releases.push(release);
      section = undefined;
      continue;
    }
    if (!release) continue;
    const sec = /^### (.+?)\s*$/.exec(line);
    if (sec) {
      section = { heading: sec[1], items: [] };
      release.sections.push(section);
      continue;
    }
    const bullet = /^[-*] (.+)$/.exec(line);
    if (bullet) {
      if (!section) {
        section = { heading: '', items: [] };
        release.sections.push(section);
      }
      const title = /^\*\*(.+?)\*\*/.exec(bullet[1])?.[1];
      section.items.push({ ...(title ? { title } : {}), text: bullet[1] });
    }
  }
  return releases;
}

/** −1, 0 or 1 for two `x.y.z` versions; anything else compares as 0.0.0. */
export function compareVersions(a: string, b: string): number {
  const n = (v: string) => (/^(\d+)\.(\d+)\.(\d+)/.exec(v) ?? []).slice(1).map(Number);
  const x = n(a);
  const y = n(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** The releases after `seen` up to and including `current`, newest first. */
export function releasesSince(releases: Release[], seen: string, current: string): Release[] {
  return releases
    .filter((r) => compareVersions(r.version, seen) > 0 && compareVersions(r.version, current) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** Where a bold title points: the first rule whose words appear in the title. */
const DESTINATIONS: [RegExp, string][] = [
  [/team overview/i, '#analyse/overview'],
  [/speed tiers?/i, '#analyse/speed'],
  [/threat report/i, '#analyse/threats'],
  [/ohko/i, '#analyse/ohko'],
  [/compare/i, '#analyse/compare'],
  [/reverse search/i, '#reverse'],
  [/regulation (diff|banner)/i, '#regdiff'],
  [/match log/i, '#matches'],
  [/^meta\b|\bmeta (tab|data)/i, '#meta'],
  [/pok[ée]nav/i, '#atlas'],
  [/pok[ée]dex/i, '#dex'],
  [/damage calc/i, '#calc'],
  [/team builder|set editor|team check/i, '#builder'],
];
export function destinationFor(title: string | undefined): string | undefined {
  return title ? DESTINATIONS.find(([re]) => re.test(title))?.[1] : undefined;
}

export type Inline = { kind: 'text' | 'bold' | 'italic' | 'code'; text: string };
/** A bullet's Markdown as runs of text, for rendering without an HTML parser. */
export function inlineRuns(markdown: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*/g;
  let last = 0;
  for (let m = re.exec(markdown); m; m = re.exec(markdown)) {
    if (m.index > last) out.push({ kind: 'text', text: markdown.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: 'bold', text: m[1] } : m[2] !== undefined ? { kind: 'code', text: m[2] } : { kind: 'italic', text: m[3] });
    last = m.index + m[0].length;
  }
  if (last < markdown.length) out.push({ kind: 'text', text: markdown.slice(last) });
  return out;
}
