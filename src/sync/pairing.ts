/** The pairing calls: the phone/website asks for a code and manages linked devices; the desktop app redeems a code. */
import { RedeemSchema, normalizeServer, type DevicesResponse, type PairResponse, type RedeemResponse } from '@/domain/pairing';
import { SyncHttpError, request } from './http';
import { useDeviceStore } from './deviceStore';
import { useSyncStore } from './syncStore';

// Web / phone (signed in through Access)
export const requestPairCode = () => request<PairResponse>('POST', '/api/pair');
export const loadDevices = () => request<DevicesResponse>('GET', '/api/devices');
export const revokeLinkedDevice = (id: string) => request<DevicesResponse>('DELETE', '/api/devices', { id });

/** The text the web app offers to copy: the server and the code in one, which the desktop app splits again. */
export const pairingLink = (code: string) => `${location.origin}/#pair=${code.slice(0, 5)}-${code.slice(5)}`;

// Desktop
/** Trades a pairing code for this device's token, and turns sync on. */
export async function linkThisDevice(serverInput: string, codeInput: string, deviceName: string): Promise<{ owner: string }> {
  const server = normalizeServer(serverInput);
  if (!server) throw new SyncHttpError('Enter the address of your app (for example https://pokemon-team-builder.yourname.workers.dev).', 'other');
  const parsed = RedeemSchema.safeParse({ code: codeInput, name: deviceName || 'Desktop' });
  if (!parsed.success) throw new SyncHttpError('That is not a pairing code (10 letters and digits, like ABCDE-FGHJK).', 'other');
  let res: Response;
  try {
    res = await fetch(`${server}/api/device/redeem`, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(parsed.data) });
  } catch {
    throw new SyncHttpError("Couldn't reach that address. Check it and your connection.", 'offline');
  }
  const json = (await res.json().catch(() => null)) as (RedeemResponse & { error?: string }) | null;
  if (!res.ok || !json?.token) throw new SyncHttpError(json?.error ?? `Linking failed (HTTP ${res.status}). Is that the right address, and is /api/device/* open in Cloudflare Access (docs/SYNC.md)?`, 'other');
  useDeviceStore.getState().link({ server, token: json.token, owner: json.owner });
  useSyncStore.getState().setEnabled(true);
  return { owner: json.owner };
}

/** Unlinks this desktop app: tells the server (best effort), forgets the token and stops syncing. Local teams stay. */
export async function unlinkThisDevice(): Promise<void> {
  try {
    await request('DELETE', '/api/self');
  } catch {
    /* offline or already revoked: forgetting the token locally is what matters */
  }
  useDeviceStore.getState().unlink();
  const sync = useSyncStore.getState();
  sync.setEnabled(false);
  sync.forget();
}
