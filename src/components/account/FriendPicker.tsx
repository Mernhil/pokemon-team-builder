import { useEffect, useState } from 'react';
import type { FriendInfo } from '@/domain/accounts';
import { loadFriends } from '@/sync/friends';
import { Select } from '../ui/primitives';

/**
 * Who to share with, for someone signed in to an account: a pick from their friends (sharing is only between
 * friends; the server checks too). Friends a share already reaches, and unavailable ones, are left out.
 */
export function FriendPicker({ value, onChange, exclude = [], label = 'Friend to share with', className }: { value: string; onChange: (id: string) => void; exclude?: string[]; label?: string; className?: string }) {
  const [friends, setFriends] = useState<FriendInfo[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    loadFriends().then(
      (r) => alive && setFriends(r.friends.filter((f) => !f.unavailable)),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (error) return <p className="min-w-0 flex-1 text-bad">{error}</p>;
  if (!friends) return <p className="min-w-0 flex-1 text-muted">Loading friends…</p>;
  const open = friends.filter((f) => !exclude.includes(f.id));
  if (!open.length) return <p className="min-w-0 flex-1 text-muted">{friends.length ? 'Shared with every friend already.' : 'No friends yet: add them in Settings → Friends.'}</p>;
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={className ?? 'min-w-0 flex-1'}>
      <option value="">Choose a friend…</option>
      {open.map((f) => (
        <option key={f.id} value={f.id}>
          {f.displayName ? `${f.displayName} (@${f.username})` : f.username}
        </option>
      ))}
    </Select>
  );
}
