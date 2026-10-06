import { useEffect, useState } from 'react';
import { nameOf } from '@/domain/sharing';
import { EMAIL_RE } from '@/domain/syncProtocol';
import { useTeamStore } from '@/store/teamStore';
import { useShareStore } from '@/sync/shareStore';
import { addShare, loadShares, removeShare, saveDisplayName } from '@/sync/sharesApi';
import { Button, Input, Label } from '../ui/primitives';

/** Settings → Sync → Sharing: my display name, who sees my match log, and what others have shared with me. */
export default function SharingSettings() {
  const me = useShareStore((s) => s.me);
  const granted = useShareStore((s) => s.granted);
  const received = useShareStore((s) => s.received);
  const names = useShareStore((s) => s.names);
  const teams = useTeamStore((s) => s.teams);
  const [name, setName] = useState(me?.displayName ?? '');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadShares().then((r) => setName((cur) => cur || r.me.displayName || ''), () => undefined);
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const matchShares = granted.filter((g) => g.kind === 'matches');
  const teamName = (ref: string) => teams[ref]?.name ?? 'a team';

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Sharing</h3>

      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => saveDisplayName(name.trim()));
        }}
      >
        <Label>Your name, as the people you share with see it</Label>
        <div className="flex max-w-sm gap-2">
          <Input aria-label="Display name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={me?.email ?? 'Your name'} />
          <Button type="submit" disabled={busy || name.trim() === (me?.displayName ?? '')}>
            Save
          </Button>
        </div>
        <p className="text-xs text-muted">{me ? `You are signed in as ${me.email}.` : ''} Share a team from Saved teams (the share button on a team).</p>
      </form>

      <div className="space-y-2">
        <Label>My match log</Label>
        {matchShares.length > 0 && (
          <ul className="space-y-1" aria-label="People who can see my match log">
            {matchShares.map((g) => (
              <li key={g.grantee} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={g.grantee}>
                  {nameOf(g.grantee, names)} can see my matches
                </span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => removeShare({ kind: 'matches', ref: '*', grantee: g.grantee }))}>
                  Stop sharing
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          noValidate
          className="flex max-w-md flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const to = email.trim().toLowerCase();
              if (!EMAIL_RE.test(to)) throw new Error('Enter their e-mail address, the one they sign in with.');
              const { syncNow } = await import('@/sync/runner');
              await syncNow();
              await addShare({ kind: 'matches', ref: '*', grantee: to, role: 'view' });
              setEmail('');
            });
          }}
        >
          <Input type="email" aria-label="E-mail to share my matches with" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-0 flex-1" autoComplete="off" />
          <Button type="submit" disabled={busy || !email.trim()}>
            Share my matches
          </Button>
        </form>
        <p className="text-xs text-muted">They can look at your matches (view only). Theirs appear in the Match log and Meta tab as a separate choice, and only count in your own stats if you pick “Both of us”.</p>
      </div>

      {received.length > 0 && (
        <div className="space-y-2">
          <Label>Shared with me</Label>
          <ul className="space-y-1" aria-label="Shared with me">
            {received.map((r) => (
              <li key={`${r.owner}:${r.kind}:${r.ref}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={r.owner}>
                  {r.kind === 'matches' ? `${nameOf(r.owner, names)}'s match log` : `${teamName(r.ref)} from ${nameOf(r.owner, names)}`} · {r.role === 'edit' ? 'can edit' : 'view only'}
                </span>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => removeShare({ kind: r.kind, ref: r.ref, grantee: me?.email ?? '', owner: r.owner }))}>
                  Leave
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad/8 p-2 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
