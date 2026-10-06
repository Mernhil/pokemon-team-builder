/**
 * Linking a desktop app to an account (docs/SYNC.md). A signed-in device asks the Worker for a
 * pairing code; the desktop app trades it for a device token. Shared by the Worker and the app.
 */
import { z } from 'zod';

/** 32 symbols (no I or O, no 0 or 1), so a code read off a screen can't be mistyped as another. 10 symbols = 50 bits. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 10;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_LIVE_CODES = 5;
export const MAX_DEVICES = 10;
/** Redeem attempts one client address may make per window (the Worker answers 429 beyond it). */
export const REDEEM_WINDOW_MS = 10 * 60 * 1000;
export const MAX_REDEEMS_PER_WINDOW = 10;

export const TOKEN_RE = /^ptbd_[A-Za-z0-9_-]{43}$/;

/** Upper-cases and drops everything that is not a letter or digit (spaces, dashes). */
export const normalizeCode = (input: string): string => input.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isValidCode = (code: string): boolean => code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
/** "ABCDEFGHJK" → "ABCDE-FGHJK". */
export const formatCode = (code: string): string => `${code.slice(0, 5)}-${code.slice(5)}`;

/** A fresh code from a random source (injected so tests are deterministic). 256 % 32 = 0, so there is no modulo bias. */
export function generateCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...random(CODE_LENGTH)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/**
 * What a player pastes into the desktop app: the bare code ("ABCDE-FGHJK") or the link string the
 * web app copies ("https://host/#pair=ABCDE-FGHJK", which also carries the server).
 */
export function parsePairingInput(text: string): { server?: string; code: string } | null {
  const t = text.trim();
  const m = /^(https?:\/\/[^\s#?]+)\/?[^\s]*?#pair=([A-Za-z0-9-]+)$/i.exec(t);
  if (m) {
    const code = normalizeCode(m[2]);
    const server = normalizeServer(m[1]);
    return isValidCode(code) && server ? { server, code } : null;
  }
  const code = normalizeCode(t);
  return isValidCode(code) ? { code } : null;
}

/** "https://host" with no path, or undefined when it isn't an https (or localhost http) address. */
export function normalizeServer(input: string): string | undefined {
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return undefined;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return undefined;
  return u.origin;
}

export const RedeemSchema = z.object({
  code: z.string().max(40).transform(normalizeCode).refine(isValidCode, { message: 'not a pairing code' }),
  // Control and invisible formatting characters (bidi overrides, zero-width) are dropped: the name is shown in the device list.
  name: z.string().max(200).transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).pipe(z.string().min(1).max(40)),
});

export interface PairResponse {
  /** The code, without the dash. */
  code: string;
  expiresAt: number;
}
export interface RedeemResponse {
  token: string;
  owner: string;
}
export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
}
export interface DevicesResponse {
  devices: DeviceInfo[];
}
