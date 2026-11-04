import { describe, expect, it, vi } from 'vitest';
import worker from '../index';
import { declaredTooLarge, reply } from '../http';
import { makeEnv } from './helpers';
import type { Env } from '../types';

describe('declaredTooLarge', () => {
  const req = (len?: string) => new Request('https://app.example/api/sync', { method: 'POST', headers: len === undefined ? {} : { 'content-length': len }, body: 'x' });
  it('refuses only a length that is certainly over the limit', () => {
    expect(declaredTooLarge(req('100'), 1000)).toBe(false);
    expect(declaredTooLarge(req('3000'), 1000)).toBe(false); // could still be 1000 three-byte characters
    expect(declaredTooLarge(req('3001'), 1000)).toBe(true);
    expect(declaredTooLarge(req('99999999999'), 1000)).toBe(true);
  });
  it('lets a request without a length (or with a bad one) through to the real check', () => {
    expect(declaredTooLarge(req(), 1000)).toBe(false);
    expect(declaredTooLarge(req('abc'), 1000)).toBe(false);
  });
});

describe('Worker answers', () => {
  it('JSON answers say nosniff', () => {
    expect(reply(200, {}).headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('a failing database gives JSON, not a stack trace', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = {
      ...makeEnv(),
      AUTH_MODE: 'accounts',
      DB: {
        prepare() {
          throw new Error('D1_ERROR: secret details SELECT * FROM users');
        },
      },
    } as unknown as Env;
    const res = await worker.fetch(new Request('https://app.example/api/sync', { headers: { cookie: '__Host-ptb_session=ptbs_' + 'A'.repeat(43) } }), env);
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/json');
    const text = await res.text();
    expect(text).not.toContain('secret');
    expect(text).not.toContain('SELECT');
    expect(spy).toHaveBeenCalledWith('api error', 'Error');
    spy.mockRestore();
  });
});
