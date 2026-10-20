import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { SESSION_TOKEN_RE, normalizeServer, type AccountUser, type ClaimState } from '@/domain/accounts';
import { safeStorage } from '@/store/storage';

/**
 * Who this device is signed in as (docs/ACCOUNTS.md), kept in `ptb:session:v1`. Not synced.
 *
 * - Web and the phone app: the session itself is an HttpOnly cookie the app's code can't read; this store only
 *   remembers the user to show (name, role) and whether the server has since said the session ended.
 * - Desktop app: also the server address and the bearer token (`ptbs_…`), which only this device holds and
 *   which can be revoked from any other device (Settings → Account → Devices).
 */
export type AccountsAvailability = 'unknown' | 'off' | 'on';

interface AccountState {
  user?: AccountUser;
  /** The desktop app's server ("https://host"); the web app talks to its own origin. */
  server?: string;
  /** The desktop app's session token. Never set on the web, where the session is a cookie. */
  token?: string;
  expiresAt?: number;
  /** The server answered "not signed in" while this device thought it was: the banner offers to sign in again. */
  expired: boolean;
  /** The expired-sign-in banner was closed; it comes back the next time a session ends. */
  bannerDismissed: boolean;
  /** "Make an account to sync and share" was dismissed (or an account was made). */
  cardDismissed: boolean;
  /** Does the server have accounts switched on (learnt at start; not stored)? */
  availability: AccountsAvailability;
  /** Has this account brought over (or skipped) the data synced before accounts, and can it now? From GET /api/me. */
  claim?: ClaimState;
  claimAvailable?: boolean;
  /** Friend requests waiting for my answer (the dot on Settings). Not stored. */
  incomingFriends: number;
  /** The account this device last signed in as (kept after logging out), so a different account starts sync afresh. */
  lastUserId?: string;

  signIn: (s: { user: AccountUser; token?: string; expiresAt?: number }) => void;
  setUser: (user: AccountUser) => void;
  setServer: (server: string) => void;
  /** Forget the session on this device (log out, or revoked). The server address stays. */
  signOut: () => void;
  markExpired: () => void;
  dismissBanner: () => void;
  dismissCard: () => void;
  setAvailability: (a: AccountsAvailability) => void;
  setClaim: (claim: ClaimState, available?: boolean) => void;
  setIncomingFriends: (n: number) => void;
}

const ROLES = new Set(['user', 'admin']);
/** A stored user as the app can show it; anything else is dropped. */
export function sanitizeUser(u: unknown): AccountUser | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const x = u as Record<string, unknown>;
  if (typeof x.id !== 'string' || !x.id || x.id.length > 64) return undefined;
  if (typeof x.username !== 'string' || !x.username || x.username.length > 60) return undefined;
  const role = typeof x.role === 'string' && ROLES.has(x.role) ? (x.role as AccountUser['role']) : 'user';
  const displayName = typeof x.displayName === 'string' && x.displayName ? x.displayName.slice(0, 40) : undefined;
  return { id: x.id, username: x.username, role, ...(displayName ? { displayName } : {}) };
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set) => ({
      expired: false,
      bannerDismissed: false,
      cardDismissed: false,
      availability: 'unknown',
      incomingFriends: 0,
      signIn: ({ user, token, expiresAt }) => set({ user, lastUserId: user.id, token: token && SESSION_TOKEN_RE.test(token) ? token : undefined, expiresAt, expired: false, bannerDismissed: false, cardDismissed: true, availability: 'on' }),
      setUser: (user) => set({ user, expired: false }),
      setServer: (server) => set({ server: normalizeServer(server) }),
      signOut: () => set({ user: undefined, token: undefined, expiresAt: undefined, expired: false, bannerDismissed: false, claim: undefined, claimAvailable: undefined, incomingFriends: 0 }),
      markExpired: () => set((s) => (s.user ? { expired: true, token: undefined, bannerDismissed: s.expired ? s.bannerDismissed : false } : {})),
      dismissBanner: () => set({ bannerDismissed: true }),
      dismissCard: () => set({ cardDismissed: true }),
      setAvailability: (availability) => set({ availability }),
      setIncomingFriends: (incomingFriends) => set({ incomingFriends }),
      setClaim: (claim, available) => set((s) => ({ claim, claimAvailable: available ?? s.claimAvailable })),
    }),
    {
      name: 'ptb:session:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ user: s.user, server: s.server, token: s.token, expiresAt: s.expiresAt, expired: s.expired, cardDismissed: s.cardDismissed, claim: s.claim, lastUserId: s.lastUserId }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AccountState>;
        const user = sanitizeUser(p.user);
        const server = typeof p.server === 'string' ? normalizeServer(p.server) : undefined;
        const token = user && typeof p.token === 'string' && SESSION_TOKEN_RE.test(p.token) ? p.token : undefined;
        return {
          ...current,
          user,
          server,
          token,
          expiresAt: user && typeof p.expiresAt === 'number' ? p.expiresAt : undefined,
          expired: user ? p.expired === true : false,
          cardDismissed: p.cardDismissed === true,
          lastUserId: typeof p.lastUserId === 'string' && p.lastUserId.length <= 64 ? p.lastUserId : undefined,
          claim: user && (p.claim === 'pending' || p.claim === 'claimed' || p.claim === 'skipped') ? p.claim : undefined,
        };
      },
    },
  ),
);

/** Signed in, as far as this device knows (the server has the last word on the next request). */
export const isSignedIn = (s: Pick<AccountState, 'user' | 'expired'> = useAccountStore.getState()): boolean => Boolean(s.user && !s.expired);
