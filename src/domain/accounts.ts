/**
 * Own accounts (docs/ACCOUNTS_PLAN.md): the rules for usernames, passwords and the codes people copy
 * (invite, recovery), and the wire schemas. Shared by the Worker and the app; no React, no Cloudflare types.
 */
import { z } from 'zod';

/** 32 symbols (no I or O, no 0 or 1), so a code read off a screen can't be mistyped as another. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 12;
export const RECOVERY_LENGTH = 20;

export const SESSION_IDLE_MS = 180 * 24 * 3600_000;
export const SESSION_ABSOLUTE_MS = 365 * 24 * 3600_000;
/** A request renews the session (and the cookie) at most this often, so most requests write nothing. */
export const SESSION_RENEW_AFTER_MS = 24 * 3600_000;
export const MAX_SESSIONS = 20;
export const INVITE_DEFAULT_TTL_MS = 7 * 24 * 3600_000;
export const RESET_TTL_MS = 24 * 3600_000;

/** The slow key derivation runs on the device (see worker/password.ts): OWASP's number for PBKDF2-HMAC-SHA256. */
export const KDF_ITERATIONS = 600_000;
/** Below this the Worker refuses a derived key (a modified client can only weaken its own account). */
export const KDF_MIN_ITERATIONS = 100_000;
export const KDF_MAX_ITERATIONS = 2_000_000;

export const SESSION_COOKIE = '__Host-ptb_session';
export const SESSION_TOKEN_RE = /^ptbs_[A-Za-z0-9_-]{43}$/;

/** Attempts per window, per scope (the Worker answers 429 beyond them). */
export const THROTTLES = {
  loginIp: { windowMs: 10 * 60_000, max: 20 },
  /** Failures only: a wrong password for this username, whether or not it exists. */
  loginUser: { windowMs: 15 * 60_000, max: 8 },
  paramsIp: { windowMs: 10 * 60_000, max: 60 },
  signupIp: { windowMs: 10 * 60_000, max: 10 },
  badInviteIp: { windowMs: 3600_000, max: 5 },
  recoverIp: { windowMs: 3600_000, max: 10 },
  recoverUser: { windowMs: 3600_000, max: 5 },
  passwordUser: { windowMs: 15 * 60_000, max: 8 },
} as const;

// ---------------------------------------------------------------------------
// Codes
// ---------------------------------------------------------------------------

/** Upper-cases and drops everything that is not a letter or digit (spaces, dashes). */
export const normalizeCode = (input: string): string => input.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isCode = (code: string, length: number): boolean => code.length === length && [...code].every((c) => CODE_ALPHABET.includes(c));
/** "K7QM3XWD9PTR" → "K7QM-3XWD-9PTR" (groups of 4); a 20-symbol recovery code uses groups of 5. */
export const formatCode = (code: string): string => code.match(code.length === RECOVERY_LENGTH ? /.{1,5}/g : /.{1,4}/g)?.join('-') ?? code;

/** A fresh code from a random source (injected so tests are deterministic). 256 % 32 = 0, so there is no modulo bias. */
export function generateCode(length: number, random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...random(length)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

// ---------------------------------------------------------------------------
// Usernames and passwords
// ---------------------------------------------------------------------------

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const RESERVED = new Set(['admin', 'administrator', 'root', 'support', 'system', 'ptb', 'staff', 'moderator', 'mod', 'owner', 'help', 'security', 'noreply', 'null', 'undefined', 'me', 'you', 'everyone', 'anonymous']);

/** Names are unique case-insensitively: this is the key. */
export const usernameKey = (name: string): string => name.trim().toLowerCase();

/** Why a username can't be used, or null. */
export function usernameProblem(name: string): string | null {
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return `Usernames are ${USERNAME_MIN}–${USERNAME_MAX} characters.`;
  if (!USERNAME_RE.test(name)) return 'Use letters, digits, “_”, “.” or “-”, starting with a letter or digit.';
  if (RESERVED.has(usernameKey(name))) return 'That username is not available.';
  return null;
}

/** Common passwords of 10 or more characters (shorter ones fail the length rule anyway), compared without case or punctuation. */
const COMMON = new Set(
  [
    '1234567890', '12345678901', '123456789012', '0123456789', '0987654321', '1111111111', '0000000000', '1234512345', 'qwertyuiop', 'qwertyuiop1', 'qwerty1234', 'qwerty12345', 'qwertyuiop123',
    '1q2w3e4r5t', '1q2w3e4r5t6y', '1qaz2wsx3edc', 'asdfghjkl1', 'asdfghjklqwerty', 'zxcvbnm123', 'zxcvbnmasdf', 'password123', 'password1234', 'password12345', 'password123456',
    'passw0rd123', 'passwordpassword', 'p@ssw0rd123', 'changeme123', 'changemenow', 'letmein123', 'letmeinplease', 'welcome123', 'welcome1234', 'welcome12345', 'welcomehome',
    'iloveyou123', 'iloveyou1234', 'iloveyouiloveyou', 'abc1234567', 'abcd123456', 'abcdefghij', 'abcdefghijk', 'abcdefg123', 'admin12345', 'admin123456', 'administrator123',
    'root123456', 'trustno1234', 'superman123', 'batman12345', 'spiderman123', 'football123', 'baseball123', 'basketball1', 'mustang1234', 'dragon12345', 'master12345',
    'monkey12345', 'shadow12345', 'sunshine123', 'princess123', 'charlie1234', 'michael1234', 'jennifer123', 'jessica1234', 'computer123', 'internet123', 'starwars123',
    'pokemon123', 'pokemon1234', 'pokemon12345', 'pikachu123', 'pikachu1234', 'pikachu12345', 'charizard1', 'charizard123', 'pokemonmaster', 'pokemontrainer', 'ilovepokemon',
    'ilovepokemon1', 'gottacatchemall', 'gottacatchemall1', 'teambuilder', 'teambuilder1', 'teambuilder123', 'pokemonteam1', '123qweasdzxc', 'qazwsxedc123', 'qazwsxedcrfv',
    '1234qwer1234', 'q1w2e3r4t5', 'q1w2e3r4t5y6', 'zaq12wsxcde3', '1234567890a', 'a1234567890', 'a123456789', 'aa123456789', 'password2024', 'password2025', 'password2026',
    'summer2025', 'summer2026', 'winter2025', 'winter2026', 'spring2026', 'qwerty2025', 'qwerty2026', 'letmein2026',
  ],
);
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Why a password can't be used, or null. Length counts characters after NFKC, as the Worker hashes. */
export function passwordProblem(password: string, username = ''): string | null {
  const pw = password.normalize('NFKC');
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const flat = squash(pw);
  if (COMMON.has(flat) || /^(.)\1+$/.test(flat)) return 'That password is too common. Pick something longer or less guessable.';
  const user = squash(username);
  if (user.length >= 3 && flat.includes(user)) return 'The password can’t contain your username.';
  return null;
}

// ---------------------------------------------------------------------------
// The key derivation (runs on the device)
// ---------------------------------------------------------------------------

const toB64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** A fresh 16-byte salt for a new password (22 base64url characters). */
export const newSalt = (): string => toB64url(crypto.getRandomValues(new Uint8Array(16)));

/**
 * What the app sends instead of the password: PBKDF2-HMAC-SHA256(NFKC(password), salt, iterations), 32 bytes as 43
 * base64url characters. The server never receives the password itself. Slow on purpose (about a second on a phone).
 */
export async function deriveKey(password: string, salt: string, iterations: number = KDF_ITERATIONS): Promise<string> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return toB64url(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations }, base, 256)));
}

// ---------------------------------------------------------------------------
// The device
// ---------------------------------------------------------------------------

/** "https://host" with no path, or undefined when it isn't an https (or localhost http) address. The desktop app's server address. */
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

/** A readable name for this device in Settings → Account → Devices ("iPhone", "Chrome on Windows", "Desktop app on Mac"). */
export function deviceNameFor(userAgent: string, desktopApp: boolean): string {
  const ua = userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux|X11/.test(ua) ? 'Linux' : '';
  if (desktopApp) return os ? `Desktop app on ${os}` : 'Desktop app';
  if (os === 'iPhone' || os === 'iPad') return os;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return os ? `${browser} on ${os}` : browser;
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

/** Control and invisible formatting characters (bidi overrides, zero-width) are dropped: the name is shown in the device list. */
const deviceName = z.string().max(200).transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).pipe(z.string().min(1).max(40)).default('This device');
/** "cookie": the web app (a session cookie); "token": the desktop app (a bearer token in the answer). */
const mode = z.enum(['cookie', 'token']).default('cookie');
const username = z.string().min(1).max(60);
/** A derived key (32 bytes) and the salt and iterations it was derived with. */
const key = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const salt = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const iterations = z.number().int().min(KDF_MIN_ITERATIONS).max(KDF_MAX_ITERATIONS);
const newKey = z.object({ key, salt, iterations });

export const ParamsSchema = z.object({ username });
export const SignupSchema = z.object({ invite: z.string().max(80), username, key, salt, iterations, deviceName, mode });
export const LoginSchema = z.object({ username, key, deviceName, mode });
export const RecoverSchema = z.object({ username, code: z.string().max(80), key, salt, iterations, deviceName, mode });
export const ChangePasswordSchema = z.object({ current: key, next: newKey });
export const PasswordOnlySchema = z.object({ key });
export const SessionIdSchema = z.object({ id: z.string().min(1).max(64) });
export const MeUpdateSchema = z.object({ displayName: z.string().trim().max(40) });

// Admin (Settings → Account → Admin; every route checks role = 'admin')
const plainText = (max: number) => z.string().max(400).transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).pipe(z.string().max(max));
export const INVITE_TTL_HOURS = { min: 1, max: 30 * 24, default: 7 * 24 } as const;
export const InviteCreateSchema = z.object({ note: plainText(80).optional(), ttlHours: z.number().int().min(INVITE_TTL_HOURS.min).max(INVITE_TTL_HOURS.max).default(INVITE_TTL_HOURS.default) });
export const AdminIdSchema = z.object({ id: z.string().min(1).max(64) });
export const AdminRoleSchema = z.object({ id: z.string().min(1).max(64), role: z.enum(['user', 'admin']) });
/** A password reset needs the admin's own password again (the threat model: a stolen admin session alone can't take over accounts). */
export const AdminResetSchema = z.object({ id: z.string().min(1).max(64), key });

export type InviteStatus = 'open' | 'used' | 'expired' | 'revoked';
export interface InviteInfo {
  /** A short handle for revoking it (not the code, which is never stored or shown again). */
  id: string;
  note?: string;
  createdAt: number;
  expiresAt: number;
  status: InviteStatus;
  /** Username of the account it made. */
  usedBy?: string;
  usedAt?: number;
}
export interface InvitesResponse {
  invites: InviteInfo[];
}
export interface NewInviteResponse extends InvitesResponse {
  /** Shown once, like K7QM-3XWD-9PTR. */
  code: string;
  expiresAt: number;
}
export interface AdminUserInfo {
  id: string;
  username: string;
  displayName?: string;
  role: 'user' | 'admin';
  disabled: boolean;
  createdAt: number;
  invitedBy?: string;
  devices: number;
  lastSeenAt?: number;
}
export interface UsersResponse {
  users: AdminUserInfo[];
}
export interface ResetCodeResponse extends UsersResponse {
  /** 20 symbols in groups of 5, valid 24 hours, once. Shown once. */
  code: string;
  expiresAt: number;
}

/** What POST /api/auth/params answers: how to derive this username's key. Unknown names get a stable fake. */
export interface KdfParams {
  salt: string;
  iterations: number;
}

export interface AccountUser {
  id: string;
  username: string;
  displayName?: string;
  role: 'user' | 'admin';
}
export interface AuthResponse {
  user: AccountUser;
  /** The desktop app's bearer token (mode "token" only). The web app's session is a cookie. */
  token?: string;
  expiresAt: number;
  /** Shown once: signup and password recovery. */
  recoveryCode?: string;
}
export interface SessionInfo {
  id: string;
  name: string;
  kind: 'web' | 'desktop';
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}
export interface SessionsResponse {
  sessions: SessionInfo[];
}
