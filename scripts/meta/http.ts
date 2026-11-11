/**
 * Polite fetching for `npm run meta`: an identifying User-Agent, a timeout, a couple of retries on
 * 429/5xx with backoff, and a small concurrency pool so a few thousand replay requests don't hammer
 * anyone's server.
 */
const USER_AGENT = 'pokemon-team-builder meta build (+https://github.com/Mernhil/pokemon-team-builder)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET `url`; null on 404 and similar "not there" answers, throws on repeated server/network errors. */
export async function get(url: string, headers: Record<string, string> = {}): Promise<Response | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1000 * 2 ** attempt);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return res;
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new HttpDenied(url, res.status);
      return null;
    } catch (e) {
      if (e instanceof HttpDenied) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function getJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await get(url, { Accept: 'application/json', ...headers });
  return res ? ((await res.json()) as unknown) : null;
}

/** The server refused (needs a key, or blocks this client). */
export class HttpDenied extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number) {
    super(`HTTP ${status} from ${url}`);
    this.url = url;
    this.status = status;
  }
}

export { pool } from '../lib/pool.ts';
