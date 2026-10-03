import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { EMAIL_RE, MAX_DISPLAY_NAME } from '@/domain/syncProtocol';
import { refreshSharing, setDisplayName, shareMatchesWith, unshareFolder } from '@/sync/sharing';
import { useSharedStore } from '@/sync/sharedStore';
import { useTeamStore } from '@/store/teamStore';
import { Button, Input, Label } from './ui/primitives';

/** Settings → Sync → Sharing: my display name, who sees my match log, and who I share folders with (the folders themselves are shared from Saved teams). */
export default function SharingSettings() {
  const mine = useSharedStore((s) => s.mine);
  const error = useSharedStore((s) => s.error);
  const friends = useSharedStore((s) => s.friends);
  const teams = useTeamStore((s) => s.teams);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void refreshSharing().then((m) => {
      if (m) setName(m.displayName);
      setLoaded(true);
    });
  }, []);

  const saveName = () => {
    if (mine && name.trim() !== mine.displayName) void setDisplayName(name.trim());
  };
  const shareMatches = async () => {
    const grantee = email.trim().toLowerCase();
    if (!EMAIL_RE.test(grantee)) {
      setEmailError('That doesn’t look like an e-mail address.');
      return;
    }
    setEmailError('');
    if (await shareMatchesWith(grantee, true)) setEmail('');
  };

  return (
    <div className="space-y-4 border-t border-border pt-3 text-sm">
      <h4 className="font-semibold">Sharing with other people</h4>
      <div className="space-y-1">
        <Label>Your name</Label>
        <Input
          aria-label="Display name"
          className="max-w-xs"
          value={name}
          maxLength={MAX_DISPLAY_NAME}
          placeholder={mine?.email ?? 'Shown instead of your e-mail'}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => e.key === 'Enter' && saveName()}
        />
        <p className="text-xs text-muted">
          What people you share with see: “{name.trim() || mine?.email || 'your e-mail'} updated ‘Rain M-C’ 2 h ago”. {mine ? `You are signed in as ${mine.email}.` : loaded ? '' : 'Loading…'}
        </p>
      </div>

      <div className="space-y-2">
        <Label>Share my match log</Label>
        <p className="text-muted">
          They can read every match you log (opponent teams, notes and results), never change it. Their view of it is separate from theirs unless they pick “Both of us”. Teams are shared one folder at a time from <b>Teams</b>.
        </p>
        <form
          noValidate
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void shareMatches();
          }}
        >
          <Input type="email" autoComplete="off" aria-label="E-mail to share my matches with" className="max-w-xs" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" disabled={!email.trim()}>
            Share my matches
          </Button>
        </form>
        {emailError && <p role="alert" className="text-bad">{emailError}</p>}
        {(mine?.matchGrantees.length ?? 0) > 0 && (
          <ul aria-label="People who can see my matches" className="space-y-1.5">
            {mine!.matchGrantees.map((g) => (
              <li key={g} className="flex items-center gap-2 rounded-lg bg-surface-2 p-2">
                <span className="min-w-0 flex-1 truncate font-semibold">{g}</span>
                <Button size="icon" variant="ghost" aria-label={`Stop sharing my matches with ${g}`} className="hover:text-bad" onClick={() => void shareMatchesWith(g, false)}>
                  <Trash2 size={14} aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(mine?.outgoing.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          <Label>Folders I share</Label>
          <ul aria-label="Folders I share" className="space-y-1.5">
            {mine!.outgoing.map((o) => (
              <li key={`${o.folderId}|${o.grantee}`} className="flex items-center gap-2 rounded-lg bg-surface-2 p-2">
                <span className="min-w-0 flex-1 truncate">
                  <b>{teams[o.folderId]?.name ?? 'A deleted team'}</b> with {o.grantee} · can {o.role}
                </span>
                <Button size="icon" variant="ghost" aria-label={`Stop sharing ${teams[o.folderId]?.name ?? 'this team'} with ${o.grantee}`} className="hover:text-bad" onClick={() => void unshareFolder(o.folderId, o.grantee)}>
                  <Trash2 size={14} aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {friends.length > 0 && (
        <p className="text-muted">
          Sharing their matches with you: <b>{friends.map((f) => f.name || f.owner).join(', ')}</b>. Find them in the Match log’s “Whose matches” picker.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-bad/40 bg-bad/8 p-2 text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
