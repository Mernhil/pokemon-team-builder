/**
 * Managing who can see what: share a folder, share my matches, set my display name. Each call asks
 * the server (docs/SYNC.md) and keeps the answer in the shared store for the screens to show.
 */
import type { ShareOp, ShareRole, SharesResponse } from '@/domain/syncProtocol';
import { request, syncNow } from './runner';
import { useSharedStore } from './sharedStore';

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  useSharedStore.getState().setError(undefined);
  try {
    return await fn();
  } catch (e) {
    useSharedStore.getState().setError(e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

export const refreshSharing = () =>
  run(async () => {
    const mine = await request<SharesResponse>('GET', '/api/shares');
    useSharedStore.getState().setMine(mine);
    return mine;
  });

const send = (op: ShareOp) =>
  run(async () => {
    const mine = await request<SharesResponse>('POST', '/api/shares', op);
    useSharedStore.getState().setMine(mine);
    return mine;
  });

/** Sharing needs the folder on the server first, so a sync runs before the request. */
export async function shareFolder(folderId: string, grantee: string, role: ShareRole) {
  await syncNow();
  return send({ op: 'share', folderId, grantee, role });
}
export const unshareFolder = (folderId: string, grantee: string) => send({ op: 'unshare', folderId, grantee });
export const shareMatchesWith = (grantee: string, enabled: boolean) => send({ op: 'shareMatches', grantee, enabled });
export const setDisplayName = (displayName: string) => send({ op: 'profile', displayName });
/** Give up a folder someone shared with me; its teams leave this device on the next sync. */
export async function leaveFolder(owner: string, folderId: string) {
  const r = await send({ op: 'leave', owner, folderId });
  await syncNow();
  return r;
}
