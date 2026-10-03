import { useEffect, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import type { ShareRole } from '@/domain/syncProtocol';
import { EMAIL_RE } from '@/domain/syncProtocol';
import { refreshSharing, shareFolder, unshareFolder } from '@/sync/sharing';
import { useSharedStore } from '@/sync/sharedStore';
import { Modal } from '../ui/Modal';
import { Button, Chip, Input, Label, Select } from '../ui/primitives';

/** Share one team folder (a team and all its variations) with another e-mail, as "can view" or "can edit". */
export default function ShareDialog({ open, onOpenChange, folderId, name }: { open: boolean; onOpenChange: (o: boolean) => void; folderId: string; name: string }) {
  const mine = useSharedStore((s) => s.mine);
  const error = useSharedStore((s) => s.error);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ShareRole>('view');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (open) void refreshSharing();
  }, [open]);

  const grants = (mine?.outgoing ?? []).filter((o) => o.folderId === folderId);
  const submit = async () => {
    const grantee = email.trim().toLowerCase();
    if (!EMAIL_RE.test(grantee)) {
      setLocalError('That doesn’t look like an e-mail address.');
      return;
    }
    setLocalError('');
    setBusy(true);
    const r = await shareFolder(folderId, grantee, role);
    setBusy(false);
    if (r) setEmail('');
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Share “${name}”`} description="The team and all its variations. They sign in with their own account, and you can stop sharing at any time.">
      <div className="space-y-4 p-5 pt-2 text-sm">
        <form
          noValidate
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <label className="space-y-1">
              <Label>E-mail</Label>
              <Input type="email" autoComplete="off" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail to share with" />
            </label>
            <label className="space-y-1">
              <Label>They can</Label>
              <Select aria-label="What they can do" value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
                <option value="view">view</option>
                <option value="edit">edit</option>
              </Select>
            </label>
            <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
              <UserPlus size={14} aria-hidden /> Share
            </Button>
          </div>
          <p className="text-xs text-muted">Whoever you share with must be allowed to sign in to this app (the Cloudflare Access policy decides that; see docs/SYNC.md).</p>
        </form>
        {(localError || error) && (
          <p role="alert" className="rounded-lg border border-bad/40 bg-bad/8 p-2 text-bad">
            {localError || error}
          </p>
        )}

        <section aria-label="Who has access">
          <Label>Who has access</Label>
          {grants.length === 0 ? (
            <p className="mt-1 text-muted">Nobody yet.</p>
          ) : (
            <ul className="mt-1 space-y-1.5">
              {grants.map((g) => (
                <li key={g.grantee} className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{g.grantee}</span>
                  <Select aria-label={`What ${g.grantee} can do`} className="w-auto" value={g.role} onChange={(e) => void shareFolder(folderId, g.grantee, e.target.value as ShareRole)}>
                    <option value="view">can view</option>
                    <option value="edit">can edit</option>
                  </Select>
                  <Button size="icon" variant="ghost" aria-label={`Stop sharing with ${g.grantee}`} className="hover:text-bad" onClick={() => void unshareFolder(folderId, g.grantee)}>
                    <Trash2 size={14} aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <Chip>Stopping takes effect right away; their copy disappears from their device on its next sync.</Chip>
      </div>
    </Modal>
  );
}
