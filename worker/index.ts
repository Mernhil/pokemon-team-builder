/**
 * The Worker behind the app: it answers /api/* (cloud sync, worker/api.ts) and hands everything
 * else to the static assets, so the app itself is served exactly as before. `run_worker_first` in
 * wrangler.jsonc routes only /api/* here.
 */
import { handleApi } from './api';
import type { Env } from './types';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};
