/**
 * Settings → Account → Admin (admins only; the server checks the role on every call): make and revoke invites,
 * see the accounts, disable or enable one, make or remove an admin, and make a one-time password reset code.
 * Codes are shown once, here, and never again.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Copy, KeyRound, Ticket, UserCheck, UserX } from 'lucide-react';
import type { AdminUserInfo, InviteInfo } from '@/domain/accounts';
import { ago } from '@/domain/sharing';
import { createInvite, createResetCode, loadInvites, loadUsers, revokeInvite, setUserDisabled, setUserRole } from '@/sync/admin';
import { useAccountStore } from '@/sync/accountStore';
import { useNow } from '@/sync/useNow';
import { toast } from '@/store/toastStore';
import { TextField } from '../account/AccountForms';
import { Button, Chip, Select } from '../ui/primitives';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const TTL = [
  { hours: 1, label: '1 hour' },
  { hours: 24, label: '1 day' },
  { hours: 7 * 24, label: '7 days' },
  { hours: 30 * 24, label: '30 days' },
];
const STATUS: Record<InviteInfo['status'], { label: string; tone: 'good' | 'neutral' | 'warn' }> = {
  open: { label: 'Open', tone: 'good' },
  used: { label: 'Used', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'warn' },
  revoked: { label: 'Revoked', tone: 'neutral' },
};

/** A code shown once, with Copy. */
function OnceCode({ title, code, children, onDone }: { title: string; code: string; children: ReactNode; onDone: () => void }) {
  const [copied, setCopied] = useState('');
  return (
    <div role="status" className="space-y-2 rounded-lg border border-accent/40 bg-accent/8 p-3">
      <p className="font-semibold">{title}</p>
      <p className="font-mono text-lg font-semibold tracking-wider break-all select-all" data-testid="once-code">
        {code}
      </p>
      <p className="text-xs text-muted">{children}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() =>
            navigator.clipboard.writeText(code).then(
              () => setCopied('Copied.'),
              () => setCopied('Could not copy: select it by hand.'),
            )
          }
        >
          <Copy size={14} aria-hidden /> Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
        <span className="text-xs text-muted">{copied}</span>
      </div>
    </div>
  );
}

export default function AdminSettings() {
  return (
    <section className="space-y-4 rounded-lg border border-border p-3" aria-labelledby="account-admin">
      <h4 id="account-admin" className="font-semibold">
        Admin
      </h4>
      <Invites />
      <Users />
    </section>
  );
}

function Invites() {
  const [invites, setInvites] = useState<InviteInfo[]>();
  const [note, setNote] = useState('');
  const [ttl, setTtl] = useState(7 * 24);
  const [made, setMade] = useState<{ code: string; expiresAt: number }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const now = useNow(60_000);
  useEffect(() => {
    let alive = true;
    loadInvites().then(
      (r) => alive && setInvites(r.invites),
      (e) => alive && setError(messageOf(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    createInvite(note, ttl)
      .then((r) => {
        setInvites(r.invites);
        setMade({ code: r.code, expiresAt: r.expiresAt });
        setNote('');
      }, (err) => setError(messageOf(err)))
      .finally(() => setBusy(false));
  };
  const revoke = (id: string) => {
    setError('');
    revokeInvite(id).then(
      (r) => (setInvites(r.invites), toast('Invite revoked.')),
      (err) => setError(messageOf(err)),
    );
  };
  return (
    <div className="space-y-2">
      <h5 className="text-xs font-semibold text-muted uppercase">Invites</h5>
      {made ? (
        <OnceCode title="Invite code" code={made.code} onDone={() => setMade(undefined)}>
          Send this code (not a link) to the person you’re inviting. It works once, until {new Date(made.expiresAt).toLocaleString()}. It is shown only now.
        </OnceCode>
      ) : (
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit} aria-label="Make an invite">
          <TextField id="invite-note" name="invite-note" label="Note (only you see it)" placeholder="for Sam" maxLength={80} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} className="min-w-0 flex-1 basis-40" />
          <div className="flex flex-col gap-1">
            <label htmlFor="invite-ttl" className="text-2xs font-semibold tracking-wider text-muted uppercase">
              Valid for
            </label>
            <Select id="invite-ttl" value={ttl} onChange={(e) => setTtl(Number(e.target.value))} className="w-32">
              {TTL.map((t) => (
                <option key={t.hours} value={t.hours}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            <Ticket size={15} aria-hidden /> Make an invite
          </Button>
        </form>
      )}
      {invites && invites.length > 0 && (
        <ul className="space-y-1.5" aria-label="Invites">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
              <Chip tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Chip>
              <span className="min-w-0 font-medium break-words">{i.note || 'No note'}</span>
              <span className="text-xs text-muted">
                {i.status === 'used' && i.usedBy ? `used by ${i.usedBy}` : i.status === 'open' ? `expires ${new Date(i.expiresAt).toLocaleDateString()}` : `made ${ago(i.createdAt, now)}`}
              </span>
              {i.status === 'open' && (
                <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Revoke invite ${i.note || i.id}`} onClick={() => revoke(i.id)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {invites?.length === 0 && <p className="text-muted">No invites yet.</p>}
      {error && (
        <p role="alert" className="font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function Users() {
  const me = useAccountStore((s) => s.user);
  const [users, setUsers] = useState<AdminUserInfo[]>();
  const [confirm, setConfirm] = useState<{ id: string; action: 'disable' | 'demote' }>();
  const [resetFor, setResetFor] = useState<string>();
  const [password, setPassword] = useState('');
  const [reset, setReset] = useState<{ username: string; code: string; expiresAt: number }>();
  const [error, setError] = useState('');
  const now = useNow(60_000);
  useEffect(() => {
    let alive = true;
    loadUsers().then(
      (r) => alive && setUsers(r.users),
      (e) => alive && setError(messageOf(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  const act = (p: Promise<{ users: AdminUserInfo[] }>, done: string) => {
    setError('');
    p.then(
      (r) => (setUsers(r.users), setConfirm(undefined), toast(done)),
      (e) => setError(messageOf(e)),
    );
  };
  const makeReset = (u: AdminUserInfo) => (e: FormEvent) => {
    e.preventDefault();
    setError('');
    createResetCode(u.id, password).then(
      (r) => (setUsers(r.users), setReset({ username: u.username, code: r.code, expiresAt: r.expiresAt }), setResetFor(undefined), setPassword('')),
      (err) => setError(messageOf(err)),
    );
  };
  return (
    <div className="space-y-2">
      <h5 className="text-xs font-semibold text-muted uppercase">Accounts</h5>
      {reset && (
        <OnceCode title={`Reset code for ${reset.username}`} code={reset.code} onDone={() => setReset(undefined)}>
          Give it to {reset.username}: in Settings → Account → Log in → Forgot password? they enter their username, this code and a new password. It works once, for 24 hours, and signs out
          all their devices. It is shown only now.
        </OnceCode>
      )}
      {!users && !error && (
        <p role="status" className="text-muted">
          Loading accounts…
        </p>
      )}
      {users && (
        <ul className="space-y-1.5" aria-label="Accounts">
          {users.map((u) => {
            const self = u.id === me?.id;
            return (
              <li key={u.id} className="space-y-2 rounded-lg border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 font-medium break-words">{u.displayName ? `${u.displayName} (@${u.username})` : u.username}</span>
                  {u.role === 'admin' && <Chip tone="accent">Admin</Chip>}
                  {u.disabled && <Chip tone="bad">Disabled</Chip>}
                  {self && <Chip tone="good">You</Chip>}
                  <span className="text-xs text-muted">
                    {u.devices} {u.devices === 1 ? 'device' : 'devices'}
                    {u.lastSeenAt ? `, last seen ${ago(u.lastSeenAt, now)}` : ''}
                    {u.invitedBy ? `, invited by ${u.invitedBy}` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!self &&
                    (u.disabled ? (
                      <Button size="sm" aria-label={`Enable ${u.username}`} onClick={() => act(setUserDisabled(u.id, false), `${u.username} can log in again.`)}>
                        <UserCheck size={14} aria-hidden /> Enable
                      </Button>
                    ) : (
                      <Button size="sm" variant="danger" aria-label={`Disable ${u.username}`} onClick={() => setConfirm({ id: u.id, action: 'disable' })}>
                        <UserX size={14} aria-hidden /> Disable
                      </Button>
                    ))}
                  {u.role === 'admin' ? (
                    <Button size="sm" variant="ghost" aria-label={`Remove admin from ${u.username}`} onClick={() => setConfirm({ id: u.id, action: 'demote' })}>
                      Remove admin
                    </Button>
                  ) : (
                    !u.disabled && (
                      <Button size="sm" variant="ghost" aria-label={`Make ${u.username} an admin`} onClick={() => act(setUserRole(u.id, 'admin'), `${u.username} is an admin now.`)}>
                        Make admin
                      </Button>
                    )
                  )}
                  {!self && !u.disabled && (
                    <Button size="sm" variant="ghost" aria-label={`Reset password of ${u.username}`} onClick={() => (setResetFor(u.id), setPassword(''))}>
                      <KeyRound size={14} aria-hidden /> Reset password
                    </Button>
                  )}
                </div>
                {confirm?.id === u.id && (
                  <div role="alert" className="flex flex-wrap items-center gap-2">
                    <span>{confirm.action === 'disable' ? `Disable ${u.username}? They are signed out everywhere at once; their data stays.` : `Remove admin from ${u.username}${self ? ' (you)' : ''}?`}</span>
                    <Button size="sm" variant="danger" onClick={() => act(confirm.action === 'disable' ? setUserDisabled(u.id, true) : setUserRole(u.id, 'user'), confirm.action === 'disable' ? `${u.username} is disabled.` : `${u.username} is no longer an admin.`)}>
                      {confirm.action === 'disable' ? 'Disable' : 'Remove admin'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(undefined)}>
                      Keep
                    </Button>
                  </div>
                )}
                {resetFor === u.id && (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={makeReset(u)} aria-label={`Reset password of ${u.username}`}>
                    <input type="text" name="username" autoComplete="username" value={me?.username ?? ''} readOnly hidden />
                    <TextField id={`reset-${u.id}-password`} name="password" label="Your password, to confirm" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="min-w-0 flex-1 basis-48" />
                    <Button type="submit" variant="primary">
                      Make reset code
                    </Button>
                    <Button variant="ghost" onClick={() => setResetFor(undefined)}>
                      Cancel
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" className="font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
