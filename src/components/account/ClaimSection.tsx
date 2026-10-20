/**
 * "Bring my teams from before" (docs/ACCOUNTS.md): right after an account is made (and in Settings → Account until
 * it is done or skipped), the teams, match log, shares and linked desktop apps synced through the Cloudflare Access
 * sign-in move into the account. Possible only while Access is still in front of the app, in the browser signed in
 * with it, and only for an account with nothing of its own yet.
 */
import { useEffect, useState } from 'react';
import { PackageOpen } from 'lucide-react';
import type { ClaimInfo } from '@/domain/accounts';
import { claimOldData, loadClaim, skipClaim } from '@/sync/account';
import { toast } from '@/store/toastStore';
import { Button } from '../ui/primitives';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ClaimSection({ username }: { username: string }) {
  const [info, setInfo] = useState<ClaimInfo>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    loadClaim().then(
      (i) => alive && setInfo(i),
      () => undefined, // offline or an older server: nothing to offer
    );
    return () => {
      alive = false;
    };
  }, []);
  if (!info || !info.available || info.state === 'claimed' || !info.fresh) return null;

  const run = (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError('');
    fn().then(
      () => (toast(done), setInfo({ ...info, state: done.startsWith('Skipped') ? 'skipped' : 'claimed' })),
      (e) => setError(messageOf(e)),
    ).finally(() => setBusy(false));
  };
  const c = info.counts;
  const what = c ? [plural(c.teams, 'team', 'teams'), plural(c.matches, 'logged match', 'logged matches'), plural(c.shares, 'share', 'shares'), plural(c.devices, 'linked desktop app', 'linked desktop apps')].join(', ') : '';
  const body = (
    <div className="space-y-2">
      {info.email ? (
        <>
          <p>
            What you synced before with your Cloudflare sign-in <b className="break-all">{info.email}</b> ({what}) moves into <b>{username}</b>. Nothing is copied twice and nothing turns into a conflict copy; your devices
            keep syncing, and friends keep what you shared with them.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => run(claimOldData, 'Your teams from before are in your account now.')}>
              <PackageOpen size={15} aria-hidden /> {busy ? 'Bringing them over…' : 'Bring them over'}
            </Button>
            {info.state === 'pending' && (
              <Button variant="ghost" disabled={busy} onClick={() => run(skipClaim, 'Skipped. You can still do it later in Settings → Account.')}>
                Skip
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-muted">To bring over the teams you synced before, open the app in the browser (or phone app) where you’re signed in with your Cloudflare sign-in, and do it there.</p>
          {info.state === 'pending' && (
            <Button variant="ghost" disabled={busy} onClick={() => run(skipClaim, 'Skipped. You can still do it later in Settings → Account.')}>
              I have nothing from before: skip
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  );
  if (info.state === 'skipped') {
    return (
      <details className="rounded-lg border border-border p-2">
        <summary className="flex min-h-9 cursor-pointer items-center font-semibold pointer-coarse:min-h-11">Bring my teams from before</summary>
        <div className="mt-2">{body}</div>
      </details>
    );
  }
  return (
    <section className="space-y-2 rounded-xl border border-accent/40 bg-accent/8 p-3" aria-labelledby="claim-title">
      <h4 id="claim-title" className="font-semibold">
        Bring my teams from before
      </h4>
      {body}
    </section>
  );
}
