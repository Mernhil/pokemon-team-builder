import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { TOKEN_RE, normalizeServer } from '@/domain/pairing';
import { safeStorage } from '@/store/storage';

/** The desktop app has no Cloudflare Access login: it is linked to an account with a pairing code (docs/SYNC.md). A phone can be linked the same way (`isPhoneLinked`). */
export const isDesktopApp = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * The installed home-screen app (iOS: `navigator.standalone`; elsewhere the display-mode media query). On iOS it has its own
 * cookie jar, separate from Safari's, so a Cloudflare Access login can't be shared with it (docs/SYNC.md).
 */
export const isStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return (navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
};

/**
 * Where this desktop app (or, linked with a code, this phone) is linked to. `server` is remembered after unlinking, so linking again
 * only needs the code. Not synced. The token is a bearer secret for this one device: it can be
 * revoked from the phone, and it can't make pairing codes or list other devices.
 */
interface DeviceState {
  server?: string;
  token?: string;
  owner?: string;
  linkedAt?: number;
  link: (l: { server: string; token: string; owner: string }) => void;
  /** Forget the token (this device stops syncing); the server address stays. */
  unlink: () => void;
}

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set) => ({
      link: ({ server, token, owner }) => set({ server, token, owner, linkedAt: Date.now() }),
      unlink: () => set({ token: undefined, owner: undefined, linkedAt: undefined }),
    }),
    {
      name: 'ptb:device:v1',
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ server: s.server, token: s.token, owner: s.owner, linkedAt: s.linkedAt }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DeviceState>;
        const server = typeof p.server === 'string' ? normalizeServer(p.server) : undefined;
        const linked = server && typeof p.token === 'string' && TOKEN_RE.test(p.token);
        return { ...current, server, token: linked ? p.token : undefined, owner: linked && typeof p.owner === 'string' ? p.owner.slice(0, 254) : undefined, linkedAt: linked && typeof p.linkedAt === 'number' ? p.linkedAt : undefined };
      },
    },
  ),
);

export const isLinked = (): boolean => {
  const { server, token } = useDeviceStore.getState();
  return Boolean(server && token);
};

/** A phone (or any browser) that syncs with a device token from a pairing code instead of the Access cookie. */
export const isPhoneLinked = (): boolean => !isDesktopApp() && isLinked();
