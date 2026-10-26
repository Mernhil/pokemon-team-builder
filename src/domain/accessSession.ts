/**
 * Has Cloudflare Access ended this device's sign-in? Pure, so the browser client and its tests share one rule
 * (src/sync/http.ts, docs/SYNC.md → *Sign-in expired*). The client asks with `redirect: 'manual'`, so an expired session
 * is a redirect to the login page that it sees instead of follows.
 */
export interface ApiAnswer {
  /** `Response.type`: 'opaqueredirect' is what a manual redirect looks like. */
  type?: string;
  status: number;
  /** The browser did follow a redirect before answering. */
  redirected?: boolean;
  /** `Response.url`: after a followed redirect, the page that answered. */
  url?: string;
}

const ACCESS_HOST = /(^|\.)cloudflareaccess\.com$/i;

/** True when this answer from /api/* is the end of the sign-in (Access's redirect or login page, or the Worker's own 401/403), not data. */
export function accessSessionEnded(a: ApiAnswer): boolean {
  if (a.type === 'opaqueredirect') return true;
  if (a.status === 401 || a.status === 403) return true;
  if (a.status >= 300 && a.status < 400) return true;
  if (a.redirected && a.url) {
    try {
      return ACCESS_HOST.test(new URL(a.url).hostname);
    } catch {
      return false;
    }
  }
  return false;
}

/** The installed home-screen app: iOS keeps its cookies apart from Safari's, so signing in from Safari doesn't sign the app in. */
export interface Context {
  standalone: boolean;
  /** This phone holds a device token from a pairing code. */
  linked: boolean;
  desktop: boolean;
}

export const SIGNIN_MESSAGE = 'Your sign-in has expired. Tap Sign in again.';
export const PHONE_EXPIRED_MESSAGE = 'Session expired: link this phone with a code, or sign in from Safari.';
export const PHONE_UNLINKED_MESSAGE = 'This phone is no longer linked. Link it again with a new pairing code (Settings → Sync).';
export const DESKTOP_SIGNED_OUT_MESSAGE = 'This desktop app is signed out. Log in again in Settings → Account.';

/** What to tell the player when sync was refused as signed out. The installed app never gets "Sign in again": its login can't reach the app. */
export function signedOutMessage({ standalone, linked, desktop }: Context): string {
  if (desktop) return DESKTOP_SIGNED_OUT_MESSAGE;
  if (linked) return PHONE_UNLINKED_MESSAGE;
  return standalone ? PHONE_EXPIRED_MESSAGE : SIGNIN_MESSAGE;
}
