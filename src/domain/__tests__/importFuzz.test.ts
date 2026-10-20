import { describe, expect, it } from 'vitest';
import data from '@/data/generated/champions.json';
import { Dex } from '@/data/dex';
import { getFormat } from '@/domain/formats';
import { decodeShareString, importShowdown, parseBackup } from '@/domain/codecs';
import { parsePairingInput } from '@/domain/pairing';
import { sanitizeMatch, sanitizeTeam } from '@/domain/sanitize';
import type { Dataset } from '@/domain/types';

const dex = new Dex(data as unknown as Dataset);
const fmt = getFormat('champions-vgc-reg-mc');

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const share = (payload: unknown) => `PTB1.${b64(JSON.stringify(payload) ?? 'null')}`;
const nested = (depth: number, open: string, close: string) => open.repeat(depth) + close.repeat(depth);

/** An importer may refuse (throw an Error: the dialogs show its message) or return something clean; it must never hang or throw a non-Error. */
function safely<T>(run: () => T): { ok: true; value: T } | { ok: false } {
  const t0 = performance.now();
  try {
    const value = run();
    expect(performance.now() - t0).toBeLessThan(3000);
    return { ok: true, value };
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    expect(performance.now() - t0).toBeLessThan(3000);
    return { ok: false };
  }
}

const JUNK: unknown[] = [null, undefined, 0, -1, 1e308, NaN, '', 'x', '__proto__', true, [], {}, [null], [[]], { __proto__: null }, JSON.parse('{"__proto__":{"polluted":1}}'), 'a'.repeat(100_000), { a: { b: { c: {} } } }];

describe('importers fail safely', () => {
  it('share codes: garbage, wrong shapes, huge and deeply nested payloads', () => {
    const codes = [
      '',
      'PTB1.',
      'PTB1.!!!!',
      'PTB1.' + b64('not json'),
      'PTB1.' + b64('null'),
      'PTB1.' + b64('[]'),
      'PTB1.' + b64('{"s":"x"}'),
      share({ v: 1, n: 'x', f: 'champions-vgc-reg-mc', s: [null, 0, 'x', [], [{}], [[]], [1, 2, 3]] }),
      share({ v: 1, n: 'x', f: 'champions-vgc-reg-mc', s: [[{}, {}, {}, {}, {}, {}]] }),
      share({ v: 1, n: 'x', f: 'champions-vgc-reg-mc', s: [], mn: [null, 1, 'x', { t: {}, x: [] }] }),
      share({ v: 1, n: 'x'.repeat(1_000_000), f: 'x', s: Array(5000).fill(0) }),
      'PTB1.' + b64(nested(50_000, '[', ']')),
      'PTB1.' + b64(`{"s":${nested(50_000, '[', ']')}}`),
      'PTB1.' + 'A'.repeat(2_000_000),
      ...JUNK.map((j) => share(j)),
      ...JUNK.map((j) => share({ v: 1, n: j, f: j, s: [[j, j, j, j, j, j, j, j, j, j, j, j]], tn: j, mn: [{ t: j, x: j, l: j }] })),
    ];
    for (const c of codes) {
      const r = safely(() => decodeShareString(c, dex, fmt));
      if (r.ok) {
        expect(r.value.slots).toHaveLength(6);
        expect(r.value.name.length).toBeLessThanOrEqual(200);
      }
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('backups: wrong app, too many teams, junk teams, deep nesting', () => {
    const files = [
      '',
      '{',
      'null',
      '[]',
      '{"app":"pokemon-team-builder"}',
      JSON.stringify({ app: 'pokemon-team-builder', teams: Array(1001).fill({}) }),
      JSON.stringify({ app: 'pokemon-team-builder', teams: JUNK }),
      JSON.stringify({ app: 'pokemon-team-builder', teams: [{ id: 'x', slots: JUNK, name: 'a'.repeat(1e6), formatId: 'champions-vgc-reg-mc' }] }),
      `{"app":"pokemon-team-builder","teams":${nested(50_000, '[', ']')}}`,
      '{"app":"pokemon-team-builder","teams":[{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}]}',
    ];
    for (const f of files) {
      const r = safely(() => parseBackup(f));
      if (r.ok) expect(r.value.length).toBeLessThanOrEqual(1000);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('Showdown paste: odd lines, huge and repeated blocks', () => {
    const pastes = [
      '',
      '\n\n\n',
      '@',
      ' @ ',
      '(',
      '()',
      'a (b) (c) (d) @ e @ f',
      '- ',
      'EVs: ' + '1 HP / '.repeat(100_000),
      'IVs: x / y / z',
      'Garchomp\n' + '- Earthquake\n'.repeat(100_000),
      ('Garchomp @ Garchompite\nAbility: Rough Skin\n- Protect\n\n').repeat(50_000),
      'Level: 99999999999999999999\nShiny: yes\nHappiness: -1\nGarchomp',
      '=== [gen9] Team ===\n\n=== [x] y ===',
      '\u0000‮<script>alert(1)</script>',
      'Garchomp'.repeat(200_000),
      '<img src=x onerror=alert(1)> (Garchomp)',
    ];
    for (const p of pastes) {
      const r = safely(() => importShowdown(p, dex, fmt));
      if (r.ok) {
        expect(r.value.team.slots).toHaveLength(6);
        // A note or name keeps its characters as text; React escapes them, so nothing is executed. Length stays bounded.
        expect(r.value.team.name.length).toBeLessThanOrEqual(200);
      }
    }
  });

  it('sanitisers accept anything and return a clean value or null', () => {
    for (const j of [...JUNK, nested(10, '[', ']'), JSON.parse(nested(2000, '[', ']'))]) {
      expect(safely(() => sanitizeTeam(j)).ok).toBe(true);
      expect(safely(() => sanitizeMatch(j)).ok).toBe(true);
    }
  });

  it('pairing input: odd strings never throw', () => {
    for (const s of ['', ' ', 'https://', 'https://x#pair=', 'https://x#pair=' + 'A'.repeat(1e6), '#pair=ABCDE-FGHJK', 'javascript:alert(1)#pair=ABCDE-FGHJK', 'http://[::1#pair=ABCDE-FGHJK', 'ABCDE-FGHJK\u0000', 'https://' + 'a'.repeat(1e5) + '/#pair=ABCDE-FGHJK']) {
      const r = safely(() => parsePairingInput(s));
      if (r.ok && r.value?.server) expect(r.value.server).toMatch(/^https?:\/\//);
    }
  });
});
