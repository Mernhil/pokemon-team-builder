import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8');

const directives = (csp: string) => new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1)] as const));

describe('deployed headers (public/_headers)', () => {
  const text = read('public/_headers');
  const value = (name: string) => new RegExp(`^\\s+${name}:\\s*(.+)$`, 'mi').exec(text)?.[1].trim();

  it('has the standard protections', () => {
    expect(value('X-Content-Type-Options')).toBe('nosniff');
    expect(value('X-Frame-Options')).toBe('DENY');
    expect(value('Referrer-Policy')).toBe('no-referrer');
    expect(value('Permissions-Policy')).toContain('camera=()');
    expect(value('Strict-Transport-Security')).toMatch(/max-age=\d{7,}/);
  });

  it('has a CSP that allows only itself, no eval, no framing and no plugins', () => {
    const csp = directives(value('Content-Security-Policy')!);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(value('Content-Security-Policy')).not.toMatch(/unsafe-eval|localhost|\*/);
  });
});

describe('desktop app (src-tauri)', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json')) as { app: { security: { csp: string } }; plugins: { updater: { pubkey: string; endpoints: string[] } } };
  const caps = JSON.parse(read('src-tauri/capabilities/default.json')) as { permissions: string[] };

  it('has a CSP without script holes', () => {
    const csp = directives(conf.app.security.csp);
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(conf.app.security.csp).not.toMatch(/unsafe-eval|unsafe-inline.*script-src/);
  });

  it('updates only from https, signed with the key committed next to it', () => {
    expect(conf.plugins.updater.endpoints.every((e) => e.startsWith('https://'))).toBe(true);
    expect(conf.plugins.updater.pubkey).toBe(read('src-tauri/updater.key.pub').trim());
  });

  it('asks for no filesystem, shell, HTTP or opener permission', () => {
    expect(caps.permissions.filter((p) => /^(fs|shell|http|opener|dialog|os|clipboard)/.test(p))).toEqual([]);
  });

  it('keeps developer tools off in release builds (no `devtools` feature on tauri)', () => {
    const cargo = read('src-tauri/Cargo.toml');
    expect(/^tauri\s*=.*devtools/m.test(cargo)).toBe(false);
  });
});
