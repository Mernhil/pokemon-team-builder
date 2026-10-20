/** The admin calls behind Settings → Account → Admin (docs/ACCOUNTS.md). Codes come back once and are never stored here. */
import { deriveKey, type InvitesResponse, type KdfParams, type NewInviteResponse, type ResetCodeResponse, type UsersResponse } from '@/domain/accounts';
import { AccountError, accountRequest } from './account';
import { useAccountStore } from './accountStore';

export const loadInvites = () => accountRequest<InvitesResponse>('GET', '/api/admin/invites');
export const createInvite = (note: string, ttlHours: number) => accountRequest<NewInviteResponse>('POST', '/api/admin/invites', { note: note.trim() || undefined, ttlHours });
export const revokeInvite = (id: string) => accountRequest<InvitesResponse>('DELETE', '/api/admin/invites', { id });

export const loadUsers = () => accountRequest<UsersResponse>('GET', '/api/admin/users');
export const setUserDisabled = (id: string, disabled: boolean) => accountRequest<UsersResponse>('POST', `/api/admin/users/${disabled ? 'disable' : 'enable'}`, { id });
export const setUserRole = (id: string, role: 'user' | 'admin') => accountRequest<UsersResponse>('POST', '/api/admin/users/role', { id, role });

/** A one-time reset code for someone else; needs this admin's own password again. */
export async function createResetCode(id: string, password: string): Promise<ResetCodeResponse> {
  const me = useAccountStore.getState().user;
  if (!me) throw new AccountError('You’re signed out. Log in again.', 'signin');
  if (!password) throw new AccountError('Enter your own password to confirm.', 'invalid');
  const p = await accountRequest<KdfParams>('POST', '/api/auth/params', { username: me.username });
  return accountRequest<ResetCodeResponse>('POST', '/api/admin/users/reset', { id, key: await deriveKey(password, p.salt, p.iterations) });
}
