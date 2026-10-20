import { expect, type Page } from '@playwright/test';

/**
 * "No overflow on phones": for every visible element, its right edge must stay inside the viewport and inside
 * the nearest ancestor that draws a box (a border, a background or rounded corners). The old check only
 * compared document.documentElement.scrollWidth, which a card that clips or hides its own overflow never trips
 * (a Delete button pushed outside its card, or cut off by it, still left the page the right width).
 *
 * Skipped on purpose: the inside of an `overflow-x: auto|scroll` region (it scrolls by design, with a label),
 * the inside of an `<svg>`, `sr-only` text and zero-size boxes.
 */
export interface Overflow {
  /** A short description of the element that sticks out. */
  el: string;
  /** What it sticks out of: 'viewport' or the container. */
  of: string;
  /** Pixels past the edge. */
  by: number;
}

export async function findOverflow(page: Page): Promise<Overflow[]> {
  return page.evaluate(() => {
    const TOL = 1.5;
    const vw = document.documentElement.clientWidth;
    const out: { el: string; of: string; by: number }[] = [];
    const offenders: Element[] = [];
    const describe = (e: Element) => {
      const label = e.getAttribute('aria-label') || (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      const cls = typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className.split(/\s+/).slice(0, 3).join('.') : '';
      return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}${label ? ` “${label}”` : ''}`;
    };
    const drawsBox = (s: CSSStyleDeclaration) => {
      const border = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 && s.getPropertyValue(`border-${side.toLowerCase()}-style`) !== 'none');
      const bg = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent';
      const radius = parseFloat(s.borderTopLeftRadius) > 0;
      return border || (bg && radius);
    };
    // A region that scrolls sideways on purpose says so with `overflow-x-auto` in its classes; a
    // dialog or page body that merely scrolls vertically computes overflow-x: auto too, but is not one.
    const scrolls = (s: CSSStyleDeclaration, e: Element) => {
      if (e.hasAttribute('data-overflow-ok')) return true;
      if (s.overflowX !== 'auto' && s.overflowX !== 'scroll') return false;
      const cls = typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className : '';
      return /(^|\s)overflow-x-(auto|scroll)(\s|$)/.test(cls);
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (el.closest('[data-overflow-ok]')) continue;
      // Inside a region that scrolls sideways by design.
      let skip = false;
      let container: Element | null = null;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (scrolls(ps, p)) {
          skip = true;
          break;
        }
        if (!container && drawsBox(ps)) container = p;
      }
      if (skip) continue;
      // The page itself is the other limit; position: fixed and portal'ed layers answer to the viewport only.
      if (r.right > vw + TOL) {
        out.push({ el: describe(el), of: 'viewport', by: Math.round((r.right - vw) * 10) / 10 });
        offenders.push(el);
      }
      else if (container && style.position !== 'fixed') {
        const c = container.getBoundingClientRect();
        const cs = getComputedStyle(container);
        const edge = c.right - parseFloat(cs.borderRightWidth || '0');
        if (r.right > edge + TOL) {
          out.push({ el: describe(el), of: describe(container), by: Math.round((r.right - edge) * 10) / 10 });
          offenders.push(el);
        }
      }
    }
    // The innermost offenders only: a parent that sticks out because its child does is not a second problem.
    const els = new Set(offenders);
    return out.filter((_, i) => ![...els].some((other) => other !== offenders[i] && offenders[i].contains(other))).slice(0, 8);
  });
}

/** Fails with the list of elements that stick out of their card or the viewport. */
export async function expectNoOverflow(page: Page, where: string) {
  // Colours and sizes settle (transitions, content-visibility); look at the settled page.
  await page.evaluate(() => {
    if (document.getElementById('e2e-no-motion')) return;
    const style = document.createElement('style');
    style.id = 'e2e-no-motion';
    style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
    document.head.append(style);
  });
  await page.waitForTimeout(150);
  const found = await findOverflow(page);
  expect(found.map((o) => `${where}: ${o.el} sticks out of ${o.of} by ${o.by}px`)).toEqual([]);
}

// ---------------------------------------------------------------------------
// Realistic data
// ---------------------------------------------------------------------------

const NOW = Date.now();
const mon = (speciesId: string, moves: string[] = ['protect', 'earthquake']) => ({
  uid: `u-${speciesId}`,
  speciesId,
  nature: 'Adamant',
  moves: [...moves, '', ''].slice(0, 4),
  level: 50,
  sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
});

const team = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  formatId: 'champions-vgc-reg-mc',
  category: 'Champions Reg M-C',
  slots: ['garchomp', 'incineroar', 'whimsicott', 'dragapult', 'kingambit', 'rillaboom'].map((s) => mon(s)),
  createdAt: NOW - 86_400_000,
  updatedAt: NOW - 3_600_000,
  ...extra,
});

export const LONG_NAME = 'My very long team name that keeps going — Regional Championship Top Cut Rain Offense Final Version v12';
export const LONG_EMAIL = 'a-friend-with-a-really-long-address.name@some-long-domain-name.example.com';

/** Saved teams the way a long-time user has them: a long name, three variations, an old regulation (chips), a draft on top. */
export function seededStorage() {
  const teams: Record<string, unknown> = {};
  const add = (t: ReturnType<typeof team>) => (teams[t.id] = t);
  add(team('draft-1', 'Untitled Team', { slots: [null, null, null, null, null, null], category: 'Champions Reg M-C' }));
  add(team('long-1', LONG_NAME));
  add(team('long-1-v1', LONG_NAME, { groupId: 'long-1', variationLabel: 'Variation 2 vs Trick Room and a very long label' }));
  add(team('long-1-v2', LONG_NAME, { groupId: 'long-1', variationLabel: 'Variation 3' }));
  add(team('long-1-v3', LONG_NAME, { groupId: 'long-1', variationLabel: 'Conflict copy (Device 4F2A, 2026-10-03)', formatId: 'champions-vgc-reg-ma', category: 'Champions Reg M-A' }));
  add(team('old-1', 'Old reg team', { formatId: 'champions-vgc-reg-ma', category: 'Champions Reg M-A' }));
  add(team('gen9-1', 'Gen 9 doubles', { formatId: 'gen9vgc2024', category: 'Gen 9 VGC' }));
  const matches: Record<string, unknown> = {};
  for (let i = 0; i < 4; i++) {
    matches[`m${i}`] = {
      id: `m${i}`,
      date: `2026-10-0${i + 1}`,
      result: i % 2 ? 'loss' : 'win',
      eventName: i === 0 ? 'Regional Championship Top Cut Round 3 against a very long opponent handle' : 'Ladder',
      category: 'Tournament',
      myTeamId: 'long-1',
      opponentTeam: [{ speciesId: 'kingambit' }, { speciesId: 'sneasler' }, { speciesId: 'incineroar' }],
      notes: 'Lost to a Trick Room lead; bring the Fake Out user next time and keep Tailwind up for turn 2.',
      createdAt: NOW - i * 1000,
      updatedAt: NOW - i * 1000,
    };
  }
  return {
    'ptb:v1': JSON.stringify({ state: { teams, order: ['draft-1', 'long-1', 'old-1', 'gen9-1'], activeTeamId: 'draft-1', view: 'builder', theme: 'dark' }, version: 4 }),
    'ptb:matches:v1': JSON.stringify({ state: { matches, order: Object.keys(matches) }, version: 3 }),
    'ptb:sync:v1': JSON.stringify({ state: { enabled: true, deviceName: 'A phone with a rather long device name', cursor: 0, known: {} }, version: 1 }),
  };
}

/** Puts the seeded data in place (once, so a reload keeps what the app did since) and fakes the sync server: sync on, a shared team, shares. */
export async function seedRealistic(page: Page, opts: { signedOut?: boolean } = {}) {
  const store = seededStorage();
  await page.addInitScript((s) => {
    if (localStorage.getItem('ptb:seeded')) return;
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
    localStorage.setItem('ptb:seeded', '1');
  }, store);
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const shared = team('shared-1', 'A team shared by a friend with a long name', { updatedAt: NOW - 7_200_000 });
  const sharedVar = team('shared-1-v1', 'A team shared by a friend with a long name', { groupId: 'shared-1', variationLabel: 'Variation 2' });
  await page.route('**/api/shares', (route) =>
    route.fulfill(
      opts.signedOut
        ? json({ error: 'no' }, 401)
        : json({
            me: { email: 'me@example.com', displayName: 'Me' },
            granted: [{ owner: 'me@example.com', grantee: LONG_EMAIL, kind: 'team-group', ref: 'long-1', role: 'edit' }, { owner: 'me@example.com', grantee: 'friend@example.com', kind: 'matches', ref: '*', role: 'view' }],
            received: [{ owner: LONG_EMAIL, grantee: 'me@example.com', kind: 'team-group', ref: 'shared-1', role: 'edit' }],
            names: { [LONG_EMAIL]: 'Ash Ketchum from Pallet Town' },
          }),
    ),
  );
  await page.route('**/api/shared', (route) =>
    route.fulfill(
      opts.signedOut
        ? json({ error: 'no' }, 401)
        : json({
            docs: [shared, sharedVar].map((t, i) => ({ id: t.id, kind: 'team', updatedAt: t.updatedAt, deleted: false, json: t, seq: i + 1, owner: LONG_EMAIL, role: 'edit' })),
            names: { [LONG_EMAIL]: 'Ash Ketchum from Pallet Town' },
          }),
    ),
  );
  await page.route('**/api/sync**', (route) => {
    if (opts.signedOut) return route.fulfill(json({ error: 'no' }, 401));
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill(json({ docs: [], cursor: 0, more: false }));
    const body = req.postDataJSON() as { docs: { id: string; kind: string }[] };
    return route.fulfill(json({ results: body.docs.map((d) => ({ id: d.id, kind: d.kind, status: 'applied' })) }));
  });
  await page.route('**/api/devices', (route) => route.fulfill(json({ devices: [{ id: 'd1', name: 'My laptop with a really long name for a computer', createdAt: NOW, lastSeenAt: NOW }] })));
  await page.route('**/api/health', (route) => route.fulfill(json({ database: true, migrations: [], missing: ['0004_redeem_attempts', '0005_a_long_migration_name'], access: { teamDomain: true, audience: true }, time: NOW })));
}
