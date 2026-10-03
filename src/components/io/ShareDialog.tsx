import { useState } from 'react';
import { Users } from 'lucide-react';
import { nameOf } from '@/domain/sharing';
import { EMAIL_RE, type ShareInfo } from '@/domain/syncProtocol';
import type { Team } from '@/domain/types';
import { useShareStore } from '@/sync/shareStore';
import { addShare, removeShare } from '@/sync/sharesApi';
import { Modal } from '../ui/Modal';
import { Button, Input, Label, Select } from '../ui/primitives';

/** Share a team with its variations with one other person, as "can view" or "can edit". */
export function ShareDialog({ open, onOpenChange, team }: { open: boolean; onOpenChange: (o: boolean) => void; team: Team }) {
  const granted = useShareStore((s) => s.granted);
  const names = useShareStore((s) => s.names);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'view' | 'edit'>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = granted.filter((g) => g.kind === 'team-group' && g.ref === team.id);

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

  const submit = () =>
    run(async () => {
      const to = email.trim().toLowerCase();
      if (!EMAIL_RE.test(to)) throw new Error('Enter their e-mail address, the one they sign in with.');
      // The server can only share a team it has: send this device's latest first.
      const { syncNow } = await import('@/sync/runner');
      await syncNow();
      await addShare({ kind: 'team-group', ref: team.id, grantee: to, role });
      setEmail('');
    });

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Share “${team.name}”`} description="They get this team and all its variations. Your other teams stay private.">
      <div className="space-y-4 px-5 pb-5 text-sm">
        {mine.length > 0 && (
          <ul className="space-y-2" aria-label="Shared with">
            {mine.map((g: ShareInfo) => (
              <li key={g.grantee} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2">
                <Users size={15} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium" title={g.grantee}>
                  {nameOf(g.grantee, names)}
                </span>
                <Select
                  aria-label={`What ${g.grantee} can do`}
                  value={g.role}
                  disabled={busy}
                  onChange={(e) => void run(() => addShare({ kind: 'team-group', ref: team.id, grantee: g.grantee, role: e.target.value as 'view' | 'edit' }))}
                >
                  <option value="view">Can view</option>
                  <option value="edit">Can edit</option>
                </Select>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => removeShare({ kind: 'team-group', ref: team.id, grantee: g.grantee }))} aria-label={`Stop sharing with ${g.grantee}`}>
                  Stop sharing
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form
          noValidate
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Label>Share with</Label>
          <div className="flex flex-wrap gap-2">
            <Input type="email" aria-label="Their e-mail address" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="min-w-0 flex-1" autoComplete="off" />
            <Select aria-label="What they can do" value={role} onChange={(e) => setRole(e.target.value as 'view' | 'edit')}>
              <option value="view">Can view</option>
              <option value="edit">Can edit</option>
            </Select>
            <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
              {busy ? 'Sharing…' : 'Share'}
            </Button>
          </div>
          <p className="text-xs text-muted">
            They need to be able to sign in to this app with that address (Cloudflare Access) and turn on Settings → Sync. “Can edit” lets them change the team and add variations (not delete the team); if you both edit the same
            team, the older change is kept as a copy. You can stop sharing any time.
          </p>
        </form>
        {error && (
          <p role="alert" className="rounded-lg border border-bad/40 bg-bad/8 p-2 text-bad">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
