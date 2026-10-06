import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_LENGTH, formatCode, generateCode, isValidCode, normalizeCode, normalizeServer, parsePairingInput } from '../pairing';

describe('pairing codes', () => {
  it('generates codes from the alphabet, from any random bytes', () => {
    const code = generateCode((n) => Uint8Array.from({ length: n }, (_, i) => i * 37));
    expect(code).toHaveLength(CODE_LENGTH);
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    expect(generateCode()).not.toBe(generateCode());
  });
  it('formats and normalises', () => {
    expect(formatCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
    expect(normalizeCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(isValidCode('ABCDEFGHJK')).toBe(true);
    expect(isValidCode('ABCDEFGHJ0')).toBe(false);
    expect(isValidCode('ABC')).toBe(false);
  });
  it('reads what a player pastes', () => {
    expect(parsePairingInput('abcde-fghjk')).toEqual({ code: 'ABCDEFGHJK' });
    expect(parsePairingInput('https://app.workers.dev/#pair=ABCDE-FGHJK')).toEqual({ server: 'https://app.workers.dev', code: 'ABCDEFGHJK' });
    expect(parsePairingInput('https://app.workers.dev/some/path#pair=ABCDE-FGHJK')?.server).toBe('https://app.workers.dev');
    expect(parsePairingInput('nonsense')).toBeNull();
    expect(parsePairingInput('http://evil.example/#pair=ABCDE-FGHJK')).toBeNull();
  });
  it('accepts https servers (or local http) only', () => {
    expect(normalizeServer('app.workers.dev')).toBe('https://app.workers.dev');
    expect(normalizeServer('https://app.workers.dev/x')).toBe('https://app.workers.dev');
    expect(normalizeServer('http://localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeServer('http://app.workers.dev')).toBeUndefined();
    expect(normalizeServer('javascript:alert(1)')).toBeUndefined();
  });
});
