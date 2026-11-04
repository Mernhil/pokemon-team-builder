import { describe, expect, it } from 'vitest';
import { setupMessage } from '../http';

const res = (body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 501 });

describe('setupMessage', () => {
  it('says the database is not bound', async () => {
    expect(await setupMessage(res({ missing: ['DB'] }))).toContain('D1 database isn’t bound');
  });
  it('names the Access settings that are missing', async () => {
    expect(await setupMessage(res({ missing: ['ACCESS_AUD'] }))).toContain('ACCESS_AUD isn’t set');
    expect(await setupMessage(res({ missing: ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD'] }))).toContain('ACCESS_TEAM_DOMAIN and ACCESS_AUD aren’t set');
  });
  it('combines both, and still works for an older Worker or a non-JSON body', async () => {
    expect(await setupMessage(res({ missing: ['DB', 'ACCESS_AUD'] }))).toMatch(/D1 database.*; ACCESS_AUD/);
    expect(await setupMessage(res({ error: 'sync is not set up' }))).toContain('docs/SYNC.md');
    expect(await setupMessage(res('<html>'))).toContain('docs/SYNC.md');
  });
});
