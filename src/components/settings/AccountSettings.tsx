/**
 * Settings → Account: create an account or log in when signed out; when signed in, the name, this account's
 * devices (sign one out), the password, a new recovery code, log out and log out everywhere. The app works the
 * same without an account: teams stay on the device, and sync (for now) still goes through Cloudflare Access.
 */
import { Suspense, lazy, useEffect, useState, type FormEvent } from 'react';
import { KeyRound, LogOut, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { ago } from '@/domain/sharing';
import type { SessionInfo } from '@/domain/accounts';
import { AccountError, changePassword, checkAccount, loadSessions, logout, logoutEverywhere, newRecoveryCode, revokeSession, saveDisplayName } from '@/sync/account';
import { isSignedIn, useAccountStore } from '@/sync/accountStore';
import { isDesktopApp } from '@/sync/deviceStore';
import { syncAvailable } from '@/sync/syncStore';
import { useNow } from '@/sync/useNow';
import { toast } from '@/store/toastStore';
import { LoginForm, RecoverForm, RecoveryCodeCard, SignupForm, TextField } from '../account/AccountForms';
import { Button, Checkbox, Chip, Tabs } from '../ui/primitives';

// Admins only: loads when an admin opens Settings → Account.
const AdminSettings = lazy(() => import('./AdminSettings'));

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function AccountSettings() {
  const user = useAccountStore((s) => s.user);
  const signedIn = useAccountStore(isSignedIn);
  const availability = useAccountStore((s) => s.availability);
  const [recovery, setRecovery] = useState<string>();
  // A desktop app with no address yet has nobody to ask.
  const [canCheck] = useState(() => syncAvailable() && !(isDesktopApp() && !useAccountStore.getState().server && !useAccountStore.getState().user));
  const [checking, setChecking] = useState(canCheck);

  // Ask the server once when the section opens: are accounts on, and is this device's session still good?
  useEffect(() => {
    let alive = true;
    if (!canCheck) return;
    checkAccount()
      .catch(() => undefined) // offline: what this device remembers is shown
      .finally(() => alive && setChecking(false));
    return () => {
      alive = false;
    };
  }, [canCheck]);

  if (!syncAvailable()) return <p className="text-sm text-muted">Accounts are available in the web app, the installed phone app and the desktop app.</p>;
  if (recovery) return <RecoveryCodeCard code={recovery} onDone={() => setRecovery(undefined)} />;
  if (checking && !user) {
    return (
      <p role="status" className="text-sm text-muted">
        Checking your account…
      </p>
    );
  }
  if (availability === 'off' && !user) {
    return (
      <p className="text-sm text-muted">
        Accounts aren’t switched on for this server yet. Everything works without one; sync uses your Cloudflare sign-in for now.
      </p>
    );
  }
  return signedIn ? <SignedIn onRecoveryCode={setRecovery} /> : <SignedOut onRecoveryCode={setRecovery} />;
}

function SignedOut({ onRecoveryCode }: { onRecoveryCode: (code: string) => void }) {
  const user = useAccountStore((s) => s.user);
  const [tab, setTab] = useState<'login' | 'signup' | 'recover'>(user ? 'login' : 'signup');
  const done = (what: string) => () => toast(what);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        An account keeps your teams and match log the same on every device and lets you share teams with friends. You can use the app without one; teams always stay on
        this device too.
      </p>
      {user && <p className="font-semibold text-bad">Your sign-in as {user.username} has ended. Log in again.</p>}
      {tab === 'recover' ? (
        <RecoverForm initialUsername={user?.username} onCancel={() => setTab('login')} onDone={(code) => (onRecoveryCode(code), toast('New password set. Every other device was logged out.'))} />
      ) : (
        <>
          <Tabs
            label="Account"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'signup', label: 'Create account' },
              { id: 'login', label: 'Log in' },
            ]}
          />
          {tab === 'login' ? (
            <LoginForm initialUsername={user?.username} onDone={done('Logged in.')} onForgot={() => setTab('recover')} />
          ) : (
            <SignupForm onDone={(code) => (onRecoveryCode(code), toast('Account created.'))} />
          )}
        </>
      )}
    </div>
  );
}

function SignedIn({ onRecoveryCode }: { onRecoveryCode: (code: string) => void }) {
  const user = useAccountStore((s) => s.user)!;
  const [confirmAll, setConfirmAll] = useState(false);
  const [error, setError] = useState('');
  const out = async (all: boolean) => {
    setError('');
    try {
      if (all) await logoutEverywhere();
      else await logout();
      toast(all ? 'Logged out on every device.' : 'Logged out. Your teams stay on this device.');
    } catch (e) {
      if (!all && e instanceof AccountError && e.kind === 'offline') toast('Logged out on this device. It couldn’t reach the server: sign it out from another device too.');
      else setError(messageOf(e));
    }
  };
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span>
          Signed in as <b>{user.displayName ?? user.username}</b>
          {user.displayName && <span className="text-muted"> (@{user.username})</span>}
        </span>
        {user.role === 'admin' && (
          <Chip tone="accent" icon={ShieldCheck}>
            Admin
          </Chip>
        )}
      </div>
      <DisplayName />
      <Devices />
      {user.role === 'admin' && (
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <AdminSettings />
        </Suspense>
      )}
      <details className="rounded-lg border border-border p-2">
        <summary className="flex min-h-9 cursor-pointer items-center font-semibold pointer-coarse:min-h-11">Change password</summary>
        <ChangePassword />
      </details>
      <details className="rounded-lg border border-border p-2">
        <summary className="flex min-h-9 cursor-pointer items-center font-semibold pointer-coarse:min-h-11">Recovery code</summary>
        <NewRecoveryCode onCode={onRecoveryCode} />
      </details>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void out(false)}>
          <LogOut size={15} aria-hidden /> Log out
        </Button>
        <Button variant="danger" onClick={() => setConfirmAll(true)}>
          Log out everywhere
        </Button>
      </div>
      {confirmAll && (
        <div role="alert" className="rounded-lg border border-border bg-surface-2 p-3">
          <p>Every device signed in to {user.username}, this one included, will be logged out. Teams stay on each device.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="danger" onClick={() => void out(true)}>
              Log out everywhere
            </Button>
            <Button variant="ghost" onClick={() => setConfirmAll(false)}>
              Keep
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function DisplayName() {
  const user = useAccountStore((s) => s.user)!;
  const [name, setName] = useState(user.displayName ?? '');
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    saveDisplayName(name).then(
      () => toast('Name saved.'),
      (err) => setError(messageOf(err)),
    );
  };
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
      <TextField id="account-display-name" name="nickname" label="Name others see" autoComplete="nickname" maxLength={40} placeholder={user.username} value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 basis-48" />
      <Button type="submit" disabled={name === (user.displayName ?? '')}>
        Save
      </Button>
      {error && (
        <p role="alert" className="basis-full font-semibold text-bad">
          {error}
        </p>
      )}
    </form>
  );
}

function Devices() {
  const [sessions, setSessions] = useState<SessionInfo[]>();
  const [confirm, setConfirm] = useState<string>();
  const [error, setError] = useState('');
  const now = useNow(60_000);
  useEffect(() => {
    let alive = true;
    loadSessions().then(
      (s) => alive && setSessions(s),
      (e) => alive && setError(messageOf(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  const revoke = async (s: SessionInfo) => {
    setError('');
    try {
      setSessions(await revokeSession(s.id, s.current));
      setConfirm(undefined);
      toast(s.current ? 'Logged out on this device.' : `${s.name} was signed out.`);
    } catch (e) {
      setError(messageOf(e));
    }
  };
  return (
    <section className="space-y-1.5" aria-labelledby="account-devices">
      <h4 id="account-devices" className="font-semibold">
        Devices
      </h4>
      {!sessions && !error && (
        <p role="status" className="text-muted">
          Loading devices…
        </p>
      )}
      {sessions && (
        <ul className="space-y-1.5">
          {sessions.map((s) => {
            const Icon = s.kind === 'desktop' ? Monitor : Smartphone;
            return (
              <li key={s.id} className="rounded-lg border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon size={15} className="shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 font-medium break-words">{s.name}</span>
                  {s.current && <Chip tone="good">This device</Chip>}
                  <span className="text-xs text-muted">last used {ago(s.lastSeenAt, now)}</span>
                  <Button size="sm" variant="ghost" className="ml-auto" aria-label={s.current ? 'Log out this device' : `Sign out ${s.name}`} onClick={() => setConfirm(s.id)}>
                    <LogOut size={14} aria-hidden /> {s.current ? 'Log out' : 'Sign out'}
                  </Button>
                </div>
                {confirm === s.id && (
                  <div role="alert" className="mt-2 flex flex-wrap items-center gap-2">
                    <span>{s.current ? 'Log out on this device?' : `Sign out ${s.name}? It needs the password to come back.`}</span>
                    <Button size="sm" variant="danger" onClick={() => void revoke(s)}>
                      {s.current ? 'Log out' : 'Sign out'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(undefined)}>
                      Keep
                    </Button>
                  </div>
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
    </section>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    changePassword(current, next)
      .then(() => {
        setCurrent('');
        setNext('');
        toast('Password changed. Your other devices were logged out.');
      }, (err) => setError(messageOf(err)))
      .finally(() => setBusy(false));
  };
  const user = useAccountStore((s) => s.user);
  return (
    <form className="mt-2 space-y-3" onSubmit={submit} aria-label="Change password" noValidate>
      {/* For password managers: which account this form is for. */}
      <input type="text" name="username" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
      <TextField id="change-current-password" name="current-password" label="Current password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      <TextField id="change-new-password" name="new-password" label="New password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} hint="Your other devices are logged out; this one stays signed in." />
      <Checkbox label="Show passwords" checked={show} onChange={(e) => setShow(e.target.checked)} />
      {error && (
        <p role="alert" className="font-semibold text-bad">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={busy}>
        <KeyRound size={15} aria-hidden /> {busy ? 'Checking…' : 'Change password'}
      </Button>
    </form>
  );
}

function NewRecoveryCode({ onCode }: { onCode: (code: string) => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const user = useAccountStore((s) => s.user);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    newRecoveryCode(password)
      .then((code) => {
        setPassword('');
        onCode(code);
      }, (err) => setError(messageOf(err)))
      .finally(() => setBusy(false));
  };
  return (
    <form className="mt-2 space-y-3" onSubmit={submit} aria-label="New recovery code" noValidate>
      <p className="text-muted">Lost the recovery code you saved? Make a new one; the old one stops working.</p>
      <input type="text" name="username" autoComplete="username" value={user?.username ?? ''} readOnly hidden />
      <TextField id="recovery-password" name="password" label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && (
        <p role="alert" className="font-semibold text-bad">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {busy ? 'Checking…' : 'Make a new recovery code'}
      </Button>
    </form>
  );
}
