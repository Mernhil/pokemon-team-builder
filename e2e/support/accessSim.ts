import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A stand-in for the production setup, in front of the real `dist/` build: Cloudflare Access on the app's hostname, the
 * Worker's `/api/*`, and the static assets with `not_found_handling: single-page-application` (wrangler.jsonc). Just enough
 * of each to run the sign-in round trip with the real service worker:
 *
 *  - no valid `CF_Authorization` cookie: every request on the app's origin answers `302` to the login page on ANOTHER origin
 *    (Access's team domain), as Access does;
 *  - the login page links back to `<app>/cdn-cgi/access/callback?code=…&state=…`; Access (not the Worker) answers that one
 *    path: it sets the cookie and sends the browser on to the page that asked for the login;
 *  - `/api/session/renew` is `302 /` when signed in; `/api/sync` and friends answer like an empty account;
 *  - any other path that is not a file is `index.html` with a 200 (the single-page-application fallback), except `/cdn-cgi/…`,
 *    which Cloudflare owns and which is 404 when it is not Access.
 *
 * `hits` records what actually reached the server, so a test can say which URL the service worker kept from the network.
 */
export interface Hit { path: string; status: number }

export interface AccessSim {
  appOrigin: string;
  loginOrigin: string;
  /** What reached the server since the last `reset()`. */
  hits: Hit[];
  /** Sign the browser out: the cookie it holds stops being accepted. */
  expireSession: () => void;
  /** Answer these paths with another status/body (a deploy half-way, a proxy's login page, ...). */
  override: (pathPattern: RegExp, respond: ((res: ServerResponse) => void) | null) => void;
  reset: () => void;
  close: () => Promise<void>;
}

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
// The Content-Security-Policy the deploy sends (public/_headers, plus the boot guard's hash that the build adds): the pages are served with it, so a
// script the policy would refuse fails here as it would in production.
const CSP = /Content-Security-Policy:\s*(.+)/.exec(readFileSync(join(DIST, '_headers'), 'utf-8'))?.[1].trim() ?? '';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain',
};

export async function startAccessSim(appPort: number, loginPort: number): Promise<AccessSim> {
  const appOrigin = `http://localhost:${appPort}`;
  const loginOrigin = `http://127.0.0.1:${loginPort}`;
  let epoch = 1; // a cookie holds the epoch it was issued in
  let hits: Hit[] = [];
  const overrides: { pattern: RegExp; respond: (res: ServerResponse) => void }[] = [];
  const cookieOk = (req: IncomingMessage) => (req.headers.cookie ?? '').split(/;\s*/).includes(`CF_Authorization=${epoch}`);

  const send = (req: IncomingMessage, res: ServerResponse, status: number, headers: Record<string, string>, body?: string | Buffer) => {
    hits.push({ path: req.url ?? '', status });
    res.writeHead(status, headers);
    res.end(body);
  };
  const json = (req: IncomingMessage, res: ServerResponse, body: unknown, status = 200) => send(req, res, status, { 'content-type': 'application/json', 'cache-control': 'no-store' }, JSON.stringify(body));

  const app = createServer((req, res) => {
    const url = new URL(req.url ?? '/', appOrigin);
    const path = url.pathname;
    // Access owns this path on the app's hostname: the Worker and the assets never see it.
    if (path === '/cdn-cgi/access/callback') {
      const back = url.searchParams.get('state') || '/';
      return send(req, res, 302, { location: back, 'set-cookie': `CF_Authorization=${epoch}; Path=/; HttpOnly; SameSite=Lax`, 'cache-control': 'no-store' });
    }
    if (!cookieOk(req)) {
      const back = encodeURIComponent(url.pathname + url.search);
      return send(req, res, 302, { location: `${loginOrigin}/cdn-cgi/access/login/app?redirect_url=${back}`, 'cache-control': 'no-store' });
    }
    const forced = overrides.find((o) => o.pattern.test(path));
    if (forced) {
      hits.push({ path: req.url ?? '', status: -1 });
      return forced.respond(res);
    }
    if (path === '/api/session/renew') return send(req, res, 302, { location: '/', 'cache-control': 'no-store' });
    if (path.startsWith('/api/')) {
      if (path === '/api/sync') return json(req, res, req.method === 'GET' ? { docs: [], cursor: 0, more: false } : { results: [] });
      if (path === '/api/shares') return json(req, res, { me: { email: 'me@example.com' }, granted: [], received: [], names: {} });
      if (path === '/api/shared') return json(req, res, { docs: [], names: {} });
      return json(req, res, { error: 'not found' }, 404);
    }
    if (path.startsWith('/cdn-cgi/')) return send(req, res, 404, { 'content-type': 'text/plain' }, 'not found');
    const file = normalize(join(DIST, path));
    const found = file.startsWith(DIST) && existsSync(file) && statSync(file).isFile() ? file : join(DIST, 'index.html');
    // What Workers static assets send: always revalidate (an ETag-less 200 here, so effectively always refetch).
    const cache = 'public, max-age=0, must-revalidate';
    send(req, res, 200, { 'content-type': TYPES[extname(found)] ?? 'application/octet-stream', 'cache-control': cache, 'x-content-type-options': 'nosniff', 'content-security-policy': CSP }, readFileSync(found));
  });

  const login = createServer((req, res) => {
    const url = new URL(req.url ?? '/', loginOrigin);
    const back = url.searchParams.get('redirect_url') ?? '/';
    const href = `${appOrigin}/cdn-cgi/access/callback?code=abc123&state=${encodeURIComponent(back)}`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>Cloudflare Access</title><h1>Sign in to continue</h1><a id="continue" href="${href}">Log in</a>`);
  });

  const listen = (server: Server, port: number) => new Promise<void>((resolve) => server.listen(port, resolve));
  await Promise.all([listen(app, appPort), listen(login, loginPort)]);
  const close = (server: Server) => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });

  return {
    appOrigin,
    loginOrigin,
    get hits() { return hits; },
    expireSession: () => { epoch += 1; },
    override: (pattern, respond) => {
      const at = overrides.findIndex((o) => String(o.pattern) === String(pattern));
      if (at >= 0) overrides.splice(at, 1);
      if (respond) overrides.push({ pattern, respond });
    },
    reset: () => { hits = []; },
    close: async () => { await Promise.all([close(app), close(login)]); },
  };
}
