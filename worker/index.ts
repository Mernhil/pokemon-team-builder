/**
 * The Worker behind the app: it answers /api/* (cloud sync, worker/api.ts) and hands everything
 * else to the static assets, so the app itself is served exactly as before. `run_worker_first` in
 * wrangler.jsonc routes only /api/* here.
 */
import { handleApi } from './api';
import { JSON_HEADERS } from './http';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (e) {
        // A database or runtime error: the app gets JSON it can retry on, never a stack trace. Only the error's name is logged
        // (its message could hold a query's values).
        console.error('api error', e instanceof Error ? e.name : typeof e);
        return new Response(JSON.stringify({ error: 'something went wrong on the server: try again in a moment' }), { status: 500, headers: JSON_HEADERS });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
