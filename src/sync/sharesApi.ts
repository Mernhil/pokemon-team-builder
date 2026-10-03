import type { ShareInput, SharesResponse } from '@/domain/syncProtocol';
import { request } from './http';
import { useShareStore } from './shareStore';

/** The sharing calls the Settings and Share dialogs make. Each returns the fresh list and remembers it. */
const remember = (r: SharesResponse) => {
  useShareStore.getState().setShares(r);
  return r;
};

export const loadShares = () => request<SharesResponse>('GET', '/api/shares').then(remember);
export const addShare = (s: ShareInput) => request<SharesResponse>('PUT', '/api/shares', s).then(remember);
export const removeShare = (s: { kind: ShareInput['kind']; ref: string; grantee: string; owner?: string }) => request<SharesResponse>('DELETE', '/api/shares', s).then(remember);
export const saveDisplayName = async (displayName: string) => {
  await request('PUT', '/api/profile', { displayName });
  return loadShares();
};
