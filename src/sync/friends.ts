/** The friend calls behind Settings → Friends and the Share dialog (docs/ACCOUNTS.md). */
import type { FriendLinkResponse, FriendsResponse } from '@/domain/accounts';
import { accountRequest } from './account';
import { useAccountStore } from './accountStore';

/** Each call returns the fresh lists; the number of requests waiting for me feeds the dot on Settings. */
const remember = <T extends FriendsResponse>(r: T): T => {
  useAccountStore.getState().setIncomingFriends(r.incoming.length);
  return r;
};
export const loadFriends = () => accountRequest<FriendsResponse>('GET', '/api/friends').then(remember);
export const requestFriend = (username: string) => accountRequest<FriendsResponse>('POST', '/api/friends/request', { username: username.trim() }).then(remember);
export const respondToFriend = (id: string, accept: boolean) => accountRequest<FriendsResponse>('POST', '/api/friends/respond', { id, accept }).then(remember);
export const removeFriend = (id: string) => accountRequest<FriendsResponse>('DELETE', '/api/friends', { id }).then(remember);
export const makeFriendCode = () => accountRequest<FriendLinkResponse>('POST', '/api/friends/link', {}).then(remember);
export const redeemFriendCode = (code: string) => accountRequest<FriendsResponse>('POST', '/api/friends/link/redeem', { code: code.trim() }).then(remember);
export const blockPerson = (id: string) => accountRequest<FriendsResponse>('POST', '/api/blocks', { id }).then(remember);
export const unblockPerson = (id: string) => accountRequest<FriendsResponse>('DELETE', '/api/blocks', { id }).then(remember);
