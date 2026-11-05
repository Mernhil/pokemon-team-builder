import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Two simulated devices for the sync tests: each is its own browser context (own localStorage, own clock) talking to one
 * in-memory server that follows the Worker's rules (last write wins by `updatedAt`, strictly newer only, a per-account
 * sequence number as the cursor, a stale push answered with the server's version).
 */
interface Doc {
  id: string;
  kind: string;
  updatedAt: number;
  deleted: boolean;
  json?: unknown;
  seq: number;
}

export class FakeServer {
  docs = new Map<string, Doc>();
  seq = 0;
  /** Every request, in order, e.g. "POST /api/sync". */
  log: string[] = [];
  pushes: { device: string; ids: string[] }[] = [];
  /** Requests to /api/sync that are held open for good (a frozen connection). */
  hang = false;
  /** Pushes fail as if the connection dropped (GETs still work). */
  failPush = false;

  put(d: Omit<Doc, 'seq'>) {
    this.docs.set(`${d.kind}:${d.id}`, { ...d, seq: ++this.seq });
  }
  team(id: string): { name?: string; updatedAt?: number; [k: string]: unknown } | undefined {
    return this.docs.get(`team:${id}`)?.json as never;
  }
  teams() {
    return [...this.docs.values()].filter((d) => d.kind === 'team' && !d.deleted).map((d) => d.json as { id: string; name: string; variationLabel?: string; groupId?: string; createdOn?: string; updatedOn?: string });
  }

  async attach(ctx: BrowserContext, device: string) {
    await ctx.route('**/api/shares', (r) => r.fulfill({ json: { me: { email: 'me@example.com' }, granted: [], received: [], names: {} } }));
    await ctx.route('**/api/shared', (r) => r.fulfill({ json: { docs: [], names: {} } }));
    await ctx.route('**/api/health', (r) => r.fulfill({ json: { database: true, migrations: [], missing: [], access: { teamDomain: true, audience: true }, time: Date.now() } }));
    await ctx.route('**/api/devices', (r) => r.fulfill({ json: { devices: [] } }));
    await ctx.route('**/api/sync**', async (route) => {
      const req = route.request();
      this.log.push(`${req.method()} ${new URL(req.url()).pathname} (${device})`);
      if (this.hang) return; // never answered
      if (req.method() === 'GET') {
        const since = Number(new URL(req.url()).searchParams.get('since'));
        const docs = [...this.docs.values()].filter((d) => d.seq > since).sort((a, b) => a.seq - b.seq);
        return route.fulfill({ json: { docs, cursor: docs.length ? docs[docs.length - 1].seq : since, more: false }, headers: { 'cache-control': 'no-store' } });
      }
      if (this.failPush) return route.abort('failed');
      const body = req.postDataJSON() as { docs: Omit<Doc, 'seq'>[] };
      this.pushes.push({ device, ids: body.docs.map((d) => d.id) });
      const results = body.docs.map((d) => {
        const cur = this.docs.get(`${d.kind}:${d.id}`);
        // As the Worker: strictly newer wins, except the same version of a team that only gained device labels.
        const adds = cur && !cur.deleted && cur.updatedAt === d.updatedAt && !(cur.json as { createdOn?: string })?.createdOn && !!(d.json as { createdOn?: string } | undefined)?.createdOn;
        if (cur && !adds && !(d.updatedAt > cur.updatedAt)) return { id: d.id, kind: d.kind, status: 'stale', doc: cur };
        this.put({ id: d.id, kind: d.kind, updatedAt: d.updatedAt, deleted: !!d.deleted, json: d.deleted ? undefined : d.json });
        return { id: d.id, kind: d.kind, status: 'applied' };
      });
      return route.fulfill({ json: { results }, headers: { 'cache-control': 'no-store' } });
    });
  }
}

export interface Device {
  name: string;
  ctx: BrowserContext;
  page: Page;
}

/** A device whose clock is `skewMs` off the real one, signed in, with sync on under `name`. */
export async function newDevice(browser: Browser, info: TestInfo, server: FakeServer, name: string, opts: { skewMs?: number; userAgent?: string; clock?: boolean } = {}): Promise<Device> {
  const use = info.project.use as Record<string, unknown>;
  const ctx = await browser.newContext({ ...(use.viewport ? { viewport: use.viewport as never } : {}), ...(use.isMobile ? { isMobile: true, hasTouch: true } : {}), userAgent: opts.userAgent ?? (use.userAgent as string | undefined), storageState: use.storageState as never, baseURL: use.baseURL as string, serviceWorkers: 'block' });
  await server.attach(ctx, name);
  await ctx.addInitScript(
    ([n, skew]) => {
      if (skew) {
        const real = Date.now.bind(Date);
        Date.now = () => real() + (skew as number);
      }
      // What the app asked fetch to do, for the keepalive checks.
      const realFetch = window.fetch.bind(window);
      (window as unknown as { __fetches: unknown[] }).__fetches = [];
      window.fetch = (input, init) => {
        (window as unknown as { __fetches: unknown[] }).__fetches.push({ url: String(input instanceof Request ? input.url : input), method: init?.method ?? 'GET', keepalive: !!init?.keepalive });
        return realFetch(input, init);
      };
      if (!localStorage.getItem('ptb:sync:v1')) localStorage.setItem('ptb:sync:v1', JSON.stringify({ state: { enabled: true, deviceName: n, cursor: 0, known: {} }, version: 1 }));
    },
    [name, opts.skewMs ?? 0] as const,
  );
  const page = await ctx.newPage();
  if (opts.clock) await page.clock.install();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeAttached();
  return { name, ctx, page };
}

/** Backgrounds the app the way iOS does: the page becomes hidden and fires `visibilitychange` and `pagehide`. */
export async function hide(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
  });
}
/** Brings it back to the front. */
export async function show(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
}

export async function openSavedTeams(page: Page) {
  await page.getByRole('button', { name: 'Team actions' }).click();
  await page.getByRole('menuitem', { name: 'Saved teams' }).click();
  const dialog = page.getByRole('dialog', { name: 'Saved teams' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Renames a saved team in its card (click the name, type, Enter) and closes the dialog. */
export async function renameSaved(page: Page, from: string, to: string) {
  const dialog = await openSavedTeams(page);
  await dialog.getByRole('button', { name: `Rename ${from}`, exact: true }).click();
  const input = dialog.getByRole('textbox', { name: 'Saved team name' });
  await input.fill(to);
  await input.press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

export async function savedTeamNames(page: Page): Promise<string[]> {
  const dialog = await openSavedTeams(page);
  const names = await dialog.getByRole('button', { name: /^Rename / }).evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') ?? '').replace(/^Rename /, '')));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return names;
}

export const BASE_TEAM = {
  id: 'base-team',
  name: 'Base',
  formatId: 'champions-vgc-reg-mc',
  slots: [null, null, null, null, null, null],
  createdAt: 1_790_000_000_000,
  updatedAt: 1_790_000_000_000,
};

/** The sync store as it is persisted on the device. */
export const syncState = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('ptb:sync:v1') ?? '{}') as { state?: { dirty?: boolean; lastSyncAt?: number; cursor?: number; known?: Record<string, unknown> } }).state ?? {});

/** Waits for a sync run to have finished well since `after`. */
export async function waitSynced(page: Page, after = 0) {
  await expect.poll(async () => (await syncState(page)).lastSyncAt ?? 0, { timeout: 15_000 }).toBeGreaterThan(after);
  return (await syncState(page)).lastSyncAt ?? 0;
}

/** The POSTs the app made to /api/sync, with whether each asked for keepalive. */
export const syncPosts = (page: Page) =>
  page.evaluate(() => ((window as unknown as { __fetches: { url: string; method: string; keepalive: boolean }[] }).__fetches ?? []).filter((f) => f.method === 'POST' && f.url.includes('/api/sync')));
