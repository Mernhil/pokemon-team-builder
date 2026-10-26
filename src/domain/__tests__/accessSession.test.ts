import { describe, expect, it } from 'vitest';
import { DESKTOP_SIGNED_OUT_MESSAGE, PHONE_EXPIRED_MESSAGE, PHONE_UNLINKED_MESSAGE, SIGNIN_MESSAGE, accessSessionEnded, signedOutMessage } from '../accessSession';

describe('accessSessionEnded', () => {
  it('is true for the redirect a manual fetch sees when Access wants a login', () => {
    expect(accessSessionEnded({ type: 'opaqueredirect', status: 0 })).toBe(true);
  });
  it('is true for a 3xx that is shown, and for the Worker\'s or Access\'s 401 and 403', () => {
    expect(accessSessionEnded({ status: 302 })).toBe(true);
    expect(accessSessionEnded({ status: 307 })).toBe(true);
    expect(accessSessionEnded({ status: 401 })).toBe(true);
    expect(accessSessionEnded({ status: 403 })).toBe(true);
  });
  it('is true when a followed redirect ended on the Access login page, and only then', () => {
    expect(accessSessionEnded({ status: 200, redirected: true, url: 'https://myteam.cloudflareaccess.com/cdn-cgi/access/login/app?kid=1' })).toBe(true);
    expect(accessSessionEnded({ status: 200, redirected: true, url: 'https://evilcloudflareaccess.com/login' })).toBe(false);
    expect(accessSessionEnded({ status: 200, redirected: true, url: 'https://app.example/api/sync' })).toBe(false);
    expect(accessSessionEnded({ status: 200, redirected: true, url: 'not a url' })).toBe(false);
  });
  it('is false for data and for ordinary failures', () => {
    expect(accessSessionEnded({ type: 'basic', status: 200 })).toBe(false);
    expect(accessSessionEnded({ status: 404 })).toBe(false);
    expect(accessSessionEnded({ status: 429 })).toBe(false);
    expect(accessSessionEnded({ status: 500 })).toBe(false);
    expect(accessSessionEnded({ status: 501 })).toBe(false);
  });
});

describe('signedOutMessage', () => {
  it('tells the installed phone app to link it or sign in from Safari, never "Sign in again"', () => {
    expect(signedOutMessage({ standalone: true, linked: false, desktop: false })).toBe(PHONE_EXPIRED_MESSAGE);
    expect(PHONE_EXPIRED_MESSAGE).toBe('Session expired: link this phone with a code, or sign in from Safari.');
  });
  it('keeps "Sign in again" for a browser tab, where the login can return to the page', () => {
    expect(signedOutMessage({ standalone: false, linked: false, desktop: false })).toBe(SIGNIN_MESSAGE);
  });
  it('says a linked phone was unlinked (its token was refused), and a desktop app is signed out', () => {
    expect(signedOutMessage({ standalone: true, linked: true, desktop: false })).toBe(PHONE_UNLINKED_MESSAGE);
    expect(signedOutMessage({ standalone: false, linked: true, desktop: false })).toBe(PHONE_UNLINKED_MESSAGE);
    expect(signedOutMessage({ standalone: false, linked: false, desktop: true })).toBe(DESKTOP_SIGNED_OUT_MESSAGE);
  });
});
