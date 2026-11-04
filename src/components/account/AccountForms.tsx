/**
 * The account forms (Settings → Account and the "Sign in again" dialog): log in, create an account, use a
 * recovery code, and the one-time recovery-code screen. Phone first: 16 px inputs, 44 pt targets, the
 * attributes password managers look for (name, autocomplete, type="password").
 */
import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { Copy, KeyRound, LogIn, UserPlus } from 'lucide-react';
import { PASSWORD_MIN, passwordProblem, usernameProblem } from '@/domain/accounts';
import { AccountError, desktopServer, login, recover, signup } from '@/sync/account';
import { isDesktopApp } from '@/sync/deviceStore';
import { Button, Checkbox, Input, Label } from '../ui/primitives';
import { cn } from '../ui/styles';

const messageOf = (e: unknown): string => (e instanceof AccountError || e instanceof Error ? e.message : String(e));

/** A labelled text field (the label is a real <label for>, so tapping it focuses the field). */
export function TextField({ id, label, hint, className, ...props }: { id: string; label: string; hint?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id}>
        <Label>{label}</Label>
      </label>
      <Input id={id} aria-describedby={hintId} {...props} />
      {hint && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Runs one form submission: busy while the key is derived and the server answers, the error shown in the form. */
function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

function FormError({ error }: { error: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm font-semibold text-bad">
      {error}
    </p>
  );
}

/** The desktop app's server address (the web app is its own server). */
function ServerField({ value, onChange, idPrefix }: { value: string; onChange: (v: string) => void; idPrefix: string }) {
  if (!isDesktopApp()) return null;
  return (
    <TextField
      id={`${idPrefix}-server`}
      name="server"
      label="Your app address"
      type="url"
      inputMode="url"
      autoComplete="url"
      autoCapitalize="none"
      spellCheck={false}
      required
      placeholder="https://pokemon-team-builder.yourname.workers.dev"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function ShowPassword({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <Checkbox label="Show password" checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

const busyLabel = 'Checking…';

export function LoginForm({ initialUsername = '', onDone, onForgot, idPrefix = 'login' }: { initialUsername?: string; onDone: () => void; onForgot?: () => void; idPrefix?: string }) {
  const [server, setServer] = useState(() => desktopServer() ?? '');
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await login({ username, password, server });
      setPassword('');
      onDone();
    });
  };
  return (
    <form className="space-y-3" onSubmit={submit} aria-label="Log in" noValidate>
      <ServerField value={server} onChange={setServer} idPrefix={idPrefix} />
      <TextField id={`${idPrefix}-username`} name="username" label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
      <TextField id={`${idPrefix}-password`} name="password" label="Password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <ShowPassword checked={show} onChange={setShow} />
      <FormError error={error} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          <LogIn size={15} aria-hidden /> {busy ? busyLabel : 'Log in'}
        </Button>
        {onForgot && (
          <Button variant="ghost" onClick={onForgot}>
            Forgot password?
          </Button>
        )}
      </div>
      {busy && (
        <p role="status" className="text-xs text-muted">
          Your password is being checked on this device first; this takes a moment.
        </p>
      )}
    </form>
  );
}

export function SignupForm({ onDone, idPrefix = 'signup' }: { onDone: (recoveryCode: string) => void; idPrefix?: string }) {
  const [server, setServer] = useState(() => desktopServer() ?? '');
  const [invite, setInvite] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState({ username: false, password: false });
  const { busy, error, run } = useSubmit();
  const nameProblem = username ? usernameProblem(username.trim()) : null;
  const pwProblem = password ? passwordProblem(password, username.trim()) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched({ username: true, password: true });
    void run(async () => {
      const code = await signup({ invite, username, password, server });
      setPassword('');
      onDone(code);
    });
  };
  return (
    <form className="space-y-3" onSubmit={submit} aria-label="Create account" noValidate>
      <ServerField value={server} onChange={setServer} idPrefix={idPrefix} />
      <TextField
        id={`${idPrefix}-invite`}
        name="invite"
        label="Invite code"
        hint="The code you were sent, like K7QM-3XWD-9PTR."
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
        value={invite}
        onChange={(e) => setInvite(e.target.value)}
      />
      <TextField
        id={`${idPrefix}-username`}
        name="username"
        label="Username"
        hint={touched.username && nameProblem ? <span className="text-bad">{nameProblem}</span> : 'Others see it when you share. Letters, digits, “_”, “.” and “-”.'}
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        required
        aria-invalid={touched.username && !!nameProblem}
        value={username}
        onBlur={() => setTouched((t) => ({ ...t, username: true }))}
        onChange={(e) => setUsername(e.target.value)}
      />
      <TextField
        id={`${idPrefix}-password`}
        name="password"
        label="Password"
        type={show ? 'text' : 'password'}
        hint={touched.password && pwProblem ? <span className="text-bad">{pwProblem}</span> : `At least ${PASSWORD_MIN} characters. A few unrelated words work well.`}
        autoComplete="new-password"
        required
        aria-invalid={touched.password && !!pwProblem}
        value={password}
        onBlur={() => setTouched((t) => ({ ...t, password: true }))}
        onChange={(e) => setPassword(e.target.value)}
      />
      <ShowPassword checked={show} onChange={setShow} />
      <FormError error={error} />
      <Button type="submit" variant="primary" disabled={busy}>
        <UserPlus size={15} aria-hidden /> {busy ? 'Creating…' : 'Create account'}
      </Button>
      <p className="text-xs text-muted">Your password never leaves this device: it is turned into a key here, and only the key is sent.</p>
    </form>
  );
}

export function RecoverForm({ initialUsername = '', onDone, onCancel, idPrefix = 'recover' }: { initialUsername?: string; onDone: (recoveryCode: string) => void; onCancel: () => void; idPrefix?: string }) {
  const [server, setServer] = useState(() => desktopServer() ?? '');
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const { busy, error, run } = useSubmit();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const fresh = await recover({ username, code, password, server });
      setPassword('');
      onDone(fresh);
    });
  };
  return (
    <form className="space-y-3" onSubmit={submit} aria-label="Reset your password" noValidate>
      <p className="text-muted">Use the recovery code you saved when you made the account, or a reset code from the person who runs this app. Every device is logged out, and you get a new recovery code.</p>
      <ServerField value={server} onChange={setServer} idPrefix={idPrefix} />
      <TextField id={`${idPrefix}-username`} name="username" label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
      <TextField id={`${idPrefix}-code`} name="code" label="Recovery or reset code" autoComplete="off" autoCapitalize="characters" spellCheck={false} required value={code} onChange={(e) => setCode(e.target.value)} />
      <TextField id={`${idPrefix}-password`} name="password" label="New password" type={show ? 'text' : 'password'} hint={`At least ${PASSWORD_MIN} characters.`} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <ShowPassword checked={show} onChange={setShow} />
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          <KeyRound size={15} aria-hidden /> {busy ? busyLabel : 'Set new password'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Back to log in
        </Button>
      </div>
    </form>
  );
}

/** The recovery code, shown once: copy it, tick "I saved it", continue. */
export function RecoveryCodeCard({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState('');
  const id = useId();
  const copy = () =>
    navigator.clipboard.writeText(code).then(
      () => setCopied('Copied.'),
      () => setCopied('Could not copy: select the code and copy it by hand.'),
    );
  return (
    <section className="space-y-3 rounded-xl border border-accent/40 bg-accent/8 p-3" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="font-semibold">
        Save your recovery code
      </h4>
      <p className="text-muted">If you forget your password, this code lets you set a new one. It is shown only now. Keep it in your password manager or somewhere safe.</p>
      <p className="font-mono text-lg font-semibold tracking-wider break-all select-all" data-testid="recovery-code">
        {code}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void copy()}>
          <Copy size={14} aria-hidden /> Copy code
        </Button>
        <span role="status" className="text-xs text-muted">
          {copied}
        </span>
      </div>
      <Checkbox label="I saved it" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
      <Button variant="primary" disabled={!saved} onClick={onDone}>
        Continue
      </Button>
    </section>
  );
}
