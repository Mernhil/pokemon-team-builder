/** Small response and request helpers shared by the Worker's route modules. */
import { LIMITS } from '../src/domain/syncProtocol';
import type { Env } from './types';

export const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
export const reply = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
export const fail = (status: number, error: string, extra: Record<string, string> = {}) => reply(status, { error }, extra);

/** The desktop app's webview origins. A linked device sends a bearer token (never cookies), so this only lets its page read the answers. */
const DEVICE_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];
export const deviceOrigins = (env: Env) => new Set([...DEVICE_ORIGINS, ...(env.DEVICE_EXTRA_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)]);
export const withCors = (res: Response, origin: string | null, env: Env): Response => {
  if (!origin || !deviceOrigins(env).has(origin)) return res;
  const r = new Response(res.body, res);
  r.headers.set('access-control-allow-origin', origin);
  r.headers.set('vary', 'origin');
  return r;
};
export const preflight = (origin: string | null, env: Env): Response =>
  withCors(new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET, POST, PUT, DELETE', 'access-control-allow-headers': 'authorization, content-type, x-ptb', 'access-control-max-age': '86400' } }), origin, env);

/** Refuses an oversized body from its declared length, before the Worker reads (and holds) all of it. */
export const declaredTooLarge = (request: Request, max: number): boolean => {
  const n = Number(request.headers.get('content-length'));
  // A character is at most 3 bytes in UTF-8, so only a length past 3x the limit is certain to be too big.
  return Number.isFinite(n) && n > max * 3;
};

export async function readJson(request: Request, max = LIMITS.maxBodyChars): Promise<{ body: unknown } | { response: Response }> {
  if (declaredTooLarge(request, max)) return { response: fail(413, 'request too large') };
  const text = await request.text();
  if (text.length > max) return { response: fail(413, 'request too large') };
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { response: fail(400, 'body is not JSON') };
  }
}
export const firstIssue = (e: { issues: { path: PropertyKey[]; message: string }[] }) => `invalid request at ${e.issues[0].path.join('.') || '(root)'}: ${e.issues[0].message}`;
