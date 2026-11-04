/**
 * What the service worker may keep in the app's precache and what it must leave to the network (sw/sw.ts). Pure: no
 * service-worker or DOM globals, so it is unit-tested (swGuard.test.ts).
 *
 * Behind Cloudflare Access (and with the Worker's single-page-application fallback) a request for a file can come back as a
 * redirect to the login page, or as `index.html` with a 200. Workbox keys a hashed file by its URL alone and never fetches it
 * again, so one bad answer at install time would be served as that script or stylesheet for good.
 */

/** Paths Cloudflare or the Worker owns: a navigation there is never the app's `index.html` (it would load at the wrong depth, with its relative `./assets/` URLs pointing nowhere). */
export const NETWORK_ONLY_PATHS: RegExp[] = [/^\/api\//, /^\/cdn-cgi\//];

/** The content type a file with this extension must come back as. Unknown extensions only have to not be a web page. */
const EXPECTED: Record<string, RegExp> = {
  js: /^(text|application)\/(javascript|x-javascript|ecmascript)\b/i,
  mjs: /^(text|application)\/(javascript|x-javascript|ecmascript)\b/i,
  css: /^text\/css\b/i,
  json: /^application\/(json|[\w.+-]+\+json)\b/i,
  webmanifest: /^application\/([\w.+-]+\+json|json|manifest\+json)\b/i,
  html: /^text\/html\b/i,
  png: /^image\//i,
  webp: /^image\//i,
  svg: /^image\//i,
  ico: /^image\//i,
};

const extensionOf = (url: string): string => {
  const path = new URL(url, 'https://x.invalid').pathname;
  return path.slice(path.lastIndexOf('/') + 1).split('.').slice(1).pop()?.toLowerCase() ?? '';
};

/**
 * The game of an Atlas data chunk (`assets/atlas-platinum-<hash>.js` → `platinum`), or null for any other URL. These chunks are
 * ~9 MB together, so the worker does not precache them: it keeps each one the first time that game's Atlas opens
 * (vite.config.ts `globIgnores`, sw/sw.ts), and drops an older build of the same game when a new one is stored.
 */
export function atlasChunkGame(url: string): string | null {
  return /\/assets\/atlas-([a-z0-9]+)-[\w-]+\.js$/.exec(new URL(url, 'https://x.invalid').pathname)?.[1] ?? null;
}

export interface PrecacheVerdict { ok: boolean; reason?: string }

/**
 * Is this response what the precache entry for `url` should hold? `html` is the body, needed only for `.html` entries (the
 * app's `index.html` must have the app's root, not an Access login page that also happens to be HTML).
 */
export function checkPrecacheResponse(
  url: string,
  res: { status: number; type: string; redirected: boolean; contentType: string | null },
  html?: string,
): PrecacheVerdict {
  if (res.type === 'opaque' || res.type === 'opaqueredirect') return { ok: false, reason: `an opaque ${res.type} answer` };
  if (res.redirected) return { ok: false, reason: 'it was redirected (an Access login?)' };
  if (res.status !== 200) return { ok: false, reason: `status ${res.status}` };
  const ext = extensionOf(url);
  const type = res.contentType ?? '';
  const expected = EXPECTED[ext];
  if (expected ? !expected.test(type) : /^text\/html\b/i.test(type)) return { ok: false, reason: `content type "${type || 'none'}" for a .${ext || 'extensionless'} file` };
  if (ext === 'html' && html !== undefined && !/id=["']root["']/.test(html)) return { ok: false, reason: 'an HTML page that is not the app' };
  return { ok: true };
}
