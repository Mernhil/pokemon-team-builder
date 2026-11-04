import { useState } from 'react';
import { toast } from '@/store/toastStore';
import { useAccountStore } from '@/sync/accountStore';
import { Modal } from '../ui/Modal';
import { LoginForm, RecoverForm, RecoveryCodeCard } from './AccountForms';

/** "Sign in again", opened from the banner when this device's session ended: logs in without leaving the screen. */
export default function LoginDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const username = useAccountStore((s) => s.user?.username);
  const [mode, setMode] = useState<'login' | 'recover'>('login');
  const [recovery, setRecovery] = useState<string>();
  const close = () => onOpenChange(false);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Sign in again" description={username ? `Log in as ${username} to keep syncing and sharing.` : 'Log in to your account.'}>
      <div className="text-sm">
        {recovery ? (
          <RecoveryCodeCard code={recovery} onDone={close} />
        ) : mode === 'recover' ? (
          <RecoverForm idPrefix="dialog-recover" initialUsername={username} onCancel={() => setMode('login')} onDone={setRecovery} />
        ) : (
          <LoginForm
            idPrefix="dialog-login"
            initialUsername={username}
            onForgot={() => setMode('recover')}
            onDone={() => {
              toast('Signed in again.');
              close();
            }}
          />
        )}
      </div>
    </Modal>
  );
}
