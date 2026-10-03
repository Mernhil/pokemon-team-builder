/**
 * Who may read or write what, as one pure function so the whole matrix is tested without a database.
 * Roles: the owner of a document, an editor and a viewer of a shared folder, and everyone else.
 */
export type Role = 'view' | 'edit';
export type ShareKind = 'team-group' | 'matches';
/** Matches are shared as a whole log: `ref` is this. */
export const ALL_MATCHES = '*';

export interface Share {
  owner: string;
  grantee: string;
  kind: ShareKind;
  ref: string;
  role: Role;
}

export type Access = 'owner' | Role | null;

export type Target = { kind: 'team'; group: string } | { kind: 'match' };

/** What `requester` can do with a document of `owner`'s. */
export function accessTo(requester: string, owner: string, target: Target, shares: Share[]): Access {
  if (requester === owner) return 'owner';
  let best: Access = null;
  for (const s of shares) {
    if (s.owner !== owner || s.grantee !== requester) continue;
    const matches = target.kind === 'team' ? s.kind === 'team-group' && s.ref === target.group : s.kind === 'matches';
    if (!matches) continue;
    if (s.role === 'edit') return target.kind === 'team' ? 'edit' : 'view'; // a match log is never writable by anyone else
    best = 'view';
  }
  return best;
}

export const canRead = (a: Access): boolean => a !== null;
/** Writes: the owner anything; an editor teams of the shared folder; nobody else. */
export const canWrite = (a: Access, target: Target): boolean => a === 'owner' || (a === 'edit' && target.kind === 'team');
