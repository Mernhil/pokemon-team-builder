/// <reference lib="webworker" />
import { cacheNames, clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, PrecacheController, PrecacheRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { checkPrecacheResponse, NETWORK_ONLY_PATHS } from '../src/domain/swGuard';

/**
 * The app's service worker (vite.config.ts → vite-plugin-pwa, `injectManifest`): precaches the whole build, answers
 * navigations with the cached `index.html`, and takes over at once when a new version is deployed (src/pwa.ts reloads the page).
 *
 * What it adds to the stock generated worker is distrust of the network while installing: behind Cloudflare Access a request can
 * come back as a redirect to the login page, or (single-page-application fallback) as index.html in place of a missing file.
 * Such an answer must never become a cached script, so the whole install fails instead and the previous version keeps running.
 */
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

const judge = async (request: Request, response: Response) =>
  checkPrecacheResponse(
    request.url,
    { status: response.status, type: response.type, redirected: response.redirected, contentType: response.headers.get('content-type') },
    new URL(request.url).pathname.endsWith('.html') ? await response.clone().text() : undefined,
  );

const guard = {
  // Never follow a redirect and never reuse the browser's HTTP cache for a precache download.
  requestWillFetch: async ({ request }: { request: Request }) => new Request(request, { redirect: 'error', cache: 'reload' }),
  cacheWillUpdate: async ({ request, response }: { request: Request; response?: Response }) => {
    if (!response) return null;
    const verdict = await judge(request, response);
    if (!verdict.ok) console.warn(`[sw] not precaching ${new URL(request.url).pathname}: ${verdict.reason}`);
    return verdict.ok ? response : null;
  },
};

const precache = new PrecacheController({ plugins: [guard] });
precache.addToCacheList(self.__WB_MANIFEST);

/** Entries a previous version of this worker (or the stock one) cached from a bad answer: drop them so the install below downloads them again. */
async function dropBadEntries(): Promise<void> {
  const cache = await caches.open(cacheNames.precache);
  for (const request of await cache.keys()) {
    const response = await cache.match(request);
    if (!response || !(await judge(request, response)).ok) await cache.delete(request);
  }
}

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();

// One promise, in order: clean first, then download what is missing. Any failure rejects the install; the old worker stays.
self.addEventListener('install', (event) => event.waitUntil(dropBadEntries().then(() => precache.install(event))));
self.addEventListener('activate', (event) => event.waitUntil(precache.activate(event)));

registerRoute(new PrecacheRoute(precache));
// Navigations get the cached app, except where Cloudflare or the Worker answers: /api/* (the sign-in renewal, docs/SYNC.md) and
// /cdn-cgi/* (Access's callback after its login: swallowing it never sets the cookie and opens the app at the wrong depth).
registerRoute(new NavigationRoute(precache.createHandlerBoundToURL('index.html'), { denylist: NETWORK_ONLY_PATHS }));
