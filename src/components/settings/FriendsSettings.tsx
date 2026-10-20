/**
 * Settings → Friends: add a friend by username (the answer is the same whether or not the name exists) or with a
 * friend code, answer requests, remove or block. A friend sees your username and name, nothing else until you share
 * something with them (Saved teams → share, or Sync → share my match log). Removing or blocking a friend stops every
 * share between you at once.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Ban, Check, Copy, Ticket, UserMinus, UserPlus, X } from 'lucide-react';
import type { FriendInfo, FriendsResponse } from '@/domain/accounts';
import { ago } from '@/domain/sharing';
import { isSignedIn, useAccountStore } from '@/sync/accountStore';
import { blockPerson, loadFriends, makeFriendCode, redeemFriendCode, removeFriend, requestFriend, respondToFriend, unblockPerson } from '@/sync/friends';
import { useNow } from '@/sync/useNow';
import { toast } from '@/store/toastStore';
import { TextField } from '../account/AccountForms';
import { Button, Chip } from '../ui/primitives';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nameOf = (f: FriendInfo) => (f.displayName ? `${f.displayName} (@${f.username})` : f.username);

export default function FriendsSettings() {
  const signedIn = useAccountStore(isSignedIn);
  const [data, setData] = useState<FriendsResponse>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    loadFriends().then(
      (r) => alive && setData(r),
      (e) => alive && setError(messageOf(e)),
    );
    return () => {
      alive = false;
    };
  }, [signedIn]);
  if (!signedIn) return <p className="text-sm text-muted">Log in under Account (above) to add friends and share teams with them.</p>;

  /** Every call returns the fresh lists. */
  const run = (p: Promise<FriendsResponse>, done?: string) => {
    setError('');
    setNotice('');
    return p.then(
      (r) => {
        setData(r);
        if (r.notice) setNotice(r.notice);
        if (done) toast(done);
        return true;
      },
      (e) => (setError(messageOf(e)), false),
    );
  };
  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">Friends see your username and name, nothing else until you share a team or your match log with them. Sharing is only between friends.</p>
      <AddFriend onRun={run} notice={notice} />
      {data && <Lists data={data} onRun={run} />}
      {!data && !error && (
        <p role="status" className="text-muted">
          Loading friends…
        </p>
      )}
      {error && (
        <p role="alert" className="font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

type Run = (p: Promise<FriendsResponse>, done?: string) => Promise<boolean>;

function AddFriend({ onRun, notice }: { onRun: Run; notice: string }) {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [made, setMade] = useState<{ code: string; expiresAt: number }>();
  const [copied, setCopied] = useState('');
  const ask = (e: FormEvent) => {
    e.preventDefault();
    void onRun(requestFriend(username)).then((ok) => ok && setUsername(''));
  };
  const redeem = (e: FormEvent) => {
    e.preventDefault();
    void onRun(redeemFriendCode(code), 'You’re friends now.').then((ok) => ok && setCode(''));
  };
  const make = () =>
    void onRun(
      makeFriendCode().then((r) => {
        setMade({ code: r.code, expiresAt: r.expiresAt });
        setCopied('');
        return r;
      }),
    );
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap items-end gap-2" onSubmit={ask} aria-label="Add a friend by username">
        <TextField id="friend-username" name="friend-username" label="Add a friend by username" placeholder="misty" autoComplete="off" autoCapitalize="none" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} className="min-w-0 flex-1 basis-48" />
        <Button type="submit" variant="primary" disabled={!username.trim()}>
          <UserPlus size={15} aria-hidden /> Send request
        </Button>
        {notice && (
          <p role="status" className="basis-full text-muted">
            {notice}
          </p>
        )}
      </form>
      <div className="space-y-2 rounded-lg border border-border p-2.5">
        <p className="font-semibold">Or with a friend code</p>
        <p className="text-xs text-muted">Make a code and send it over any chat: whoever enters it becomes your friend at once. It works once, for 7 days.</p>
        {made ? (
          <div role="status" className="space-y-2">
            <p className="font-mono text-lg font-semibold tracking-wider select-all" data-testid="friend-code">
              {made.code}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() =>
                  navigator.clipboard.writeText(made.code).then(
                    () => setCopied('Copied.'),
                    () => setCopied('Could not copy: select it by hand.'),
                  )
                }
              >
                <Copy size={14} aria-hidden /> Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMade(undefined)}>
                Done
              </Button>
              <span className="text-xs text-muted">{copied || 'Shown only now.'}</span>
            </div>
          </div>
        ) : (
          <Button size="sm" onClick={make}>
            <Ticket size={14} aria-hidden /> Make a friend code
          </Button>
        )}
        <form className="flex flex-wrap items-end gap-2" onSubmit={redeem} aria-label="Enter a friend code">
          <TextField id="friend-code" name="friend-code" label="A code you were sent" placeholder="FR-XXXXX-XXXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} className="min-w-0 flex-1 basis-48" />
          <Button type="submit" disabled={!code.trim()}>
            Add
          </Button>
        </form>
      </div>
    </div>
  );
}

function Lists({ data, onRun }: { data: FriendsResponse; onRun: Run }) {
  const [confirm, setConfirm] = useState<{ id: string; action: 'remove' | 'block' }>();
  const now = useNow(60_000);
  const act = (p: Promise<FriendsResponse>, done: string) => void onRun(p, done).then((ok) => ok && setConfirm(undefined));
  return (
    <div className="space-y-4">
      {data.incoming.length > 0 && (
        <section className="space-y-1.5" aria-labelledby="friends-incoming">
          <h4 id="friends-incoming" className="font-semibold">
            Requests for you
          </h4>
          <ul className="space-y-1.5">
            {data.incoming.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/8 p-2">
                <span className="min-w-0 flex-1 font-medium break-words">{nameOf(f)}</span>
                <Button size="sm" variant="primary" aria-label={`Accept ${f.username}`} onClick={() => act(respondToFriend(f.id, true), `You and ${f.username} are friends now.`)}>
                  <Check size={14} aria-hidden /> Accept
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Decline ${f.username}`} onClick={() => act(respondToFriend(f.id, false), 'Declined.')}>
                  <X size={14} aria-hidden /> Decline
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Block ${f.username}`} onClick={() => act(blockPerson(f.id), `${f.username} is blocked.`)}>
                  <Ban size={14} aria-hidden /> Block
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-1.5" aria-labelledby="friends-list">
        <h4 id="friends-list" className="font-semibold">
          Friends
        </h4>
        {data.friends.length === 0 && <p className="text-muted">No friends yet. Add one by username, or with a friend code.</p>}
        <ul className="space-y-1.5">
          {data.friends.map((f) => (
            <li key={f.id} className="space-y-2 rounded-lg border border-border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 font-medium break-words">{nameOf(f)}</span>
                {f.unavailable && <Chip tone="warn">Unavailable</Chip>}
                <span className="text-xs text-muted">friends since {ago(f.since, now)}</span>
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" aria-label={`Remove ${f.username}`} onClick={() => setConfirm({ id: f.id, action: 'remove' })}>
                    <UserMinus size={14} aria-hidden /> Remove
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Block ${f.username}`} onClick={() => setConfirm({ id: f.id, action: 'block' })}>
                    <Ban size={14} aria-hidden /> Block
                  </Button>
                </span>
              </div>
              {confirm?.id === f.id && (
                <div role="alert" className="flex flex-wrap items-center gap-2">
                  <span>
                    {confirm.action === 'remove' ? `Remove ${f.username}? Everything you share with each other stops at once.` : `Block ${f.username}? You stop being friends, everything shared between you stops, and they can't ask again.`}
                  </span>
                  <Button size="sm" variant="danger" onClick={() => act(confirm.action === 'remove' ? removeFriend(f.id) : blockPerson(f.id), confirm.action === 'remove' ? `${f.username} removed.` : `${f.username} is blocked.`)}>
                    {confirm.action === 'remove' ? 'Remove' : 'Block'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(undefined)}>
                    Keep
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
      {data.outgoing.length > 0 && (
        <section className="space-y-1.5" aria-labelledby="friends-outgoing">
          <h4 id="friends-outgoing" className="font-semibold">
            Waiting for an answer
          </h4>
          <ul className="space-y-1.5">
            {data.outgoing.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                <span className="min-w-0 flex-1 font-medium break-words">{nameOf(f)}</span>
                <Button size="sm" variant="ghost" aria-label={`Cancel the request to ${f.username}`} onClick={() => act(removeFriend(f.id), 'Request cancelled.')}>
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.blocked.length > 0 && (
        <section className="space-y-1.5" aria-labelledby="friends-blocked">
          <h4 id="friends-blocked" className="font-semibold">
            Blocked
          </h4>
          <ul className="space-y-1.5">
            {data.blocked.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                <span className="min-w-0 flex-1 font-medium break-words">{b.username}</span>
                <Button size="sm" variant="ghost" aria-label={`Unblock ${b.username}`} onClick={() => act(unblockPerson(b.id), `${b.username} is unblocked.`)}>
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
